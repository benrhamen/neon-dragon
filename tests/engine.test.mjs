import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../public/js/engine.js';

const book = JSON.parse(readFileSync(new URL('../public/data/neon-dragon.json', import.meta.url), 'utf8'));
const pick = (state, label) => {
  const c = E.availableChoices(book, state).find((x) => x.label.includes(label));
  assert.ok(c, `choice "${label}" not found in ${state.current}`);
  return c;
};
const go = (state, label, rng) => E.choose(book, state, pick(state, label).index, rng);

test('dice parsing and seeded rolls', () => {
  assert.deepEqual(E.parseDice('2d6+3'), { count: 2, sides: 6, mod: 3 });
  const a = E.rollDice('2d6', E.makeRng(7)); const b = E.rollDice('2d6', E.makeRng(7));
  assert.deepEqual(a, b);
  for (let i = 0; i < 500; i++) { const r = E.rollDice('1d6+6'); assert.ok(r.total >= 7 && r.total <= 12); }
});

test('new game: stats, inventory, start section', () => {
  const { state } = E.newGame(book, { rng: E.makeRng(1), playerName: 'MAX' });
  assert.equal(state.current, 'intro');
  assert.equal(state.stats.energy, 12);
  assert.ok(state.stats.power >= 7 && state.stats.power <= 12);
  assert.equal(state.statMax.luck, state.stats.luck);
  assert.equal(E.itemCount(state, 'token'), 3);
});

test('no-dice winning path: items unlock choices, stats and inventory update', () => {
  const { state } = E.newGame(book, { rng: E.makeRng(2) });
  go(state, 'Ask Auntie Lam');
  assert.equal(E.itemCount(state, 'egg_tart'), 1);
  go(state, 'Drop a token');
  assert.equal(E.itemCount(state, 'token'), 2);
  go(state, 'night market');
  go(state, 'Buy a rabbit lantern');
  assert.equal(E.itemCount(state, 'lantern'), 1);
  assert.equal(E.itemCount(state, 'token'), 1);
  go(state, 'Look around');
  assert.ok(E.availableChoices(book, state).find((c) => c.label.includes('lantern')).hidden, 'buy-lantern hidden once owned');
  go(state, 'Peak Tram');
  assert.ok(pick(state, 'rabbit lantern').available);
  go(state, 'rabbit lantern');
  assert.equal(pick(state, 'brass key').available, false);
  go(state, 'walk up to the Peak');
  go(state, 'egg tart');
  assert.equal(E.itemCount(state, 'egg_tart'), 0);
  assert.equal(state.flags.robot_friend, true);
  go(state, 'Sky Tower');
  go(state, 'riddle');
  go(state, 'A clock');
  assert.equal(E.itemCount(state, 'pearl'), 1);
  go(state, 'roof');
  go(state, 'Pearl of Light');
  assert.equal(state.current, 'victory');
  assert.equal(state.ended.type, 'win');
  assert.throws(() => E.choose(book, state, 0));
});

test('locked choices cannot be taken', () => {
  const { state } = E.newGame(book, { rng: E.makeRng(3) });
  go(state, 'Drop a token'); go(state, 'ferry pier');
  // 2 tokens left -> ferry is available; spend one elsewhere to lock it
  state.inventory.token = 1;
  const ferry = pick(state, 'Pay two tokens');
  assert.equal(ferry.available, false);
  assert.match(ferry.need, /2 Arcade Tokens/);
  assert.throws(() => E.choose(book, state, ferry.index), /locked/);
});

test('luck test is deterministic with a seed and costs 1 luck', () => {
  const { state } = E.newGame(book, { rng: E.makeRng(4) });
  go(state, 'Drop a token'); go(state, 'night market'); go(state, 'claw machine');
  assert.equal(state.current, 'claw');
  const luck = state.stats.luck;
  const rng = E.makeRng(99);
  const { roll, success } = E.rollTest(book, state, rng);
  assert.equal(state.stats.luck, luck - 1);
  assert.equal(success, roll.total <= luck);
  const again = E.rollTest(book, state, rng); // re-rolling returns the stored result
  assert.deepEqual(again.roll, roll);
  E.continueAfterTest(book, state, rng);
  assert.equal(state.current, success ? 'claw_win' : 'claw_lose');
});

test('combat resolves to win or lose target', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = E.makeRng(seed);
    const { state } = E.newGame(book, { rng });
    go(state, 'Drop a token', rng); go(state, 'night market', rng); go(state, 'Peak Tram', rng);
    go(state, 'Feel your way', rng); go(state, 'Climb out', rng); go(state, 'duel', rng);
    assert.equal(state.pending.kind, 'combat');
    let guard = 0;
    while (!state.pending.result && guard++ < 200) E.combatRound(book, state, rng);
    E.continueAfterCombat(book, state, rng);
    assert.ok(['bot_beaten', 'zapped'].includes(state.current), state.current);
  }
});

test('using an item and running out of energy', () => {
  const { state } = E.newGame(book, { rng: E.makeRng(5) });
  go(state, 'Ask Auntie Lam');
  state.stats.energy = 5;
  E.useItem(book, state, 'egg_tart');
  assert.equal(state.stats.energy, 9);
  assert.equal(E.itemCount(state, 'egg_tart'), 0);
  go(state, 'Drop a token'); go(state, 'night market'); go(state, 'Peak Tram');
  state.stats.energy = 2;
  go(state, 'Feel your way'); // -3 energy
  assert.equal(state.current, 'out_of_energy');
  assert.equal(state.ended.type, 'death');
});

test('fuzz: 3000 random playthroughs always end cleanly; every ending is reachable', () => {
  const endings = new Set();
  for (let seed = 1; seed <= 3000; seed++) {
    const rng = E.makeRng(seed);
    const { state } = E.newGame(book, { rng });
    let steps = 0;
    while (!state.ended && steps++ < 400) {
      const p = state.pending;
      if (p?.kind === 'test') { E.rollTest(book, state, rng); E.continueAfterTest(book, state, rng); continue; }
      if (p?.kind === 'combat') {
        if (rng() < 0.1 && book.sections[state.current].combat.flee) { E.flee(book, state, rng); continue; }
        while (!state.pending.result) E.combatRound(book, state, rng);
        E.continueAfterCombat(book, state, rng); continue;
      }
      if (state.inventory.egg_tart && rng() < 0.05) E.useItem(book, state, 'egg_tart', rng);
      const opts = E.availableChoices(book, state).filter((c) => c.available && !c.hidden);
      assert.ok(opts.length, `stuck in ${state.current}`);
      E.choose(book, state, opts[Math.floor(rng() * opts.length)].index, rng);
    }
    assert.ok(state.ended, `seed ${seed} did not finish`);
    endings.add(state.current);
    // state must survive a JSON round trip (localStorage)
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  }
  const all = Object.entries(book.sections).filter(([, s]) => s.ending).map(([id]) => id);
  for (const id of all) assert.ok(endings.has(id), `ending ${id} never reached`);
});

test('lint finds no errors', () => {
  const r = E.lintBook(book);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});
