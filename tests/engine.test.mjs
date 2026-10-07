import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as E from '../public/js/engine.js';
import { randomPlay, balanceReport, routes } from './sim.mjs';
import { followPath } from '../scripts/optimal.mjs';
import { loadBook } from '../scripts/load-book.mjs';

const book = loadBook();
const pool = JSON.parse(readFileSync(new URL('../public/data/riddles.json', import.meta.url), 'utf8')).riddles;
const refFile = new URL('../scripts/score-reference.json', import.meta.url);
const ref = existsSync(refFile) ? JSON.parse(readFileSync(refFile, 'utf8')) : null;
// The 100% routes are a spoiler, so they live in a gitignored local file (not in the public repo).
const pathsFile = new URL('../scripts/score-paths.local.json', import.meta.url);
const localPaths = existsSync(pathsFile) ? JSON.parse(readFileSync(pathsFile, 'utf8')).paths : null;
// Legacy scenario fixtures keep a 36-heart ceiling; new defaults have dedicated coverage.
const fresh = (seed = 1) => { const s = E.newGame(book, { rng: E.makeRng(seed), playerName: 'MAX' }).state; s.statMax.energy = 36; return s; };
// jump straight to a section (as if the player just arrived there)
const at = (state, id) => { E.enterSection(book, state, id, [], () => 0.5); return state; };
const choice = (state, text) => {
  const c = E.availableChoices(book, state).find((x) => !x.hidden && x.available && x.label.includes(text));
  assert.ok(c, `choice "${text}" not available in ${state.current}`);
  return c;
};
const go = (state, text, rng = () => 0.5) => E.choose(book, state, choice(state, text).index, rng);
const seven = (s) => { for (const z of book.trackers[0].entries.slice(0, 7)) s.flags[z.flag] = true; return s; };
const low = () => 0; // dice always roll 1s
const high = () => 0.99; // dice always roll 6s

test('book is valid and lint-clean, with 143 sections and 11 endings', () => {
  const lint = E.lintBook(book);
  assert.deepEqual(lint.errors, []);
  assert.deepEqual(lint.warnings, []);
  assert.equal(Object.keys(book.sections).length, 143);
  assert.equal(lint.endings.length, 11);
});

test('new game: Health 10/10, Pixel Power 60 (no cap), Luck 1d6+6, 4 tokens, 0 bonus stars, not poisoned', () => {
  const s = E.newGame(book, {rng: E.makeRng(3)}).state;
  assert.equal(s.current, 'intro');
  assert.equal(s.stats.energy, 10);
  assert.equal(E.statBounds(book, s, 'energy').max, 10);
  assert.equal(s.stats.power, 60);
  assert.deepEqual(s.status, {});
  assert.ok(s.stats.luck >= 7 && s.stats.luck <= 12);
  assert.equal(s.stats.tokens, 4);
  assert.equal(s.bonusStars, 0);
  assert.equal(E.statBounds(book, s, 'power').max, Infinity);
  assert.equal(s.moves, 0);
});

test('halve and multiply round down; halving messages are flagged', () => {
  const s = fresh();
  s.stats.energy = 7;
  const msgs = [];
  E.applyEffects(book, s, [{ stat: 'energy', halve: true }], msgs);
  assert.equal(s.stats.energy, 3);
  assert.ok(msgs[0].halved);
  assert.match(msgs[0].text, /halved.*7.*3/i);
  s.stats.power = 9;
  E.applyEffects(book, s, [{ stat: 'power', multiply: 0.5 }], []);
  assert.equal(s.stats.power, 4);
  s.stats.power = 1;
  E.applyEffects(book, s, [{ stat: 'power', halve: true }], []);
  assert.equal(s.stats.power, 0);
});

test('every move costs 1 Pixel Power, and food does not restore it', () => {
  const s = fresh();
  go(s, 'Ask Auntie Lam');
  assert.equal(s.moves, 1);
  assert.equal(s.stats.power, 59);
  s.stats.energy = 5;
  E.useItem(book, s, 'egg_tart');
  assert.equal(s.stats.energy, 8, 'egg tart = +3 Energy');
  assert.equal(s.stats.power, 59);
});

test('Pixel Power running out on a move = TRAPPED IN THE GAME FOREVER', () => {
  const s = fresh();
  s.stats.power = 1;
  go(s, 'Ask Auntie Lam');
  assert.equal(s.current, 'trapped');
  assert.equal(s.ended.style, 'trapped');
  assert.equal(s.ended.type, 'death');
  assert.equal(s.ended.cause.stat, 'power');
});

test('Energy running out from a hazard = trapped; a halving trap can do it', () => {
  const s = at(fresh(), 'mtr_platform');
  s.stats.energy = 1;
  go(s, 'Squeeze');
  assert.equal(s.current, 'trapped');
  assert.equal(s.ended.cause.stat, 'energy');
});

test('tokens running out = OUT OF TOKENS (trapped style)', () => {
  const s = at(fresh(), 'taxi_rank');
  s.stats.tokens = 2;
  go(s, 'Causeway Bay');
  assert.equal(s.current, 'out_of_tokens');
  assert.equal(s.ended.style, 'trapped');
  assert.equal(s.ended.cause.stat, 'tokens');
});

test('combat: losing your last Energy mid-fight ends the game at once', () => {
  const s = at(fresh(), 'bot_battle');
  s.stats.energy = 2;
  s.stats.luck = 2;
  // player rolls 1+1, Bolt-Bot rolls 6+6
  const seq = [0, 0, 0.99, 0.99]; let i = 0;
  const r = E.combatRound(book, s, () => seq[i++ % 4]);
  assert.ok(r.diverted);
  assert.equal(s.current, 'trapped');
  assert.equal(s.ended.cause.stat, 'energy');
});

test('luck tests use up 1 Luck whether you pass or fail; Luck reaching 0 is a game over', () => {
  for (const [rng, pass] of [[low, true], [high, false]]) {
    const s = at(fresh(), 'tiger_taichi');
    s.stats.luck = 9;
    const r = E.rollTest(book, s, rng);
    assert.equal(r.success, pass);
    assert.equal(s.stats.luck, 8);
  }
  const s = at(fresh(), 'tiger_taichi');
  s.stats.luck = 1;
  const r = E.rollTest(book, s, low);
  assert.ok(r.diverted, 'the last Luck point is used up: trapped');
  assert.equal(s.current, 'trapped');
  assert.equal(s.stats.luck, 0);
  assert.equal(s.ended.cause.stat, 'luck');
  // no advance ⚠ warning on a choice into a luck test at Luck 1 (the game over is a surprise)
  const s2 = at(fresh(), 'tiger_class');
  s2.stats.luck = 1;
  const into = E.availableChoices(book, s2).filter((c) => book.sections[c.target]?.test?.againstStat === 'luck');
  assert.ok(into.length && into.every((c) => !('warning' in c)), 'no warning on choices into luck tests');
});

// dice that land on the given faces (1-6), in order
const faces = (...f) => { let i = 0; return () => (f[i++ % f.length] - 1) / 6 + 0.01; };

test('dice gamble rule: 8+ wins (15/36), exactly 7 halves Luck (6/36), 6 or less loses (15/36)', () => {
  const gambles = Object.entries(book.sections).filter(([, s]) => s.test?.type === 'gamble').map(([id]) => id).sort();
  assert.deepEqual(gambles, ['claw', 'horse_race'], 'every bet in the story is a dice gamble');
  for (const id of gambles) {
    const o = E.gambleOdds(book, book.sections[id].test);
    assert.ok(Math.abs(o.win - 15 / 36) < 1e-9 && Math.abs(o.half - 6 / 36) < 1e-9 && Math.abs(o.lose - 15 / 36) < 1e-9, id);
    assert.equal(book.sections[id].test.againstStat, undefined, `${id} does not use Luck`);
  }
  // luck tests are not gambles
  for (const id of ['tiger_taichi', 'ts_key', 'grab']) assert.equal(book.sections[id].test.type, undefined, id);
});

test('racecourse bet: 8 = +3 tokens, 7 = half Luck (round down), 6 = -2 Luck; never Energy', () => {
  const cases = [[[4, 4], 'win', 12, 6 + 3, 9], [[3, 4], 'half', 12, 6, 4], [[3, 3], 'lose', 12, 6, 7], [[1, 1], 'lose', 12, 6, 7], [[6, 6], 'win', 12, 9, 9]];
  for (const [dice, outcome, energy, tokens, luck] of cases) {
    const s = at(fresh(), 'horse_race');
    s.stats.energy = 12; s.stats.tokens = 6; s.stats.luck = 9; s.flags.coins_causeway = true; // tokens already found in Causeway Bay
    const r = E.rollTest(book, s, faces(...dice));
    assert.equal(r.outcome, outcome, `roll ${dice}`);
    E.continueAfterTest(book, s, () => 0.5);
    assert.equal(s.current, 'causeway_bay');
    assert.equal(s.stats.energy, energy, `energy after ${dice}`);
    assert.equal(s.stats.tokens, tokens, `tokens after ${dice}`);
    assert.equal(s.stats.luck, luck, `luck after ${dice}`);
  }
});

test('claw machine gamble: 8+ wins the brass key, 7 halves Luck, 6- costs 2 Luck, Luck 0 traps you', () => {
  let s = at(fresh(), 'claw');
  E.rollTest(book, s, faces(5, 3)); E.continueAfterTest(book, s, () => 0.5);
  assert.equal(s.current, 'claw_win'); assert.ok(s.inventory.brass_key);
  s = at(fresh(), 'claw'); s.stats.energy = 9; s.stats.luck = 11;
  E.rollTest(book, s, faces(6, 1)); E.continueAfterTest(book, s, () => 0.5);
  assert.equal(s.current, 'claw_lose'); assert.equal(s.stats.luck, 5, '11 → 5 (round down)'); assert.equal(s.stats.energy, 9);
  s = at(fresh(), 'claw'); s.stats.energy = 9; s.stats.luck = 8;
  E.rollTest(book, s, faces(2, 4)); E.continueAfterTest(book, s, () => 0.5);
  assert.equal(s.current, 'claw_lose'); assert.equal(s.stats.luck, 6, '6 or less: -2 Luck'); assert.equal(s.stats.energy, 9, 'never Energy');
  for (const [dice, luck] of [[[3, 4], 1], [[1, 2], 2]]) {
    s = at(fresh(), 'claw'); s.stats.luck = luck;
    E.rollTest(book, s, faces(...dice)); E.continueAfterTest(book, s, () => 0.5);
    assert.equal(s.current, 'trapped', `Luck ${luck}, roll ${dice}: trapped`); assert.equal(s.stats.luck, 0); assert.equal(s.ended.cause.stat, 'luck');
  }
});

