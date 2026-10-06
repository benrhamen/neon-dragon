// Shared helpers for engine tests and the balance report: random playthroughs and
// "area route" analysis for the Zodiac Collection.
import * as E from '../public/js/engine.js';

// ---------- random playthroughs ----------
// Policy ("random but not suicidal"): pick uniformly among visible, unlocked choices, skipping any
// the game marks with a ⚠ game-ending warning when a safe one exists; sometimes eat/drink a usable
// item; riddles: 15% retreat, otherwise a random answer (and a random penalty, again avoiding ⚠
// ones when possible); fights: attack, with a 10% chance per round to flee.
const safe = (opts) => { const ok = opts.filter((o) => !o.warning); return ok.length ? ok : opts; };
export function randomPlay(book, seed, { maxSteps = 600 } = {}) {
  const rng = E.makeRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const { state } = E.newGame(book, { rng, playerName: 'MAX' });
  let steps = 0;
  while (!state.ended && steps++ < maxSteps) {
    const p = state.pending;
    if (p?.kind === 'test') { if (!p.roll) E.rollTest(book, state, rng); if (!state.ended && state.pending?.roll) E.continueAfterTest(book, state, rng); continue; }
    if (p?.kind === 'combat') {
      if (p.result) { E.continueAfterCombat(book, state, rng); continue; }
      const sec = book.sections[state.current];
      if (sec.combat.flee && rng() < 0.1) E.flee(book, state, rng); else E.combatRound(book, state, rng);
      continue;
    }
    if (p?.kind === 'riddle') {
      const r = E.currentRiddle(book, state);
      if (p.picked === null) {
        if (rng() < 0.15) { E.retreatRiddle(book, state, rng); continue; }
        E.answerRiddle(book, state, Math.floor(rng() * r.question.options.length), rng);
        continue;
      }
      if (p.penaltyDue) { E.payRiddlePenalty(book, state, pick(safe(E.riddlePenalties(book, state).filter((o) => o.available))).index, rng); continue; }
      E.continueRiddle(book, state, rng);
      continue;
    }
    const usable = Object.keys(state.inventory).filter((id) => state.inventory[id] > 0 && book.items[id]?.use);
    if (usable.length && rng() < 0.1) { E.useItem(book, state, pick(usable), rng); continue; }
    const opts = E.availableChoices(book, state).filter((c) => c.available && !c.hidden);
    if (!opts.length) throw new Error(`stuck at ${state.current} (seed ${seed})`);
    E.choose(book, state, pick(safe(opts)).index, rng);
  }
  const zodiac = E.trackerProgress(book, state).find((t) => t.id === 'zodiac');
  return {
    ending: state.ended?.section || null,
    type: state.ended?.type || 'wandering',
    cause: state.ended?.cause?.stat || null,
    zodiac: zodiac ? zodiac.met.length : 0,
    zodiacComplete: !!zodiac?.complete,
    steps,
    state,
  };
}

export function balanceReport(book, runs = 20000) {
  const tally = {};
  let wins = 0, zodiacWins = 0, deaths = 0, maxZ = 0;
  const causes = {};
  const winMoves = [];
  const winPP = [];
  let zodiacSum = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const r = randomPlay(book, seed);
    tally[r.ending || 'wandering'] = (tally[r.ending || 'wandering'] || 0) + 1;
    zodiacSum += r.zodiac;
    if (r.type === 'win') { wins++; if (r.zodiacComplete) zodiacWins++; winMoves.push(r.state.moves); winPP.push(r.state.stats.power); }
    if (r.cause) { deaths++; causes[r.cause] = (causes[r.cause] || 0) + 1; }
    maxZ = Math.max(maxZ, r.zodiac);
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const q = (a, f) => (a.length ? sorted(a)[Math.min(a.length - 1, Math.floor(f * a.length))] : null);
  const ppBuckets = {};
  for (const v of winPP) { const k = v <= 5 ? '1-5' : v <= 10 ? '6-10' : v <= 20 ? '11-20' : v <= 30 ? '21-30' : '31+'; ppBuckets[k] = (ppBuckets[k] || 0) + 1; }
  return {
    runs, wins, winRate: wins / runs, zodiacWins, deaths, causes, tally, maxZodiacSeen: maxZ, avgZodiac: zodiacSum / runs,
    winMoves: { avg: avg(winMoves), min: q(winMoves, 0), median: q(winMoves, 0.5), max: q(winMoves, 0.999) },
    winFinalPP: { avg: avg(winPP), min: q(winPP, 0), median: q(winPP, 0.5), buckets: ppBuckets },
  };
}

