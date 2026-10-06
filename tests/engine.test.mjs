import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as E from '../public/js/engine.js';
import { randomPlay, balanceReport, routes } from './sim.mjs';
import { followPath } from '../scripts/optimal.mjs';

const book = JSON.parse(readFileSync(new URL('../public/data/neon-dragon.json', import.meta.url), 'utf8'));
const refFile = new URL('../scripts/score-reference.json', import.meta.url);
const ref = existsSync(refFile) ? JSON.parse(readFileSync(refFile, 'utf8')) : null;
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

test('new game: Energy 12, Pixel Power 40 (no cap), Luck 1d6+6, 6 tokens', () => {
  const s = fresh(3);
  assert.equal(s.current, 'intro');
  assert.equal(s.stats.energy, 12);
  assert.equal(s.stats.power, 40);
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
  assert.equal(s.stats.power, 39);
  s.stats.energy = 5;
  E.useItem(book, s, 'egg_tart');
  assert.equal(s.stats.energy, 8, 'egg tart = +3 Energy');
  assert.equal(s.stats.power, 39);
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

test('luck tests use up 1 Luck whether you pass or fail; Luck 0-1 always fails', () => {
  for (const [rng, pass] of [[low, true], [high, false]]) {
    const s = at(fresh(), 'tiger_taichi');
    s.stats.luck = 9;
    const r = E.rollTest(book, s, rng);
    assert.equal(r.success, pass);
    assert.equal(s.stats.luck, 8);
  }
  const s = at(fresh(), 'tiger_taichi');
  s.stats.luck = 1;
  assert.equal(E.rollTest(book, s, low).success, false, 'even double 1 fails with Luck 1');
  assert.equal(s.stats.luck, 0);
  assert.ok(!s.ended, 'Luck 0 is not game over');
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
  for (let q = 0; q < 2; q++) {
    const r = E.currentRiddle(book, s);
    assert.equal(E.answerRiddle(book, s, r.question.answer).correct, true);
    E.continueRiddle(book, s);
  }
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
  assert.equal(E.currentRiddle(book, s).index, 1);
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

test('the zodiac: 11 animals, Dragon busy with the moon, each gives +2 Pixel Power once', () => {
  const z = book.trackers.find((t) => t.id === 'zodiac');
  assert.equal(z.entries.length, 11);
  assert.ok(!z.entries.some((e) => /dragon/i.test(e.id)));
  assert.match(JSON.stringify(book.sections.lantern_stall), /moon/i);
  const s = at(fresh(), 'happy_valley');
  const p = s.stats.power;
  assert.equal(p, 42);
  go(s, 'Cheer');
  at(s, 'happy_valley');
  assert.equal(s.stats.power, p - 1 + 0, 'second visit: no extra bonus');
});

test('exactly one route can collect all 11 zodiac animals', () => {
  const flags = book.trackers[0].entries.map((e) => e.flag);
  const all = routes(book).filter((r) => flags.every((f) => r.flags.has(f)));
  assert.equal(all.length, 1);
  assert.ok(all[0].route.includes('vault') && all[0].route.includes('ferry_captain'));
});

test('score: optimal path replays to a win with all 11 animals, ZODIAC MASTER and exactly 100%', { skip: !ref && 'run scripts/score-reference.mjs first' }, () => {
  for (const [start, path] of Object.entries(ref.paths)) {
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

test('random playthroughs reach every ending, including trapped (Energy and Pixel Power) and out of tokens', () => {
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
  assert.deepEqual([...causes].sort(), ['energy', 'power', 'tokens']);
});

test('balance: random play wins 15-25% of the time; wanderers run out of Pixel Power', () => {
  const rep = balanceReport(book, 4000);
  assert.ok(rep.winRate >= 0.15 && rep.winRate <= 0.25, `win rate ${rep.winRate}`);
  assert.ok(rep.causes.power > 0);
  assert.ok(rep.winMoves.avg >= 20 && rep.winMoves.avg <= 40, `avg winning moves ${rep.winMoves.avg}`);
});