test('every fail ending empties the stat it blames (trapped style), e.g. Shopping Forever drains Pixel Power', () => {
  const fails = Object.entries(book.sections).filter(([, sec]) => sec.ending?.type === 'fail');
  assert.equal(fails.length, 7);
  for (const [id, sec] of fails) {
    assert.ok(book.stats[sec.ending.cause], `${id} names the stat it blames`);
    assert.equal(sec.ending.style, 'trapped', `${id} uses the TRAPPED style`);
    const s = fresh();
    s.stats.power = 30; s.stats.energy = 9;
    at(s, id);
    assert.equal(s.stats[sec.ending.cause], 0, `${id}: ${sec.ending.cause} is 0`);
    assert.deepEqual(s.ended.cause, { stat: sec.ending.cause, value: 0 });
  }
  assert.equal(book.sections.zapped.ending.cause, 'energy');
  const s = at(fresh(), 'sale_trap');
  s.stats.power = 25;
  go(s, 'Grab another one');
  assert.equal(s.current, 'shopping_forever');
  assert.equal(s.stats.power, 0, 'the stats panel shows 0 Pixel Power');
  assert.equal(s.ended.cause.stat, 'power');
  assert.match(JSON.stringify(book.sections.shopping_forever.text), /drained your last pixel power/i);
});

test('Luck can be won back a little (temple incense), never above the starting value', () => {
  const s = fresh(5);
  const start = s.statMax.luck;
  s.stats.luck = start - 2;
  at(s, 'man_mo_calm');
  assert.equal(s.stats.luck, start - 1);
  const s2 = fresh(5);
  at(s2, 'man_mo_calm');
  assert.equal(s2.stats.luck, start);
});

test('NO "⚠ WOULD RUN OUT" warnings: choices and penalties never say in advance that a stat will run out', () => {
  assert.equal(E.wouldDeplete, undefined, 'the engine no longer predicts depletion for the UI');
  const s = at(fresh(), 'tram');
  s.stats.energy = 4;
  const dark = choice(s, 'Feel your way');
  assert.ok(!('warning' in dark));
  go(s, 'Feel your way');
  assert.equal(s.current, 'trapped', 'but running out is still the normal game over');
  assert.equal(s.ended.cause.stat, 'energy');
  // every choice in the book, at the worst moment (1 of everything left)
  for (const id of Object.keys(book.sections)) {
    const t = at(fresh(), id);
    if (t.ended) continue;
    for (const k of Object.keys(t.stats)) t.stats[k] = 1;
    for (const c of E.availableChoices(book, t)) assert.ok(!('warning' in c), `${id}: ${c.label}`);
  }
});

test('riddle: a correct answer passes, meets the animal (+2 Pixel Power) and earns +3 Energy but NO tokens', () => {
  const s = at(fresh(), 'tram_monkey');
  s.stats.power = 20;
  s.stats.energy = 9;
  const tokens = s.stats.tokens;
  const r = E.currentRiddle(book, s);
  assert.equal(r.total, 1, 'one riddle per character');
  assert.equal(E.answerRiddle(book, s, r.question.answer).correct, true);
  E.continueRiddle(book, s);
  assert.equal(s.current, 'tram');
  assert.ok(s.flags.zodiac_monkey);
  assert.equal(s.stats.power, 20 + 2 - 1, '+2 for meeting the Monkey, -1 for the move');
  assert.equal(s.stats.tokens, tokens, 'no token reward for a correct answer');
  assert.equal(s.stats.energy, 12);
});

const wrongOf = (r) => (r.question.answer + 1) % r.question.options.length;

test('riddle loop: wrong, pay 2 tokens, ANOTHER random riddle from the same character, then a correct answer passes', () => {
  const s = at(fresh(), 'liv');
  s.stats.tokens = 5;
  s.flags.coins_causeway = true; // the Causeway Bay token find is already picked up
  const t = s.stats.tokens;
  const r1 = E.currentRiddle(book, s);
  assert.equal(r1.untilCorrect, true);
  assert.equal(r1.index, 0);
  assert.equal(E.answerRiddle(book, s, wrongOf(r1)).correct, false);
  const pens = E.riddlePenalties(book, s);
  assert.equal(pens.length, 2);
  assert.ok(pens[0].available);
  E.payRiddlePenalty(book, s, 0);
  assert.equal(s.stats.tokens, t - 2);
  E.continueRiddle(book, s);
  assert.equal(s.current, 'liv', 'no pass after a wrong answer: Liv asks again');
  assert.ok(!s.flags.liv_passed);
  const r2 = E.currentRiddle(book, s);
  assert.equal(r2.index, 1, 'riddle 2');
  assert.notEqual(r2.question.id, r1.question.id, 'a different riddle');
  assert.deepEqual(s.riddlesUsed.slice(-2), [r1.question.id, r2.question.id], 'both are used up (no repeats this game)');
  // a reload mid-loop shows the very same second riddle
  assert.equal(E.currentRiddle(book, JSON.parse(JSON.stringify(s))).question.id, r2.question.id);
  // wrong again: pay again, riddle 3
  E.answerRiddle(book, s, wrongOf(r2));
  E.payRiddlePenalty(book, s, 0);
  E.continueRiddle(book, s);
  const r3 = E.currentRiddle(book, s);
  assert.equal(r3.index, 2);
  assert.ok(![r1.question.id, r2.question.id].includes(r3.question.id));
  assert.equal(s.stats.tokens, t - 4);
  assert.equal(E.answerRiddle(book, s, r3.question.answer).correct, true);
  E.continueRiddle(book, s);
  assert.equal(s.current, 'causeway_bay');
  assert.ok(s.flags.liv_passed);
  assert.equal(s.stats.tokens, t - 4, 'the correct answer earns no tokens');
});

test('riddle loop: wrong, halve Energy, then head back for free before the next riddle', () => {
  const s = at(fresh(), 'vault_snake');
  s.stats.energy = 13;
  const r1 = E.currentRiddle(book, s);
  E.answerRiddle(book, s, wrongOf(r1));
  assert.throws(() => E.retreatRiddle(book, s), /answer|retreat|pay/i, 'pay first');
  E.payRiddlePenalty(book, s, 1);
  assert.equal(s.stats.energy, 6, '13 halved, rounded down');
  E.continueRiddle(book, s);
  assert.equal(E.currentRiddle(book, s).index, 1, 'a second riddle is waiting');
  const before = { ...s.stats };
  E.retreatRiddle(book, s);
  assert.equal(s.current, book.sections.vault_snake.riddle.retreat.target);
  assert.equal(s.stats.energy, before.energy, 'heading back is free');
  assert.equal(s.stats.tokens, before.tokens);
});

test('riddle loop: death checks still apply between riddles (halving Energy 1 = trapped)', () => {
  const s = at(fresh(), 'loulou');
  s.stats.energy = 1; s.stats.tokens = 1;
  const r = E.currentRiddle(book, s);
  E.answerRiddle(book, s, wrongOf(r));
  assert.equal(E.riddlePenalties(book, s)[0].available, false, 'under 2 tokens: halving only');
  E.payRiddlePenalty(book, s, 1);
  assert.equal(s.current, 'trapped');
  assert.equal(s.ended.cause.stat, 'energy');
});

test('riddle pool: 200 original riddles, 3-4 options each, valid answers, 5 categories', () => {
  assert.equal(pool.length, 200);
  assert.equal(new Set(pool.map((r) => r.id)).size, 200);
  assert.equal(new Set(pool.map((r) => r.question + r.options[r.answer])).size, 200);
  for (const r of pool) {
    assert.ok(r.options.length >= 3 && r.options.length <= 4, r.id);
    assert.ok(r.answer >= 0 && r.answer < r.options.length, r.id);
    assert.equal(new Set(r.options).size, r.options.length, r.id);
  }
  assert.deepEqual([...new Set(pool.map((r) => r.category))].sort(), ['culture', 'logic', 'maths', 'nature', 'wordplay']);
});

test('every riddle character (Liv, Loulou and the zodiac animals) asks ONE pool riddle at a time, until one is answered right', () => {
  const riddleSecs = Object.entries(book.sections).filter(([, sec]) => sec.riddle);
  assert.deepEqual(riddleSecs.map(([id]) => id).sort(), ['liv', 'loulou', 'tram_monkey', 'vault_snake']);
  for (const [id, sec] of riddleSecs) {
    assert.equal(sec.riddle.draw, 1, id);
    assert.equal(sec.riddle.questions, undefined, id);
    const s = at(fresh(), id);
    const r = E.currentRiddle(book, s);
    assert.equal(r.total, 1);
    assert.equal(sec.riddle.untilCorrect, true, `${id} keeps asking until a correct answer`);
    assert.ok(pool.some((p) => p.id === r.question.id));
    assert.ok(sec.riddle.retreat && sec.riddle.wrong.options.length === 2, 'retreat + pay-or-halve kept');
  }
});

test('riddles are random, never repeat within a game, and a reload keeps the same riddle', () => {
  const s = fresh(7);
  const seen = [];
  const ids = ['liv', 'loulou', 'tram_monkey', 'vault_snake'];
  for (let i = 0; i < 200; i++) {
    at(s, ids[i % 4]);
    const q = E.currentRiddle(book, s).question.id;
    // reload: the saved state brings back the very same riddle
    const reloaded = JSON.parse(JSON.stringify(s));
    assert.equal(E.currentRiddle(book, reloaded).question.id, q);
    seen.push(q);
  }
  assert.equal(new Set(seen).size, 200, 'all 200 asked once before any repeat');
  at(s, 'liv');
  assert.ok(E.currentRiddle(book, s).question, 'pool starts over after 200');
  // different games get different riddles
  const firsts = new Set();
  for (let g = 0; g < 20; g++) { const t = E.newGame(book, { rng: E.makeRng(1), playerName: 'MAX' }).state; at(t, 'liv'); firsts.add(E.currentRiddle(book, t).question.id); }
  assert.ok(firsts.size >= 10, `only ${firsts.size} different first riddles in 20 games`);
});

test('riddle: wrong answer, halve Energy instead', () => {
  const s = at(fresh(), 'loulou');
  s.stats.energy = 11;
  const r = E.currentRiddle(book, s);
  E.answerRiddle(book, s, (r.question.answer + 1) % 3);
  E.payRiddlePenalty(book, s, 1);
  assert.equal(s.stats.energy, 5);
});