// ---------- area routes ----------
// An AREA is a strongly connected group of sections (you can wander freely inside it).
// A ROUTE is the sequence of areas a playthrough passes through. One-way moves (crossing the
// harbour, entering the vault, climbing the tower...) commit you to a different route.
export function areas(book) {
  const S = book.sections;
  const ids = Object.keys(S);
  const index = new Map(), low = new Map(), on = new Set(), stack = [], comp = new Map();
  let i = 0, c = 0;
  const strong = (v) => {
    index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of new Set(E.sectionTargets(S[v]))) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) { let w; do { w = stack.pop(); on.delete(w); comp.set(w, c); } while (w !== v); c++; }
  };
  for (const v of ids) if (!index.has(v)) strong(v);
  const members = Array.from({ length: c }, () => []);
  for (const [s, k] of comp) members[k].push(s);
  return { comp, members };
}

// Optimistic over-approximation of what a route could collect: conditions that might be true
// are treated as true, items are never lost, every dice/riddle outcome is possible. If even this
// can't collect a tracker entry on a route, no real playthrough on that route can.
function collectEffects(list, acc) {
  for (const e of list || []) {
    if ('addItem' in e) acc.items.add(e.addItem);
    if ('setFlag' in e) acc.flags.add(e.setFlag);
    if ('if' in e) { collectEffects(e.then, acc); collectEffects(e.else, acc); }
  }
}
function optimistic(c, acc) {
  if (!c) return true;
  if ('hasItem' in c) return acc.items.has(c.hasItem);
  if ('flag' in c) return (c.equals ?? true) === true ? acc.flags.has(c.flag) : true;
  if ('visited' in c) return acc.visited.has(c.visited);
  if ('all' in c) return c.all.every((x) => optimistic(x, acc));
  if ('any' in c) return c.any.some((x) => optimistic(x, acc));
  return true; // notHasItem, stat checks, not(...): could be true
}
function edges(sec) {
  const out = [];
  for (const ch of sec.choices || []) out.push({ target: ch.target, cond: ch.conditions, eff: [ch.effects] });
  if (sec.test) for (const o of [sec.test.success, sec.test.failure]) out.push({ target: o.target, eff: [o.effects] });
  if (sec.combat) { out.push({ target: sec.combat.win.target, eff: [sec.combat.win.effects] }); out.push({ target: sec.combat.lose.target, eff: [sec.combat.lose.effects] }); if (sec.combat.flee) out.push({ target: sec.combat.flee.target, eff: [sec.combat.flee.effects] }); }
  if (sec.riddle) { out.push({ target: sec.riddle.success.target, eff: [sec.riddle.success.effects, sec.riddle.onCorrect] }); out.push({ target: sec.riddle.retreat.target, eff: [sec.riddle.retreat.effects] }); }
  return out;
}

// Enumerate every route (sequence of areas from the start to an ending) with what it could collect.
export function routes(book) {
  const S = book.sections;
  const { comp, members } = areas(book);
  const results = [];
  const clone = (a) => ({ items: new Set(a.items), flags: new Set(a.flags), visited: new Set(a.visited) });
  const walk = (entry, acc, path) => {
    const area = comp.get(entry);
    acc = clone(acc);
    // fixpoint inside the area
    const reached = new Set();
    let frontier = [entry];
    let changed = true;
    const enter = (id) => { if (!reached.has(id)) { reached.add(id); acc.visited.add(id); collectEffects(S[id].onEnter, acc); changed = true; } };
    enter(entry);
    while (changed) {
      changed = false;
      for (const id of [...reached]) for (const e of edges(S[id])) {
        if (comp.get(e.target) !== area || !optimistic(e.cond, acc)) continue;
        const before = acc.items.size + acc.flags.size;
        e.eff.forEach((l) => collectEffects(l, acc));
        if (acc.items.size + acc.flags.size !== before) changed = true;
        enter(e.target);
      }
    }
    const route = [...path, members[area].length > 1 ? `{${[...reached].sort().join(',')}}` : entry];
    if (S[entry].ending) { results.push({ route, ending: entry, flags: acc.flags, items: acc.items }); return; }
    const exits = new Map();
    for (const id of reached) for (const e of edges(S[id])) {
      if (comp.get(e.target) === area || !optimistic(e.cond, acc)) continue;
      const a2 = clone(acc);
      e.eff.forEach((l) => collectEffects(l, a2));
      const key = e.target;
      // merge accumulations for the same exit target (optimistic)
      if (exits.has(key)) { const m = exits.get(key); a2.items.forEach((x) => m.items.add(x)); a2.flags.forEach((x) => m.flags.add(x)); }
      else exits.set(key, a2);
    }
    for (const [t, a2] of exits) walk(t, a2, route);
  };
  walk(book.start, { items: new Set(), flags: new Set(), visited: new Set() }, []);
  // depletion endings can happen anywhere; they never complete a collection, so they're not routes.
  return results;
}
