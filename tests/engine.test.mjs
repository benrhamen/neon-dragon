import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as E from '../public/js/engine.js';
import * as V from '../public/js/voucher.js';
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
const fresh = (seed = 1) => E.newGame(book, { rng: E.makeRng(seed), playerName: 'MAX' }).state;
// jump straight to a section (as if the player just arrived there)
const at = (state, id) => { E.enterSection(book, state, id, [], () => 0.5); return state; };
const choice = (state, text) => {
  const c = E.availableChoices(book, state).find((x) => !x.hidden && x.available && x.label.includes(text));
  assert.ok(c, `choice "${text}" not available in ${state.current}`);
  return c;
};
const go = (state, text, rng = () => 0.5) => E.choose(book, state, choice(state, text).index, rng);
const low = () => 0; // dice always roll 1s
const high = () => 0.99; // dice always roll 6s

test('book is valid and lint-clean, with 92 sections and 11 endings', () => {
  const lint = E.lintBook(book);
  assert.deepEqual(lint.errors, []);
  assert.deepEqual(lint.warnings, []);
  assert.equal(Object.keys(book.sections).length, 92);
  assert.equal(lint.endings.length, 11);
});

test('new game: Energy 12, Pixel Power 58 (no cap), Luck 1d6+6, 6 tokens', () => {
  const s = fresh(3);
  assert.equal(s.current, 'intro');
  assert.equal(s.stats.energy, 12);
  assert.equal(s.stats.power, 58);
  assert.ok(s.stats.luck >= 7 && s.stats.luck <= 12);
  assert.equal(s.stats.tokens, 6);
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
  assert.equal(s.stats.power, 57);
  s.stats.energy = 5;
  E.useItem(book, s, 'egg_tart');
  assert.equal(s.stats.energy, 8, 'egg tart = +3 Energy');
  assert.equal(s.stats.power, 57);
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
  const s = at(fresh(), 'taxi_ride');
  s.stats.tokens = 2;
  go(s, 'grumpiest');
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
  // a choice into a luck test at Luck 1 carries the ⚠ warning
  const s2 = at(fresh(), 'victoria_park');
  s2.stats.luck = 1;
  const warned = E.availableChoices(book, s2).filter((c) => book.sections[c.target]?.test?.againstStat === 'luck');
  assert.ok(warned.length && warned.every((c) => c.warning?.stat === 'luck'), 'choices into luck tests warn at Luck 1');
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
    s.stats.energy = 12; s.stats.tokens = 6; s.stats.luck = 9;
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

test('PLAY AGAIN vouchers: self-checking codes, typo-tolerant input, +2 tokens for the next game', () => {
  const codes = new Set();
  const r = E.makeRng(7);
  for (let i = 0; i < 2000; i++) {
    const c = V.makeVoucherCode(r);
    assert.match(c, /^ND-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(V.normalizeVoucher(c), c);
    assert.equal(V.normalizeVoucher(c.toLowerCase().replace(/-/g, ' ')), c, 'case and separators do not matter');
    assert.equal(V.normalizeVoucher(c.slice(3)), c, 'the ND- prefix is optional');
    codes.add(c);
  }
  assert.ok(codes.size > 1990, 'codes are (practically) unique');
  const c = V.makeVoucherCode(E.makeRng(1));
  const swapped = c.slice(0, 3) + (c[3] === 'A' ? 'B' : 'A') + c.slice(4);
  assert.equal(V.normalizeVoucher(swapped), null, 'a changed character is rejected');
  for (const bad of ['', 'HELLO', 'ND-0000-0000', 'ND-ABCD-EFG']) assert.equal(V.normalizeVoucher(bad), null, bad);
  const s = E.newGame(book, { rng: E.makeRng(3), playerName: 'MAX', bonusEffects: V.VOUCHER_BONUS, bonusLabel: 'voucher ' + c }).state;
  assert.equal(s.stats.tokens, 8, 'a redeemed voucher starts the game with 8 tokens');
  assert.equal(fresh(3).stats.tokens, 6, 'without one: 6');
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

test('choices that would end the game are flagged with a warning (including what happens on arrival)', () => {
  const s = at(fresh(), 'tram');
  s.stats.energy = 4;
  const dark = choice(s, 'Feel your way');
  assert.equal(dark.warning?.stat, 'energy');
  assert.equal(choice(s, 'Ride the tram back down').warning, null);
});

test('riddle: all correct passes, meets the animal (+2 Pixel Power) and earns tokens', () => {
  const s = at(fresh(), 'tram_monkey');
  s.stats.power = 20;
  const tokens = s.stats.tokens;
  const r = E.currentRiddle(book, s);
  assert.equal(r.total, 1, 'one riddle per character');
  assert.equal(E.answerRiddle(book, s, r.question.answer).correct, true);
  E.continueRiddle(book, s);
  assert.equal(s.current, 'tram');
  assert.ok(s.flags.zodiac_monkey);
  assert.equal(s.stats.power, 20 + 2 - 1, '+2 for meeting the Monkey, -1 for the move');
  assert.ok(s.stats.tokens >= tokens);
});

test('riddle: wrong answer, pay 2 tokens', () => {
  const s = at(fresh(), 'liv');
  const t = s.stats.tokens;
  const r = E.currentRiddle(book, s);
  const wrong = (r.question.answer + 1) % r.question.options.length;
  assert.equal(E.answerRiddle(book, s, wrong).correct, false);
  const pens = E.riddlePenalties(book, s);
  assert.equal(pens.length, 2);
  assert.ok(pens[0].available);
  E.payRiddlePenalty(book, s, 0);
  assert.equal(s.stats.tokens, t - 2);
  E.continueRiddle(book, s);
  assert.equal(s.current, 'causeway_bay', 'Liv asks just one riddle; after paying you still get past');
  assert.ok(s.flags.liv_passed);
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

test('every riddle character (Liv, Loulou and the zodiac animals) asks exactly ONE riddle from the pool', () => {
  const riddleSecs = Object.entries(book.sections).filter(([, sec]) => sec.riddle);
  assert.deepEqual(riddleSecs.map(([id]) => id).sort(), ['liv', 'loulou', 'tram_monkey', 'vault_snake']);
  for (const [id, sec] of riddleSecs) {
    assert.equal(sec.riddle.draw, 1, id);
    assert.equal(sec.riddle.questions, undefined, id);
    const s = at(fresh(), id);
    const r = E.currentRiddle(book, s);
    assert.equal(r.total, 1);
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
  assert.equal(E.riddlePenalties(book, s2)[0].warning?.stat, 'tokens', 'the UI warns: last tokens');
  E.payRiddlePenalty(book, s2, 0);
  assert.equal(s2.current, 'out_of_tokens');
  assert.equal(s2.ended.cause.stat, 'tokens');
});

test('riddle: retreat before answering costs nothing but the move', () => {
  for (const id of ['liv', 'tram_monkey', 'loulou', 'vault_snake']) {
    const s = at(fresh(), id);
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
  const s = at(fresh(), 'happy_valley');
  const p = s.stats.power;
  assert.equal(p, 60);
  go(s, 'Cheer');
  at(s, 'happy_valley');
  assert.equal(s.stats.power, p - 1 + 0, 'second visit: no extra bonus');
});

test('exactly one route can collect all 12 zodiac animals (it ends at the victory)', () => {
  const flags = book.trackers[0].entries.map((e) => e.flag);
  const all = routes(book).filter((r) => flags.every((f) => r.flags.has(f)));
  assert.equal(all.length, 1);
  assert.ok(all[0].route.includes('vault') && all[0].route.includes('ferry_captain') && all[0].ending === 'victory');
});

test('score: optimal path replays to a win with all 12 animals, ZODIAC MASTER and exactly 100%', { skip: !localPaths && 'needs the local route file (run npm run score:ref)' }, () => {
  for (const [start, path] of Object.entries(localPaths)) {
    const s = followPath(book, path, { startValue: +start });
    assert.equal(s.ended?.type, 'win');
    const z = E.trackerProgress(book, s).find((t) => t.id === 'zodiac');
    assert.ok(z.complete, 'optimal path meets every zodiac animal');
    assert.ok(E.sectionParagraphs(book, s, book.sections.victory).some((p) => /ZODIAC MASTER/.test(p)));
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
  assert.ok(wins > 100);
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
  assert.deepEqual([...seen].sort(), endings.sort());
  assert.deepEqual([...causes].sort(), ['energy', 'luck', 'power', 'tokens']);
});

test('balance: random play wins 15-25% of the time; wanderers run out of Pixel Power', () => {
  const rep = balanceReport(book, 4000);
  assert.ok(rep.winRate >= 0.15 && rep.winRate <= 0.25, `win rate ${rep.winRate}`);
  assert.ok(rep.causes.power > 0);
  assert.ok(rep.winMoves.avg >= 20 && rep.winMoves.avg <= 40, `avg winning moves ${rep.winMoves.avg}`);
});