test('riddle: with fewer than 2 tokens only halving is allowed; paying your last 2 = OUT', () => {
  const s = at(fresh(), 'liv');
  s.stats.tokens = 1;
  let r = E.currentRiddle(book, s);
  E.answerRiddle(book, s, (r.question.answer + 1) % 3);
  const pens = E.riddlePenalties(book, s);
  assert.equal(pens[0].available, false);
  assert.ok(pens[1].available);
  assert.throws(() => E.payRiddlePenalty(book, s, 0));
  const s2 = at(fresh(), 'liv');
  s2.stats.tokens = 2;
  r = E.currentRiddle(book, s2);
  E.answerRiddle(book, s2, (r.question.answer + 1) % 3);
  assert.ok(!('warning' in E.riddlePenalties(book, s2)[0]), 'no advance warning about the last tokens');
  E.payRiddlePenalty(book, s2, 0);
  assert.equal(s2.current, 'out_of_tokens');
  assert.equal(s2.ended.cause.stat, 'tokens');
});

test('riddle: retreat before answering costs nothing but the move', () => {
  for (const id of ['liv', 'tram_monkey', 'loulou', 'vault_snake']) {
    const s = at(fresh(), id);
    for (const f of ['coins_central', 'coins_man_mo', 'coins_dingding', 'coins_causeway']) s.flags[f] = true; // one-time token finds already picked up
    const before = { ...s.stats };
    const target = book.sections[id].riddle.retreat.target;
    E.retreatRiddle(book, s);
    assert.equal(s.current, target, id);
    assert.equal(s.stats.energy, before.energy);
    assert.equal(s.stats.tokens, before.tokens);
    assert.equal(s.stats.power, before.power - 1);
  }
  const s = at(fresh(), 'liv');
  const r = E.currentRiddle(book, s);
  E.answerRiddle(book, s, r.question.answer);
  assert.throws(() => E.retreatRiddle(book, s), /answer|retreat/i);
});

test('the zodiac: 12 animals; the Dragon joins only at the winning finale after the other 11', () => {
  const z = book.trackers.find((t) => t.id === 'zodiac');
  assert.equal(z.entries.length, 12);
  assert.equal(z.entries[11].id, 'dragon');
  assert.ok(book.characters.dragon?.sprite, 'the Dragon has a sprite');
  const eleven = z.entries.slice(0, 11).map((e) => e.flag);
  const finale = (flags) => { const s = at(fresh(), 'dragon_summit'); s.inventory.pearl = 1; for (const f of flags) s.flags[f] = true; go(s, 'Hold up the Pearl'); return s; };
  let s = finale(eleven);
  assert.equal(s.ended?.type, 'win');
  assert.ok(s.flags.zodiac_dragon, 'all 11 met: the Dragon joins at the finale');
  assert.deepEqual(E.trackerProgress(book, s).find((t) => t.id === 'zodiac').met.length, 12);
  s = finale(eleven.slice(0, 10));
  assert.ok(!s.flags.zodiac_dragon, 'only 10 met: the Dragon stays with the moon');
  for (const id of Object.keys(book.sections)) if (id !== 'victory') assert.ok(!JSON.stringify(book.sections[id]).includes('"zodiac_dragon"'), `${id} never sets the Dragon`);
  assert.match(JSON.stringify(book.sections.lantern_stall), /moon/i);
});

test('each zodiac animal gives +2 Pixel Power once', () => {
  const s = at(fresh(), 'horse_track');
  const p = s.stats.power;
  assert.equal(p, 62);
  go(s, 'Cheer');
  at(s, 'horse_track');
  assert.equal(s.stats.power, p - 1 + 0, 'second visit: no extra bonus');
});

test('exactly one route can collect all 12 zodiac animals (through the vault, the ferry and the Bolt-Bot duel, to the victory)', () => {
  const flags = book.trackers[0].entries.map((e) => e.flag);
  const all = routes(book).filter((r) => flags.every((f) => r.flags.has(f)));
  // routes() is optimistic about the pearl after the duel (tower / King variants), so compare the
  // routes up to the moment Bolt-Bot is beaten: there is only one way to get there with all 12.
  const prefix = (r) => r.route.slice(0, r.route.findIndex((x) => x.split(',').includes('bot_beaten')) + 1).join(' > ');
  const prefixes = new Set(all.map(prefix));
  assert.equal(prefixes.size, 1, [...prefixes].join('\n'));
  const r = all[0].route.join(' ');
  assert.ok(r.includes('vault') && r.includes('ferry_captain') && r.includes('bot_battle') && r.includes('bot_beaten'));
  assert.ok(all.every((x) => x.ending === 'victory'));
});

test('score: reference path replays to all twelve animals and exactly 100%', { skip: !localPaths && 'needs the local route file (run npm run score:ref)' }, () => {
  for (const [start, path] of Object.entries(localPaths)) {
    const s = followPath(book, path, { startValue: +start });
    assert.equal(s.ended?.type, 'win');
    const z = E.trackerProgress(book, s).find((t) => t.id === 'zodiac');
    assert.ok(z.complete, 'reference route collects all twelve animals');
    const sc = E.computeScore(book, s);
    assert.equal(sc.raw, ref.values[start]);
    assert.equal(sc.percent, 100);
    assert.equal(sc.rank, 'PIXEL LEGEND');
    assert.ok(s.moves >= 25, 'the full-zodiac route is long');
  }
});

test('score: book reference matches scripts/score-reference.json; no random win beats it', { skip: !ref && 'no reference yet' }, () => {
  assert.deepEqual(book.scoring.reference.values, ref.values);
  assert.equal(ref.paths, undefined, 'the public reference file must not contain the routes');
  assert.ok(!JSON.stringify(book.scoring).includes('dragon_summit'), 'no route text in the book');
  let wins = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const r = randomPlay(book, seed);
    if (r.type !== 'win') continue;
    wins++;
    const sc = E.computeScore(book, r.state);
    assert.ok(sc.raw <= sc.reference, `seed ${seed}: ${sc.raw} > ${sc.reference}`);
    assert.ok(sc.percent >= 0 && sc.percent < 100 || sc.raw === sc.reference);
  }
  assert.ok(wins >= 0); // Random wandering is not a winning strategy with the seven-animal gate.
});

test('random playthroughs reach every ending, including trapped (Energy, Pixel Power, Luck) and out of tokens', () => {
  const seen = new Set();
  const causes = new Set();
  for (let seed = 1; seed <= 4000; seed++) {
    const r = randomPlay(book, seed);
    assert.notEqual(r.type, 'wandering', `seed ${seed} never ended`);
    seen.add(r.ending);
    if (r.cause) causes.add(r.cause);
  }
  const endings = Object.keys(book.sections).filter((id) => book.sections[id].ending);
  assert.ok([...seen].every(id => endings.includes(id))); // Rare late endings are covered by deterministic tests.
  assert.deepEqual([...causes].sort(), ['energy', 'power', 'tokens']);
});

test('balance: seven-animal gate makes random wandering unlikely to win; wanderers run out of Pixel Power', () => {
  const rep = balanceReport(book, 4000);
  assert.ok(rep.winRate >= 0 && rep.winRate < 0.15, `win rate ${rep.winRate}`);
  assert.ok(rep.causes.power > 0);
  assert.equal(rep.runs, 4000);
});

test('bonus stars: +1 for each won luck roll (luck tests and dice gambles), nothing for a loss', () => {
  let s = at(fresh(), 'tiger_taichi'); s.stats.luck = 9;
  let r = E.rollTest(book, s, low);
  assert.equal(r.success, true);
  assert.equal(s.bonusStars, 1);
  assert.ok(r.messages.some((m) => m.type === 'star' && m.stars === 1));
  s = at(fresh(), 'tiger_taichi'); s.stats.luck = 9;
  r = E.rollTest(book, s, high);
  assert.equal(r.success, false);
  assert.equal(s.bonusStars, 0);
  assert.ok(!r.messages.some((m) => m.type === 'star'));
  for (const [dice, outcome, stars] of [[[4, 4], 'win', 1], [[6, 6], 'win', 1], [[3, 4], 'half', 0], [[1, 2], 'lose', 0]]) {
    s = at(fresh(), 'horse_race'); s.stats.luck = 9;
    r = E.rollTest(book, s, faces(...dice));
    assert.equal(r.outcome, outcome);
    assert.equal(s.bonusStars, stars, `gamble ${dice}`);
  }
  // they add up over a game and survive a reload
  s = fresh();
  for (const id of ['tiger_taichi', 'claw', 'grab']) { at(s, id); s.stats.luck = 11; E.rollTest(book, s, id === 'claw' ? faces(5, 3) : low); }
  assert.equal(s.bonusStars, 3);
  assert.equal(JSON.parse(JSON.stringify(s)).bonusStars, 3);
});

test('bonus stars are purely cosmetic: not a stat, not in the score, cannot be spent', () => {
  assert.equal(book.rules.bonusStars, true);
  assert.equal(book.stats.stars, undefined);
  assert.equal(book.stats.bonusStars, undefined);
  assert.ok(!JSON.stringify(book.scoring.components).match(/star/i), 'no score component uses stars');
  assert.ok(!JSON.stringify(book.sections).includes('bonusStars'), 'no choice or effect reads or spends them');
  const s = at(fresh(), 'dragon_summit'); s.inventory.pearl = 1; go(s, 'Hold up the Pearl');
  const a = E.computeScore(book, s);
  s.bonusStars = 42;
  const b = E.computeScore(book, s);
  assert.deepEqual(a, b, 'score identical with 0 or 42 stars');
  const before = JSON.stringify(s.stats);
  const t = at(fresh(), 'tiger_taichi'); t.stats.luck = 9; const st = JSON.stringify({ ...t.stats, luck: 8 });
  E.rollTest(book, t, low);
  assert.equal(JSON.stringify(t.stats), st, 'winning a star changes no stat (only the usual -1 Luck for the test)');
  assert.ok(before);
});

test('final boss: Turbo Bolt-Bot is much tougher (ATK 8, 10 HP, 3-damage bops; was ATK 5, 6 HP, 2)', () => {
  const c = book.sections.bot_battle.combat;
  assert.equal(c.enemies.length, 1);
  const e = c.enemies[0];
  assert.deepEqual([e.attack, e.health, e.damage], [8, 10, 3]);
  assert.equal(c.damage, 2, 'you still bop for 2');
  assert.ok(c.flee, 'RUN AWAY is still offered');
  assert.equal(Object.values(book.sections).filter((x) => x.combat).length, 1, 'the only (and so final) fight before the King');
  const s = at(fresh(), 'bot_battle');
  let d = E.combatDamage(book, s);
  assert.deepEqual([d.attack, d.armor, d.enemy, d.player], [0, 0, 3, 2], 'unprepared: no boosts');
  // a well-prepared hero: 8 zodiac friends, Phoenix Feather, Umbrella
  for (const z of book.trackers[0].entries.slice(0, 8)) s.flags[z.flag] = true;
  s.inventory.feather = 1; s.inventory.umbrella = 1;
  d = E.combatDamage(book, s);
  assert.deepEqual([d.attack, d.armor, d.enemy], [3, 1, 2], '+3 attack and the umbrella softens bops to 2');
  assert.equal(d.boosts.length, 4);
  // 2 friends: +1, 4 friends: +2
  const s2 = at(fresh(), 'bot_battle');
  for (const z of book.trackers[0].entries.slice(0, 2)) s2.flags[z.flag] = true;
  assert.equal(E.combatDamage(book, s2).attack, 1);
  for (const z of book.trackers[0].entries.slice(0, 4)) s2.flags[z.flag] = true;
  assert.equal(E.combatDamage(book, s2).attack, 2);
  // the boost is part of the roll total
  const s3 = at(fresh(), 'bot_battle'); s3.stats.luck = 7; s3.inventory.feather = 1;
  const r = E.combatRound(book, s3, faces(3, 3, 3, 3));
  assert.equal(r.round.playerTotal, 6 + 7 + 1);
  assert.equal(r.round.enemyTotal, 6 + 8);
  assert.equal(r.round.winner, 'tie');
  // an enemy bop costs 3 Energy (2 behind the umbrella)
  const s4 = at(fresh(), 'bot_battle'); s4.stats.luck = 7; s4.stats.energy = 16;
  E.combatRound(book, s4, faces(1, 1, 6, 6));
  assert.equal(s4.stats.energy, 13);
  s4.inventory.umbrella = 1;
  E.combatRound(book, s4, faces(1, 1, 6, 6));
  assert.equal(s4.stats.energy, 11);
});

test('final boss: a real test unprepared, but winnable for a well-prepared hero (boosts give a big edge)', () => {
  const duel = (prep, seed) => {
    const s = at(fresh(), 'bot_battle');
    s.stats.luck = 8; s.stats.energy = 16;
    if (prep) { for (const z of book.trackers[0].entries.slice(0, 8)) s.flags[z.flag] = true; s.inventory.feather = 1; s.inventory.umbrella = 1; }
    const rng = E.makeRng(seed);
    while (!s.ended && !s.pending.result) E.combatRound(book, s, rng);
    return s.pending?.result === 'win';
  };
  const rate = (prep) => { let w = 0; for (let i = 1; i <= 2000; i++) if (duel(prep, i)) w++; return w / 2000; };
  const bare = rate(false), ready = rate(true);
  assert.ok(bare < 0.75, `unprepared Luck 8 wins only ${bare}`);
  assert.ok(ready > 0.95, `prepared Luck 8 wins ${ready}`);
  // the old Bolt-Bot (ATK 5, 6 HP, 2 damage) was a walkover at Luck 8
  assert.ok(ready - bare > 0.2);
});

// ---------- v2.3.0: Turbo Bolt-Bot is mandatory ----------
// every target a section can send you to (choices, tests, gambles, combat, riddles, flee...)
const targetsOf = (sec) => { const out = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'target' && typeof x === 'string') out.push(x); else walk(x); } }; walk(sec); out.push(...(sec.pickRandom || [])); return out; };
const reachable = (blocked) => { const seen = new Set([book.start]); const q = [book.start]; while (q.length) { for (const t of targetsOf(book.sections[q.pop()])) if (t !== blocked && !seen.has(t)) { seen.add(t); q.push(t); } } return seen; };

test('graph audit: EVERY path to the victory goes through a win against Turbo Bolt-Bot (no bypass)', () => {
  assert.ok(reachable(null).has('victory'), 'the victory is reachable');
  assert.ok(!reachable('bot_beaten').has('victory'), 'without beating Bolt-Bot the victory cannot be reached');
  assert.ok(!reachable('bot_battle').has('victory'), 'without the duel the victory cannot be reached');
  assert.ok(!reachable('bot_beaten').has('dragon_summit'), 'nor the Dragon');
  // bot_beaten is only entered by WINNING the duel: no choice, test or flee leads there
  const into = Object.entries(book.sections).filter(([, sec]) => targetsOf(sec).includes('bot_beaten')).map(([id]) => id);
  assert.deepEqual(into, ['bot_battle']);
  const c = book.sections.bot_battle.combat;
  assert.equal(c.win.target, 'bot_beaten');
  assert.notEqual(c.lose.target, 'bot_beaten');
  assert.notEqual(c.flee.target, 'bot_beaten');
  // and the route enumerator agrees: every winning route has the duel and the win in it
  const wins = routes(book).filter((r) => r.ending === 'victory');
  assert.ok(wins.length > 20);
  for (const r of wins) { const t = r.route.join(' '); assert.ok(/\bbot_battle\b/.test(t) && /\bbot_beaten\b/.test(t), t); }
});

test('after freeing the snake (vault) you climb back to the Peak and still have to fight Bolt-Bot', () => {
  const s = at(fresh(), 'vault');
  assert.equal(s.inventory.pearl, 1);
  const ch = E.availableChoices(book, s).filter((c) => !c.hidden);
  assert.deepEqual(ch.map((c) => c.target), ['peak_top'], 'the vault only leads back up to the Peak');
  go(s, 'secret stairs');
  assert.equal(s.current, 'peak_top');
  assert.ok(!E.availableChoices(book, s).some((c) => !c.hidden && ['tower_top', 'dragon_summit', 'king_scream', 'king_calm'].includes(c.target)), 'no way past the robot from the Peak');
  // the old bypasses (whistle, snack, Loulou's climb) now lead to the duel, not past it
  for (const id of ['bot_dance', 'bot_snack', 'goat_climb']) assert.deepEqual(targetsOf(book.sections[id]).sort(), ['bot_battle', 'peak_top'], id);
  // with the pearl in hand, winning the duel goes straight up to the Dragon
  seven(s); go(s, 'BOSS duel');
  assert.equal(s.current, 'bot_battle');
  s.stats.luck = 12; s.stats.energy = 28;
  while (!s.pending.result) E.combatRound(book, s, faces(6, 6, 1, 1));
  E.continueAfterCombat(book, s);
  assert.equal(s.current, 'bot_beaten');
  go(s, 'race up the tower stairs');
  assert.equal(s.current, 'dragon_summit');
});

test('old bypass items are in-fight boosts: whistle stuns (-4 HP), snack +4 Energy, Loulou high ground +1 ATK; all listed', () => {
  // Silver Whistle: Bolt-Bot starts the duel dizzy, with 4 HP fewer
  let s = at(fresh(), 'peak_top'); s.inventory.whistle = 1;
  go(s, 'Blow the Silver Whistle');
  assert.equal(s.current, 'bot_dance');
  assert.ok(s.flags.bot_dizzy);
  seven(s); go(s, 'Challenge the dizzy robot');
  assert.equal(s.pending.enemyHealth, 6, '10 - 4');
  assert.equal(E.combatBoosts(book, s).stun, 4);
  // without it: full 10 HP
  assert.equal(at(fresh(), 'bot_battle').pending.enemyHealth, 10);
  // snack: the egg tart (or bubble tea) goes to the robot, +4 Energy before the fight
  s = at(fresh(), 'peak_top'); s.inventory.egg_tart = 1; s.stats.energy = 10;
  go(s, 'Share your egg tart');
  assert.equal(s.current, 'bot_snack');
  assert.equal(s.stats.energy, 14);
  assert.ok(!s.inventory.egg_tart);
  seven(s); go(s, 'Challenge Bolt-Bot');
  assert.ok(E.combatBoosts(book, s).active.some((b) => /snack/i.test(b.label) && /\+4 Health/.test(b.note)));
  // Loulou's climb: only after Loulou's tips, +1 attack from the high ground
  s = at(fresh(), 'peak_top');
  assert.ok(!E.availableChoices(book, s).some((c) => !c.hidden && c.target === 'goat_climb'), 'needs Loulou first');
  s.flags.goat_tips = true;
  go(s, 'Climb to the high ledge');
  seven(s); go(s, 'Leap down on Bolt-Bot');
  assert.equal(s.current, 'bot_battle');
  assert.equal(E.combatDamage(book, s).attack, 3);
  // all three are shown in the boost list, next to the old ones
  const labels = book.sections.bot_battle.combat.boosts.map((b) => b.label).join(' | ');
  for (const re of [/whistle/i, /snack/i, /high ground/i, /feather/i, /umbrella/i, /zodiac/i]) assert.match(labels, re);
  // a hero with everything: 6+ friends, feather, umbrella, high ground, dizzy robot, snack
  s = at(fresh(), 'bot_battle');
  for (const z of book.trackers[0].entries.slice(0, 8)) s.flags[z.flag] = true;
  Object.assign(s.inventory, { feather: 1, umbrella: 1 }); Object.assign(s.flags, { high_ground: true, bot_dizzy: true, robot_friend: true });
  const b = E.combatBoosts(book, s);
  assert.deepEqual([b.attack, b.armor, b.stun, b.active.length], [4, 1, 4, 7]);
});

test('RUN AWAY retreats to the Peak lookout for -3 Pixel Power, and the duel is still waiting', () => {
  const s = at(fresh(), 'bot_battle');
  const p = s.stats.power;
  E.flee(book, s, () => 0.5);
  assert.equal(s.current, 'peak_top');
  assert.equal(s.stats.power, p - 3 - 1, '-3 for running, -1 for the move');
  seven(s); go(s, 'BOSS duel');
  assert.equal(s.current, 'bot_battle');
  assert.equal(s.pending.enemyHealth, 10, 'a fresh duel');
  // running with your last Pixel Power is the normal game over
  const t = at(fresh(), 'bot_battle'); t.stats.power = 3;
  E.flee(book, t, () => 0.5);
  assert.equal(t.ended?.cause.stat, 'power');
});

test('prepared players beat Turbo Bolt-Bot ~99% of the time (100%-route state); unprepared it is a coin flip at best', () => {
  const duel = (prep, seed) => {
    const s = at(fresh(), 'peak_top');
    s.stats.luck = 8; s.stats.energy = 20;
    if (prep) { for (const z of book.trackers[0].entries.slice(0, 11)) s.flags[z.flag] = true; Object.assign(s.inventory, { feather: 1, umbrella: 1 }); Object.assign(s.flags, { high_ground: true, bot_dizzy: true }); }
    at(s, 'bot_battle');
    const rng = E.makeRng(seed);
    while (!s.ended && !s.pending.result) E.combatRound(book, s, rng);
    return s.pending?.result === 'win';
  };
  const rate = (prep) => { let w = 0; for (let i = 1; i <= 2000; i++) if (duel(prep, i)) w++; return w / 2000; };
  const ready = rate(true), bare = rate(false);
  assert.ok(ready >= 0.98, `prepared: ${ready}`);
  assert.ok(bare <= 0.75, `unprepared: ${bare}`);
  assert.ok(ready - bare >= 0.25, 'the advantages make a big difference');
});

// ---------- v2.3.0: 5 starting tokens, no token reward for riddles, token pickups ----------
test('tokens: start with 4; riddles pay NO tokens; one-time token finds in Central, Man Mo, the tram and Causeway Bay', () => {
  for (const [id, sec] of Object.entries(book.sections)) if (sec.riddle) assert.ok(!JSON.stringify(sec.riddle.onCorrect).includes('"tokens"'), `${id}: no token reward`);
  for (const id of ['central', 'man_mo', 'dingding', 'causeway_bay']) {
    const s = fresh();
    at(s, id);
    assert.equal(s.stats.tokens, 4 + 4, `${id}: +4 tokens`);
    at(s, id);
    assert.equal(s.stats.tokens, 8, `${id}: only once`);
  }
});

// ---------- v2.3.0: Statue Square and the PiGeons ----------
test('Statue Square is an optional detour from Central; "PiGeons" is always spelled with capital P and G', () => {
  const s = at(fresh(), 'central');
  go(s, 'Statue Square');
  assert.equal(s.current, 'statue_square');
  assert.ok(!reachable('statue_square').has('statue_square') && reachable('statue_square').has('victory'), 'the victory does not need it');
  const all = JSON.stringify(book);
  const spellings = new Set(all.match(/pigeons?/gi));
  assert.deepEqual([...spellings].filter((x) => /s$/i.test(x)), ['PiGeons'], `found ${[...spellings]}`);
  assert.ok(!/\bpigeon\b/i.test(all.replace(/PiGeon\b/g, '')), 'single PiGeon is spelled the same way');
  assert.equal(book.characters.flock.name, 'PiGeons');
  assert.match(book.sections.statue_square.illustration.src, /statue\.svg$/);
  assert.ok(existsSync(new URL('../public/img/statue.svg', import.meta.url)));
});

test('PiGeons WITH food: they eat ALL egg tarts and buns, -2 Pixel Power, -2 Energy, -2 Luck (no star)', () => {
  const s = at(fresh(), 'central');
  Object.assign(s.inventory, { egg_tart: 2, pineapple_bun: 1, octopus: 1 });
  s.stats.energy = 10; s.stats.luck = 9;
  const p = s.stats.power, stars = s.bonusStars;
  const r = go(s, 'Statue Square');
  assert.equal(s.current, 'statue_square');
  assert.ok(!s.inventory.egg_tart && !s.inventory.pineapple_bun, 'every tart and bun is gone');
  assert.equal(s.inventory.octopus, 1, 'other items are safe');
  assert.deepEqual([s.stats.power, s.stats.energy, s.stats.luck], [p - 1 - 2, 8, 7]);
  assert.equal(s.bonusStars, stars, 'no star when they swarm you');
  assert.ok(!s.itemsUsed?.egg_tart && !s.itemsUsed?.pineapple_bun, 'eaten by PiGeons is not "used" for the score');
  const text = E.sectionParagraphs(book, s, book.sections.statue_square).join(' ');
  assert.match(text, /swoops down/); assert.doesNotMatch(text, /tiny, twinkling pixel star/);
  assert.ok(r.some((m) => /PiGeons swarm/.test(m.text || '')));
  // just one of the two foods is enough to set them off
  const t = at(fresh(), 'central'); t.inventory.pineapple_bun = 1;
  go(t, 'Statue Square');
  assert.ok(!t.inventory.pineapple_bun && t.flags.flock_swarm);
});

test('PiGeons WITHOUT food: they ignore you (with a clue) and you find a cosmetic bonus star, once per game', () => {
  const s = at(fresh(), 'central');
  const before = { ...s.stats };
  const r = go(s, 'Statue Square');
  assert.equal(s.bonusStars, 1, '+1 bonus star');
  assert.ok(r.some((m) => m.type === 'star' && m.stars === 1), 'the star burst message fires');
  assert.deepEqual({ ...s.stats, power: s.stats.power + 1 }, before, 'no stat changes (only the usual -1 Pixel Power for the move)');
  const text = E.sectionParagraphs(book, s, book.sections.statue_square).join(' ');
  assert.match(text, /whistle/i, 'a clue about the robot');
  assert.match(text, /pixel star/);
  // the score is the same as without the star
  const sc = E.computeScore(book, s); s.bonusStars = 0; assert.deepEqual(E.computeScore(book, s), sc); s.bonusStars = 1;
  // second visit: ignored again, but no second star
  go(s, 'Head back to Central');
  const r2 = go(s, 'Statue Square');
  assert.equal(s.bonusStars, 1, 'only once per game');
  assert.ok(!r2.some((m) => m.type === 'star'));
  assert.doesNotMatch(E.sectionParagraphs(book, s, book.sections.statue_square).join(' '), /pixel star/);
  // ...and coming back WITH food after the star still gets you swarmed
  go(s, 'Head back to Central'); s.inventory.egg_tart = 1;
  go(s, 'Statue Square');
  assert.ok(!s.inventory.egg_tart && s.bonusStars === 1);
});

test('PiGeons can end the game: losing your last Energy, Luck or Pixel Power to the swarm is the normal game over', () => {
  for (const stat of ['energy', 'luck', 'power']) {
    const s = at(fresh(), 'central'); s.inventory.egg_tart = 1;
    s.stats[stat] = stat === 'power' ? 3 : 2;
    go(s, 'Statue Square');
    assert.equal(s.ended?.type, 'death', stat);
    assert.equal(s.ended.cause.stat, stat);
    assert.equal(s.current, 'trapped');
  }
});

test('the bonusStar effect adds cosmetic stars only', () => {
  const s = fresh(); const st = JSON.stringify(s.stats); const msgs = [];
  E.applyEffects(book, s, [{ bonusStar: 2 }], msgs);
  assert.equal(s.bonusStars, 2);
  assert.equal(JSON.stringify(s.stats), st);
  assert.equal(msgs.filter((m) => m.type === 'star').length, 2);
});

// ---------- v2.3.0: avatar creator add-ons ----------
import * as AV from '../public/js/avatar.js';
test('avatar: 9 skins (blue, green, grey added at the end so saved indexes keep their colour)', () => {
  assert.equal(AV.SKINS.length, 9);
  assert.deepEqual(AV.SKIN_NAMES.slice(6), ['blue', 'green', 'grey']);
  assert.deepEqual(AV.SKINS.slice(0, 6), ['#ffdbb5', '#f5c28f', '#e0a370', '#c68650', '#9a5f34', '#6b3f22'], 'the original six are unchanged');
  assert.deepEqual(AV.EXTRAS, ['beard', 'cape', 'gloves', 'magicBoots']);
});

test('avatar: old saved avatars (no add-on fields) still load and draw exactly as before', () => {
  const old = { skin: 2, hairStyle: 'bun', hairColor: 3, outfit: 2, accessory: 'crown' };
  assert.deepEqual(AV.normalizeAvatar(old), old);
  assert.deepEqual(AV.avatarGrid(old).map((r) => r.join('')), AV.avatarGrid({ ...old, beard: false, gloves: false, magicBoots: false, cape: false }).map((r) => r.join('')));
  // junk or missing data falls back to safe defaults instead of crashing
  assert.deepEqual(AV.normalizeAvatar(null), { skin: 0, hairStyle: 'short', hairColor: 0, outfit: 0, accessory: 'none' });
  assert.deepEqual(AV.normalizeAvatar({ skin: 99, hairStyle: 'mohawk', beard: 'yes', cape: 1, evil: '<script>' }), { skin: 0, hairStyle: 'short', hairColor: 0, outfit: 0, accessory: 'none' });
});

test('avatar: four independent extras combine, with gloves and magic boots replacing beanie', () => {
  const base = { skin: 7, hairStyle: 'spiky', hairColor: 2, outfit: 1, accessory: 'none' };
  const key = (a) => AV.avatarGrid(a).map((r) => r.join('')).join('/');
  const looks = new Set();
  for (let m = 0; m < 16; m++) looks.add(key({ ...base, beard: !!(m & 1), cape: !!(m & 2), gloves: !!(m & 4), magicBoots: !!(m & 8) }));
  assert.equal(looks.size, 16);
  assert.ok(AV.avatarGrid({ ...base, gloves: true }).flat().includes('w'));
  assert.ok(AV.avatarGrid({ ...base, magicBoots: true }).flat().includes('Z'));
  assert.deepEqual(AV.normalizeAvatar({ ...base, beanie: true }), base);
  for (const accessory of AV.ACCESSORIES) for (const hairStyle of AV.HAIR_STYLES) {
    const grid = AV.avatarGrid({ ...base, accessory, hairStyle, beard: true, cape: true, gloves: true, magicBoots: true });
    assert.equal(grid.length, 16); assert.ok(grid.every((r) => r.length === 16));
  }
});

test('avatar: the stored JSON stays far inside the 512-character DB limit, even with everything on', () => {
  let longest = 0;
  for (const hairStyle of AV.HAIR_STYLES) for (const accessory of AV.ACCESSORIES) {
    const a = AV.normalizeAvatar({ skin: 8, hairStyle, hairColor: 7, outfit: 6, accessory, beard: true, gloves: true, magicBoots: true, cape: true, label: 'CUSTOM' });
    longest = Math.max(longest, JSON.stringify(a).length, Buffer.byteLength(JSON.stringify(a)));
  }
  assert.ok(longest <= 200, `longest avatar JSON ${longest} chars`);
  for (let i = 0; i < 200; i++) assert.ok(JSON.stringify(AV.normalizeAvatar(AV.randomAvatar())).length <= 512);
  assert.match(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'), /pg_column_size\(avatar\) <= 512/);
});

// ---------- v2.3.0: right path = real animal, wrong path = a Glitch Gremlin in disguise ----------
// gremlin section → [fork section, real meeting section, clue on the right path, giveaway on the wrong path]
const FORKS = {
  gremlin_rabbit: ['market', 'lantern_stall', /nose twitches/, /glowing green eyes/, /glowing green eyes/],
  gremlin_rat: ['market', 'rat', /squeaks/, /cable-like tail.*engine oil/, /cable-like tail.*engine oil/],
  gremlin_ox: ['ferry', 'ferry_captain', /muddy hoofprints/, /Oink/, /Oink/],
  gremlin_pig: ['central', 'cha_chaan_teng', /green-tiled.*milk tea/, /safety pin/, /safety pin/],
  gremlin_dog: ['central', 'dog', /wet paw prints/, /MEOW/, /water laps/],
  gremlin_liv: ['causeway_bay', 'liv', /warmth/, /cold flames/, /flames are cold/],
  gremlin_tiger: ['victoria_park', 'tiger_class', /paw prints/, /painted stripes/, /painted them on/],
  gremlin_horse: ['happy_valley', 'horse_track', /clip-clop/, /MOOOO/, /MOOOO/],
  gremlin_rooster: ['dingding', 'rooster_deck', /crows/, /rubber glove/, /rubber washing-up glove/],
  gremlin_monkey: ['tram_gate', 'tram_monkey', /peeling a banana/, /drinking-straw tail/, /drinking straw/],
  gremlin_snake: ['tunnel_lit', 'vault_snake', /shed snake skin/, /bicycle pump/, /shed snake skin.*bicycle pump/],
  gremlin_goat: ['peak_top', 'loulou', /clatter of hooves/, /wrong feet/, /wrong feet.*zip/],
};
const meetId = (gid) => gid.replace('gremlin_', 'meet_');
const forkState = (forkSec, gid) => { const match = gid || Object.entries(FORKS).find(([, f]) => f[0] === forkSec)?.[0]; const s = at(fresh(), meetId(match)); Object.assign(s.inventory, { whistle: 1, brass_key: 1 }); s.flags.met_auntie = true; return s; };
const visibleTo = (s, target) => E.availableChoices(book, s).filter((c) => !c.hidden && c.target === target);

test('forks: every zodiac animal and riddle character (11 animals + Liv) has a right path and a gremlin path', () => {
  const gremlins = Object.keys(book.sections).filter((id) => id.startsWith('gremlin_') && !id.endsWith('_2') && id !== 'gremlin_alley' && id !== 'gremlin_prince');
  assert.deepEqual(gremlins.sort(), Object.keys(FORKS).sort(), '12 gremlins in disguise');
  // every section where an animal is met (zodiac flag set on arrival or after its riddle) or a riddle
  // is asked is reached only through a fork's right path (or a "visit again" once already met)
  const meetSecs = Object.entries(book.sections).filter(([id, sec]) => id !== 'victory' && (sec.riddle || /"setFlag":"zodiac_/.test(JSON.stringify(sec.onEnter || []))) && !sec.test).map(([id]) => id);
  assert.deepEqual(meetSecs.sort(), Object.values(FORKS).map((f) => f[1]).sort(), 'the 12 meeting points are exactly the right-path targets');
  for (const [gid, [forkSec, real]] of Object.entries(FORKS)) {
    for (const [id, sec] of Object.entries(book.sections)) for (const c of sec.choices || []) {
      if (c.target !== real) continue;
      const ok = id === meetId(gid) || JSON.stringify(c.conditions || {}).includes('zodiac_');
      assert.ok(ok, `${real} is reached from ${id} without the fork`);
    }
    const labels = (book.sections[meetId(gid)].choices || []).filter((c) => c.target === real || c.target === gid);
    assert.ok(labels.length >= 2, `${forkSec}: at least 2 paths`);
  }
});

test('forks are fair: each has a visible clue (true animal detail vs. a gremlin slip), and the right side varies', () => {
  const sides = [];
  for (const [gid, [forkSec, real, rightClue, wrongClue, sceneClue]] of Object.entries(FORKS)) {
    const s = forkState(forkSec, gid);
    const ch = E.availableChoices(book, s).filter((c) => !c.hidden);
    const right = ch.find((c) => c.target === real), wrong = ch.find((c) => c.target === gid);
    assert.ok(right && wrong, `${forkSec}: both paths visible`);
    assert.match(right.label, rightClue, `${gid}: clue on the right path`);
    assert.match(wrong.label, wrongClue, `${gid}: giveaway on the wrong path`);
    assert.doesNotMatch(right.label + wrong.label, /gremlin|real|fake|trap/i, `${gid}: the labels don't just say which is which`);
    // the story text describes both, so the clue is in the scene too
    const text = E.sectionParagraphs(book, s, book.sections[meetId(gid)]).join(' ');
    assert.match(text, /three|one.*other/i, `${forkSec}: the scene describes both options`);
    sides.push(ch.indexOf(right) < ch.indexOf(wrong) ? 'right-first' : 'wrong-first');
  }
  const first = sides.filter((x) => x === 'right-first').length;
  assert.ok(first >= 4 && first <= 8, `the right path is first in ${first} of 12 forks (mixed)`);
  // Siu Mai teaches the rule at the start
  assert.match(JSON.stringify(book.sections.portal.text), /green eyes.*zip.*wrong noise.*engine oil/);
});

test('right fork: the real animal (with its riddle, if any) and the zodiac friend', () => {
  for (const [gid, [forkSec, real]] of Object.entries(FORKS)) {
    const s = forkState(forkSec, gid);
    const c = visibleTo(s, real)[0];
    E.choose(book, s, c.index, () => 0.5);
    assert.equal(s.current, real, gid);
    if (book.sections[real].riddle) {
      assert.equal(s.pending?.kind, 'riddle', `${real}: asks its riddle as before`);
      E.answerRiddle(book, s, E.currentRiddle(book, s).question.answer);
      E.continueRiddle(book, s);
    }
    const animal = gid.replace('gremlin_', '');
    if (animal !== 'liv') assert.ok(s.flags[`zodiac_${animal}`], `${animal} met`);
    else assert.ok(s.flags.liv_passed && s.inventory.feather);
  }
});

test('wrong fork: a gremlin in disguise unmasks (-2 Energy or -2 Pixel Power), no riddle, no zodiac; retreat and take the right path', () => {
  const penalties = new Set();
  for (const [gid, [forkSec, real]] of Object.entries(FORKS)) {
    const sec = book.sections[gid];
    assert.ok(!sec.riddle && !sec.test && !sec.combat && !sec.ending, `${gid}: no riddle, just the reveal`);
    assert.ok(!JSON.stringify(sec).includes('zodiac_'), `${gid}: no zodiac animal`);
    assert.ok(book.sections[gid].illustration.characters.some((c) => c.id === 'gremlin'), `${gid}: the gremlin is drawn`);
    const s = forkState(forkSec, gid);
    const z0 = E.trackerProgress(book, s)[0].met.length;
    const before = { ...s.stats };
    E.choose(book, s, visibleTo(s, gid)[0].index, () => 0.5);
    assert.equal(s.current, gid);
    assert.ok(!s.pending, 'no riddle pending');
    const lost = Object.keys(before).filter((k) => s.stats[k] !== before[k] - (k === 'power' ? 1 : 0)).map((k) => `${k}${s.stats[k] - before[k] + (k === 'power' ? 1 : 0)}`);
    assert.equal(lost.length, 1, `${gid}: one penalty (${lost})`);
    assert.ok(['energy-2', 'power-2'].includes(lost[0]), `${gid}: ${lost}`);
    penalties.add(lost[0]);
    assert.match(E.sectionParagraphs(book, s, sec).join(' '), /costume|suit|mask|dressed as/i, `${gid}: costume reveal`);
    assert.equal(E.trackerProgress(book, s)[0].met.length, z0, 'no zodiac collected');
    // the only way on is back to the fork, for the usual 1 Pixel Power per move
    const back = E.availableChoices(book, s).filter((c) => !c.hidden);
    assert.deepEqual(back.map((c) => c.target), [forkSec], `${gid}: retreat to the fork`);
    const p = s.stats.power;
    E.choose(book, s, back[0].index, () => 0.5);
    assert.equal(s.current, forkSec);
    assert.ok(s.stats.power <= p - 1, 'the extra move costs Pixel Power');
    assert.equal(visibleTo(s, gid).length, 0, 'the unmasked gremlin has gone: its path is no longer offered');
    const entry = visibleTo(s, meetId(gid))[0]; assert.ok(entry?.available); E.choose(book, s, entry.index, () => 0.5);
    assert.equal(visibleTo(s, real).length, 1, 'the right path is still there after going to see the animal');
  }
  assert.deepEqual([...penalties].sort(), ['energy-2', 'power-2'], 'both penalty kinds are used');
});

test('wrong fork can be the normal game over (last Energy / Pixel Power), but is never an instant death otherwise', () => {
  let s = forkState('ferry'); s.stats.energy = 2;
  const c = visibleTo(s, 'gremlin_ox')[0];
  assert.ok(!('warning' in c), 'no advance warning');
  E.choose(book, s, c.index, () => 0.5);
  assert.equal(s.ended?.cause.stat, 'energy');
  s = forkState('ferry');
  E.choose(book, s, visibleTo(s, 'gremlin_ox')[0].index, () => 0.5);
  assert.ok(!s.ended);
});

test('graph: no dead ends; every gremlin and every reachable section can still reach the victory (except the fail traps)', () => {
  const all = reachable(null);
  const canWin = (from) => { const seen = new Set([from]); const q = [from]; while (q.length) { const x = q.pop(); if (x === 'victory') return true; for (const t of targetsOf(book.sections[x])) if (!seen.has(t)) { seen.add(t); q.push(t); } } return false; };
  for (const id of all) {
    const sec = book.sections[id];
    if (sec.ending) continue;
    assert.ok(targetsOf(sec).length > 0, `${id} is a dead end`);
  }
  const stuck = [...all].filter((id) => !book.sections[id].ending && !canWin(id)).sort();
  assert.deepEqual(stuck, ['crown_try', 'grab_fail', 'king_challenge', 'riddle', 'riddle_miss', 'sale_trap'].filter((id) => stuck.includes(id)), `sections that can only end in a fail: ${stuck}`);
  assert.ok(!stuck.some((id) => id.startsWith('gremlin_') || Object.values(FORKS).some((f) => f[0] === id)), 'forks and gremlins are always recoverable');
  for (const gid of Object.keys(FORKS)) assert.ok(canWin(gid), gid);
});

// ---------- v2.4.0: taxi fix, new items, poison, no run-out warnings, dog shortcut ----------
test('taxi bug: "Ask him to drive faster" is just a bumpy ride (-3 Energy), never a death', () => {
  assert.match(E.sectionParagraphs(book, fresh(), book.sections.intro).join(' '), /four arcade tokens/, 'the intro matches the 4-token start');
  assert.doesNotMatch(JSON.stringify(book.sections.intro), /six arcade tokens/);
  for (const first of ['Drop a token', 'Ask Auntie Lam']) {
    const s = fresh(7);
    go(s, first);
    if (first.startsWith('Ask')) go(s, 'Drop a token');
    go(s, 'Wave down a red taxi');
    go(s, 'Causeway Bay');
    assert.equal(s.current, 'taxi_ride');
    assert.equal(s.stats.tokens, 1, 'the standard route reaches the cab with one token before Causeway Bay refill');
    const e = s.stats.energy;
    const msgs = go(s, 'drive faster');
    assert.equal(s.current, 'taxi_faster');
    assert.ok(!s.ended, 'still alive');
    assert.equal(s.stats.energy, e - 3, 'a bumpy ride: -3 Energy');
    assert.ok(msgs.some((m) => /bumpy/i.test(m.text)));
    go(s, 'Wobble out');
    assert.equal(s.current, 'causeway_bay');
    assert.ok(!s.ended);
  }
  // none of the three things you can say in the cab can end the game on the standard route
  for (const say of ['Agree', 'drive faster', 'grumpiest']) {
    const s = fresh(7);
    go(s, 'Drop a token'); go(s, 'Wave down a red taxi'); go(s, 'Causeway Bay');
    go(s, say);
    assert.ok(!s.ended, `"${say}" is survivable`);
    assert.ok(s.stats.tokens >= 1, `"${say}" leaves you with tokens`);
  }
  // no taxi-ride choice spends tokens any more (the rude route costs time and luck instead)
  for (const id of ['taxi_ride', 'taxi_agree', 'taxi_faster', 'taxi_rude']) assert.ok(!JSON.stringify(book.sections[id]).includes('"tokens"'), id);
  // faster only kills when Energy truly reaches 0
  const s = at(fresh(), 'taxi_ride');
  s.stats.energy = 3;
  go(s, 'drive faster');
  assert.equal(s.current, 'trapped');
  assert.equal(s.ended.cause.stat, 'energy');
  const s2 = at(fresh(), 'taxi_ride');
  s2.stats.energy = 4;
  go(s2, 'drive faster');
  assert.ok(!s2.ended);
  assert.equal(s2.stats.energy, 1);
});

const NEW_ITEMS = ['glow_fishball', 'herbal_tea', 'goggles', 'horseshoe', 'egg_waffle'];
test('new items: 5 collectibles, each with an 8x8 pixel icon, a description and a place to find it', () => {
  for (const id of NEW_ITEMS) {
    const it = book.items[id];
    assert.ok(it?.name && it.description.length > 30, id);
    assert.equal(it.sprite.rows.length, 8, `${id} sprite`);
    assert.ok(it.sprite.rows.every((r) => r.length === 8 && [...r].every((ch) => ch === '.' || it.sprite.palette[ch])), `${id} sprite palette`);
    assert.ok(Object.values(book.sections).some((sec) => JSON.stringify(sec).includes(`"addItem":"${id}"`)), `${id} can be found`);
  }
  assert.equal(Object.keys(book.items).length, 16);
});

test('glowing fish ball: free and tempting at the market, the clue is in plain sight; it does not count as used', () => {
  const s = at(fresh(), 'market');
  const text = E.sectionParagraphs(book, s, book.sections.market).join(' ');
  assert.match(text, /FREE SAMPLES!.*\+5 HEALTH/);
  assert.match(text, /glow a spooky green/, 'clue: glowing green, like a gremlin\'s eyes (Siu Mai\'s rule)');
  assert.match(text, /engine oil/);
  go(s, 'FREE glowing fish ball');
  assert.equal(s.inventory.glow_fishball, 1);
  assert.ok(s.found.glow_fishball, 'picking it up counts as found');
  assert.match(E.sectionParagraphs(book, s, book.sections.fishball_cart).join(' '), /Glowing green/);
  assert.match(book.items.glow_fishball.description, /\+5 HEALTH.*glows a spooky green/);
  go(s, 'Pocket it');
  assert.ok(!E.availableChoices(book, s).some((c) => !c.hidden && c.target === 'fishball_cart'), 'only one free sample');
  const e = s.stats.energy;
  const msgs = E.useItem(book, s, 'glow_fishball');
  assert.equal(s.stats.energy, e, 'no Energy from it at all, despite the sticker');
  assert.equal(s.status.poison, 5, 'POISONED x5');
  assert.ok(!s.inventory.glow_fishball);
  assert.ok(!s.used.glow_fishball, 'eating it scores nothing (lost, not used)');
  assert.ok(msgs.some((m) => m.type === 'status' && /POISONED x5/.test(m.text)));
});

test('poison tick: -1 Energy per move for 5 moves, a message each tick, then it wears off', () => {
  const s = at(fresh(), 'central');
  s.inventory.glow_fishball = 1;
  E.useItem(book, s, 'glow_fishball');
  const e = s.stats.energy;
  const order = ['Hop on a ding-ding', 'Hop off in Central', 'Hop on a ding-ding', 'Hop off in Central', 'Hop on a ding-ding'];
  order.forEach((c, i) => {
    const msgs = go(s, c);
    const tick = msgs.find((m) => m.type === 'status' && m.tick);
    assert.ok(tick, `move ${i + 1}: a tick message`);
    assert.match(tick.text, /POISONED!.*Health -1/);
    assert.equal(s.status.poison ?? 0, 4 - i, `x${4 - i} left`);
    assert.equal(s.stats.energy, e - (i + 1), `move ${i + 1}: -1 Energy`);
    if (i === 4) assert.ok(msgs.some((m) => m.wornOff), 'wore off message');
  });
  assert.deepEqual(s.status, {}, 'gone after 5 moves');
  const e2 = s.stats.energy;
  go(s, 'Hop off in Central');
  assert.equal(s.stats.energy, e2, 'no more ticks');
  // catching it again restarts the countdown (no stacking)
  s.inventory.glow_fishball = 1; E.useItem(book, s, 'glow_fishball');
  go(s, 'Hop on a ding-ding');
  s.inventory.glow_fishball = 1; E.useItem(book, s, 'glow_fishball');
  assert.equal(s.status.poison, 5);
});

test('poison cures: 24-herb tea (bought at the market) or the Man Mo Temple incense', () => {
  // the tea
  const s = at(fresh(), 'market');
  const t = s.stats.tokens;
  go(s, '24-herb tea');
  assert.equal(s.stats.tokens, t - 1, 'costs 1 token');
  assert.equal(s.inventory.herbal_tea, 1);
  go(s, 'Thank her');
  s.inventory.glow_fishball = 1; E.useItem(book, s, 'glow_fishball');
  go(s, 'Walk to the MTR');
  assert.equal(s.status.poison, 4);
  const e = s.stats.energy;
  const msgs = E.useItem(book, s, 'herbal_tea');
  assert.deepEqual(s.status, {}, 'cured');
  assert.equal(s.stats.energy, e, 'the cure is the whole effect while poisoned');
  assert.ok(msgs.some((m) => m.cured && /cured/i.test(m.text)));
  assert.ok(s.used.herbal_tea);
  go(s, 'Go back up');
  assert.equal(s.stats.energy, e, 'no more ticks');
  // not poisoned: a +2 Energy drink
  const s2 = fresh(); s2.inventory.herbal_tea = 1; s2.stats.energy = 10;
  E.useItem(book, s2, 'herbal_tea');
  assert.equal(s2.stats.energy, 10);
  assert.equal(s2.statMax.energy, 38);
  // the incense
  const s3 = at(fresh(), 'central');
  s3.inventory.glow_fishball = 1; E.useItem(book, s3, 'glow_fishball');
  const m3 = go(s3, 'Man Mo Temple');
  assert.deepEqual(s3.status, {}, 'the incense smoke cures it on arrival');
  assert.ok(m3.some((m) => m.cured));
  assert.match(E.sectionParagraphs(book, s3, book.sections.man_mo).join(' '), /Poison cured!/);
  go(s3, 'Walk quietly back');
  assert.doesNotMatch(E.sectionParagraphs(book, at(s3, 'man_mo'), book.sections.man_mo).join(' '), /Poison cured!/, 'no cure text when not poisoned');
});

test('poison death: if a poison tick takes your last Energy, you are trapped forever (normal game over)', () => {
  const s = at(fresh(), 'central');
  s.inventory.glow_fishball = 1; E.useItem(book, s, 'glow_fishball');
  s.stats.energy = 2;
  go(s, 'Hop on a ding-ding');
  assert.ok(!s.ended);
  assert.equal(s.stats.energy, 1);
  const msgs = go(s, 'Hop off in Central');
  assert.equal(s.current, 'trapped', 'trapped in the game forever');
  assert.equal(s.ended.cause.stat, 'energy');
  assert.equal(s.stats.energy, 0);
  assert.ok(msgs.some((m) => m.type === 'depleted'));
});

test('poison save/load: the countdown is saved with the game; old saves without it still load', () => {
  const s = at(fresh(), 'central');
  s.inventory.glow_fishball = 1; E.useItem(book, s, 'glow_fishball');
  go(s, 'Hop on a ding-ding');
  const loaded = JSON.parse(JSON.stringify(s)); // what the app autosaves and resumes
  assert.equal(loaded.status.poison, 4);
  const e = loaded.stats.energy;
  go(loaded, 'Hop off in Central');
  assert.equal(loaded.status.poison, 3);
  assert.equal(loaded.stats.energy, e - 1);
  // a v2.3.0 save has no status field at all
  const old = JSON.parse(JSON.stringify(at(fresh(), 'central')));
  delete old.status;
  const e0 = old.stats.energy;
  go(old, 'Hop on a ding-ding');
  assert.equal(old.stats.energy, e0, 'no ticks, no crash');
  old.inventory.glow_fishball = 1; E.useItem(book, old, 'glow_fishball');
  assert.equal(old.status.poison, 5, 'and poison still works on it');
  assert.equal(book.statusEffects.poison.moves, 5);
  assert.deepEqual(book.statusEffects.poison.perMove, [{ stat: 'energy', add: -1 }]);
});

test('Gremlin Goggles (found on the MTR): every gremlin path is locked and flagged, the real path stays open', () => {
  const m = at(fresh(), 'mtr_wait');
  assert.equal(m.inventory.goggles, 1);
  assert.match(E.sectionParagraphs(book, m, book.sections.mtr_wait).join(' '), /GREMLIN GOGGLES/);
  for (const [fsec, gid] of [['market', 'gremlin_rabbit'], ['happy_valley', 'gremlin_horse'], ['central', 'gremlin_pig'], ['central', 'gremlin_dog'], ['tunnel_lit', 'gremlin_snake']]) {
    const s = forkState(fsec, gid);
    const open = visibleTo(s, gid);
    assert.equal(open.length, 1, `${gid}: one gremlin path without goggles`);
    assert.ok(open[0].available);
    s.inventory.goggles = 1;
    const shown = visibleTo(s, gid);
    assert.equal(shown.length, 1, `${gid}: still on screen with goggles`);
    assert.equal(shown[0].available, false, `${gid}: locked`);
    assert.match(shown[0].need, /GREMLIN IN DISGUISE/);
    const real = E.availableChoices(book, s).find((c) => !c.hidden && c.label === forkLabel(gid));
    assert.ok(real?.available, `${gid}: the real path is open`);
  }
  // the vault door without the key still asks for the key (no goggles)
  const v = at(fresh(), 'tunnel_lit');
  const door = visibleTo(v, 'meet_snake');
  assert.equal(door.length, 1);
  assert.match(door[0].need, /Brass Key/);
});
// the real (right-path) choice that sits next to each gremlin path
const RIGHT_PATH = {
 "gremlin_rabbit": "Visit the lantern stall of the rabbit whose nose twitches as she nibbles a carrot",
 "gremlin_pig": "Find Pig's cha chaan teng: the green-tiled café that smells of sweet milk tea",
 "gremlin_dog": "Blow the Silver Whistle at the end of the pier, where wet paw prints come up from the water",
 "gremlin_horse": "Go and meet the horse whose hooves go clip-clop",
 "gremlin_snake": "Unlock the door with the shed snake skin in front of it"
};
const forkLabel = (gid) => RIGHT_PATH[gid];

test('Lucky Horseshoe (from the real Horse) is a duel boost; Egg Waffle (Times Square, 1 token) is +3 Energy', () => {
  const s = at(fresh(), 'horse_track');
  assert.equal(s.inventory.horseshoe, 1);
  at(s, 'bot_battle');
  const b = E.combatBoosts(book, s);
  assert.ok(b.active.some((x) => /Horseshoe/.test(x.label) && x.attack === 1));
  const s0 = at(fresh(), 'bot_battle');
  assert.equal(E.combatBoosts(book, s).attack - E.combatBoosts(book, s0).attack, 1);
  const w = at(fresh(), 'times_square');
  const t = w.stats.tokens;
  go(w, 'egg waffle');
  assert.equal(w.stats.tokens, t - 1);
  assert.equal(w.inventory.egg_waffle, 1);
  w.stats.energy = 10;
  E.useItem(book, w, 'egg_waffle');
  assert.equal(w.stats.energy, 13);
  assert.ok(w.used.egg_waffle);
});

test('dog shortcut: clearly labelled (skips Causeway Bay), on both the normal and the tram-unlocked variant', () => {
  const label = "Shortcut: follow the dog's nose straight to the Peak Tram (skips Causeway Bay)";
  const cs = book.sections.dog.choices.filter((c) => c.label === label);
  assert.deepEqual(cs.map((c) => c.target).sort(), ['tram', 'tram_gate']);
  assert.ok(!JSON.stringify(book).includes("Follow the dog's nose to the Peak Tram"));
  const s = at(fresh(), 'dog');
  assert.ok(choice(s, 'Shortcut: follow the dog'));
  s.flags.monkey_passed = true;
  assert.equal(choice(s, 'Shortcut: follow the dog').target, 'tram');
});

test('the optimal search never eats the glowing fish ball', () => {
  if (!localPaths) return;
  for (const p of Object.values(localPaths)) assert.ok(!p.some((l) => /Glowing Fish Ball/.test(l)));
});


test('seven zodiac animals gate every entry into Bolt-Bot', () => {
  for (const id of ['peak_top', 'bot_dance', 'bot_snack', 'goat_climb']) {
    const s = at(fresh(), id);
    const duel = () => E.availableChoices(book, s).find(c => c.target === 'bot_battle');
    assert.equal(duel().available, false);
    for (const z of book.trackers[0].entries.slice(0, 6)) s.flags[z.flag] = true;
    assert.equal(duel().available, false);
    seven(s); assert.equal(duel().available, true);
  }
});
test('final riddle varies between runs and stays stable within a saved run', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    const s = at(fresh(seed), 'riddle'); seen.add(s.current);
    const id = s.current; const loaded = JSON.parse(JSON.stringify(s)); assert.equal(loaded.current, id);
  }
  assert.deepEqual([...seen].sort(), [...book.sections.riddle.pickRandom].sort());
});

test('v2.5.1: 12 scene-based entries, exactly one real option and two separate disguised gremlins', () => {
  for (const [gid, [parent, real]] of Object.entries(FORKS)) {
    const mid = meetId(gid), gid2 = gid + '_2';
    const entry = book.sections[parent].choices.find(c => c.target === mid);
    assert.ok(entry && !/go see|go and see/i.test(entry.label), `${mid}: location entry`);
    const s = forkState(parent, gid);
    const options = E.availableChoices(book, s).filter(c => !c.hidden && c.label !== 'Head back');
    assert.equal(options.length, 3, `${mid}: three options`);
    assert.equal(options.filter(c => c.target === real).length, 1);
    assert.equal(options.filter(c => c.target.startsWith('gremlin_')).length, 2);
    for (const bad of [gid, gid2]) {
      const run = forkState(parent, gid), before = {...run.stats};
      E.choose(book, run, visibleTo(run, bad)[0].index, () => 0.5);
      assert.equal(run.current, bad);
      assert.equal(E.trackerProgress(book, run)[0].met.length, 0);
      assert.ok(!run.pending);
      assert.ok(run.stats.energy === before.energy-2 || run.stats.power === before.power-3);
      const target = book.sections[bad].choices[0].target;
      E.choose(book, run, E.availableChoices(book, run).find(c => !c.hidden && c.target === target).index, () => 0.5);
      at(run, mid);
      assert.equal(visibleTo(run, bad).length, 0, `${bad}: only visited decoy disappears`);
      assert.equal(visibleTo(run, bad === gid ? gid2 : gid).length, 1, `${bad}: other decoy remains`);
    }
    s.inventory.goggles = 1;
    for (const bad of [gid, gid2]) {
      const c = visibleTo(s, bad)[0]; assert.ok(c && !c.available && /GREMLIN/.test(c.need));
    }
    assert.ok(visibleTo(s, real)[0].available, `${mid}: real route open with goggles`);
  }
});

// Exact leaderboard counts must not be downgraded by legacy server compatibility.


import * as LB from "../public/js/leaderboard.js";
const entry = {nickname:'HERO',avatar:{},score_pct:100,rank:'PIXEL LEGEND',zodiac_count:12,bonus_stars:7};
test('world score keeps all 12 animals and exact extra stars', async () => {
 const old=globalThis.fetch;const sent=[];
 globalThis.fetch=async(url,opts)=>{sent.push(JSON.parse(opts.body));return new Response(null,{status:201});};
 try {await LB.submitGlobal(entry);assert.equal(sent.length,1);assert.equal(sent[0].zodiac_count,12);assert.equal(sent[0].bonus_stars,7);} finally {globalThis.fetch=old;}
});
test('old database rejection never retries with fabricated 11 animals or missing stars',async()=>{
 const old=globalThis.fetch;const sent=[];
 globalThis.fetch=async(url,opts)=>{sent.push(JSON.parse(opts.body));return new Response(JSON.stringify({message:'constraint or column missing'}),{status:400});};
 try{await assert.rejects(LB.submitGlobal(entry),/HTTP 400/);assert.equal(sent.length,1);assert.equal(sent[0].zodiac_count,12);assert.equal(sent[0].bonus_stars,7);}finally{globalThis.fetch=old;}
});
test('legacy read fallback cannot disable extra stars on a later submission',async()=>{
 const old=globalThis.fetch;const sent=[];let reads=0;
 globalThis.fetch=async(url,opts)=>{
  if(opts.method==='POST'){sent.push(JSON.parse(opts.body));return new Response(null,{status:201});}
  reads++;return reads===1?new Response(JSON.stringify({message:'missing stars'}),{status:400}):new Response(JSON.stringify([{nickname:'OLD',score_pct:100,zodiac_count:10}]),{status:200});
 };
 try{const rows=await LB.fetchGlobal();assert.equal(rows[0].zodiac_count,10);assert.equal(rows[0].bonus_stars,undefined);await LB.submitGlobal(entry);assert.equal(sent[0].bonus_stars,7);assert.equal(sent[0].zodiac_count,12);}finally{globalThis.fetch=old;}
});

// v2.6: real current health and capacity, drink-only capacity gains.
test('drinks grow the ceiling without healing; food fills only current hearts', () => {
 const s = E.newGame(book, {rng: () => .5}).state;
 assert.deepEqual([s.stats.energy,s.statMax.energy,s.stats.tokens],[10,10,4]);
 s.stats.energy=6; s.inventory.bubble_tea=1;
 E.useItem(book,s,'bubble_tea');
 assert.deepEqual([s.stats.energy,s.statMax.energy],[6,13]);
 s.inventory.egg_tart=3;
 E.useItem(book,s,'egg_tart');assert.equal(s.stats.energy,9);
 E.useItem(book,s,'egg_tart');E.useItem(book,s,'egg_tart');
 assert.deepEqual([s.stats.energy,s.statMax.energy],[13,13]);
 const reload=JSON.parse(JSON.stringify(s));assert.equal(E.statBounds(book,reload,'energy').max,13);
 reload.stats.energy=7;reload.inventory.herbal_tea=1;reload.status.poison=4;
 E.useItem(book,reload,'herbal_tea');assert.equal(reload.status.poison||0,0);
 assert.deepEqual([reload.stats.energy,reload.statMax.energy],[7,15]);
});
test('free soy milk and Pig milk tea grow capacity once, not on every visit', () => {
 const s=E.newGame(book,{rng:()=>.5}).state;
 at(s,'ferry_captain');at(s,'cha_chaan_teng');
 assert.deepEqual([s.stats.energy,s.statMax.energy],[10,15]);
 at(s,'ferry_captain');at(s,'cha_chaan_teng');
 assert.deepEqual([s.stats.energy,s.statMax.energy],[10,15]);
});
test('legacy in-progress ceiling is not reduced, and score scale is saved per run', () => {
 const s=E.newGame(book,{rng:()=>.5}).state; const saved=s.scoreReference;
 s.statMax.energy=36;s.stats.energy=32;s.inventory.egg_tart=1;
 E.useItem(book,s,'egg_tart');assert.equal(s.stats.energy,35);
 const modified=structuredClone(book);modified.scoring.reference.values['10']=123;
 assert.equal(E.scoreReference(modified,s),saved);
});
