// Exhaustive search for the best possible SCORE in a book. Used to set scoring.reference (so the
// optimal path scores exactly 100%) and by the tests to prove that no path can beat it.
//
// What is searched (all of it, nothing sampled):
//   * every visible, unlocked choice at every step;
//   * both outcomes of every dice test, whenever the dice could actually produce that outcome;
//   * every fight: either fleeing, or winning it without losing a round (the best case);
//   * every riddle: retreating, or solving it. Wrong answers are skipped: they lead to exactly
//     the same place as the right answer but with an extra penalty (tokens or Energy), so they can
//     never score higher;
//   * eating/drinking items. Every usable item only restores Energy (capped at max) and no
//     condition reads Energy, so eating later is never worse than eating earlier unless you need
//     the Energy to survive. (A cure for a status effect is allowed too; an item that GIVES you a
//     status effect, like the glowing fish ball's poison, is never eaten: it is "lost", not used,
//     so it can't score, and the poison only costs Energy.) Items are therefore tried only when one hit could finish you
//     (Energy <= eatBelow, the biggest fixed hit) or in the scene right before a winning ending.
//     The search checks these assumptions and throws if a book breaks them.
//
// Search and pruning (exact):
//   * breadth-first over every reachable situation, with branch-and-bound: a state is dropped when
//     an optimistic upper bound on its final score (see buildBounds) can't beat the best win found
//     so far (a quick beam search finds a good one first);
//   * dominance pruning: from a given section, only some flags / visits / found-or-used items can
//     still matter (those that a section reachable from here reads or changes). Two states that
//     agree on those and on items held are compared on every stat and on the score already banked
//     by everything else; if an explored state is >= on all of them, the new state can never finish
//     higher (every effect on stats is monotone: add, halve, cap, and the only stat conditions are
//     "at least" checks), so it is skipped. For a stat that dice tests are rolled against, a higher
//     value only counts as better while it is below the highest possible roll (at the top you can
//     no longer fail, and failing might lead somewhere better). The search refuses to run if a book
//     breaks those rules.
import { createHash } from 'node:crypto';
import * as E from '../public/js/engine.js';

const clone = (s) => JSON.parse(JSON.stringify(s));

function collect(x, acc) {
  if (Array.isArray(x)) { for (const y of x) collect(y, acc); return; }
  if (!x || typeof x !== 'object') return;
  if (typeof x.flag === 'string') acc.flagReads.add(x.flag);
  if (typeof x.visited === 'string') acc.visitReads.add(x.visited);
  if (typeof x.setFlag === 'string') acc.flagWrites.add(x.setFlag);
  if (typeof x.clearFlag === 'string') acc.flagWrites.add(x.clearFlag);
  if (typeof x.addItem === 'string') acc.adds.add(x.addItem);
  if (typeof x.removeItem === 'string') acc.removes.add(x.removeItem);
  for (const v of Object.values(x)) collect(v, acc);
}
const newAcc = () => ({ flagReads: new Set(), visitReads: new Set(), flagWrites: new Set(), adds: new Set(), removes: new Set() });

export function analyse(book) {
  const S = book.sections;
  const ids = Object.keys(S);
  const local = {};
  for (const id of ids) { local[id] = newAcc(); collect(S[id], local[id]); }
  const items = newAcc(); collect(book.items || {}, items);
  const trackerFlags = new Set((book.trackers || []).flatMap((t) => t.entries.map((e) => e.flag)));
  const usable = Object.keys(book.items || {}).filter((i) => book.items[i].use);
  const rel = {};
  for (const id of ids) {
    const seen = new Set([id]);
    const stack = [id];
    while (stack.length) { const v = stack.pop(); for (const w of E.sectionTargets(S[v])) if (!seen.has(w)) { seen.add(w); stack.push(w); } }
    const acc = newAcc();
    for (const r of seen) for (const k of Object.keys(acc)) local[r][k].forEach((x) => acc[k].add(x));
    items.flagReads.forEach((f) => acc.flagReads.add(f));
    const flags = new Set(acc.flagReads);
    acc.flagWrites.forEach((f) => { if (trackerFlags.has(f)) flags.add(f); });
    rel[id] = {
      flags: [...flags].sort(),
      visits: [...acc.visitReads].sort(),
      found: [...acc.adds].sort(),
      used: [...new Set([...acc.removes, ...usable])].sort(),
    };
  }
  return rel;
}

function parseDice(f) {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(String(f).replace(/\s+/g, ''));
  return { count: +(m[1] || 1), sides: +m[2], mod: +(m[3] || 0) };
}

export function checkAssumptions(book) {
  const health = book.rules?.healthStat || 'energy';
  const problems = [];
  for (const [id, def] of Object.entries(book.items || {})) {
    if (!def.use || harmful(def)) continue;
    const ok = (e) => 'message' in e || 'cureStatus' in e || (e.stat === health && e.add > 0) || ('if' in e && (e.then || []).every(ok) && (e.else || []).every(ok));
    for (const e of def.use.effects || []) if (!ok(e)) problems.push(`item ${id}: use does more than restore ${health}`);
  }
  // harmful items must really be useless to the score: eaten = lost (not used), no other effects
  for (const [id, def] of Object.entries(book.items || {})) {
    if (!def.use || !harmful(def)) continue;
    if (def.use.consumable !== false || !(def.use.effects || []).every((e) => 'message' in e || 'addStatus' in e || (e.removeItem === id && e.lost))) problems.push(`item ${id}: a harmful item must be lost when eaten and do nothing else`);
  }
  for (const [id, def] of Object.entries(book.statusEffects || {})) for (const e of def.perMove || []) if (!(e.stat && e.add < 0)) problems.push(`status ${id}: perMove may only take stats away`);
  JSON.stringify(book.sections, (k, v) => { if (v && typeof v === 'object' && v.stat === health && v.op) problems.push(`a condition reads ${health}`); return v; });
  // Dominance needs "more is never worse" for every stat: stat conditions may only be at-least
  // checks (gt / gte), and never inside a "not".
  const walk = (x, negated) => {
    if (Array.isArray(x)) { x.forEach((y) => walk(y, negated)); return; }
    if (!x || typeof x !== 'object') return;
    if (typeof x.stat === 'string' && x.op && (negated || !['gt', 'gte'].includes(x.op))) problems.push(`condition ${x.stat} ${x.op} ${x.value} is not an at-least check`);
    for (const [k, v] of Object.entries(x)) walk(v, negated || k === 'not');
  };
  walk([book.sections, book.items || {}], false);
  return problems;
}

// An item whose use gives you a status effect (e.g. poison): the search never eats it.
const harmful = (def) => JSON.stringify(def.use?.effects || []).includes('"addStatus"');

// The moves the search can make from a settled state: [label, next settled state] pairs.
export function explorer(book, { eatBelow = 4 } = {}) {
  const healthStat = book.rules?.healthStat || 'energy';
  const fightRng = (() => { const seq = [0.99, 0.99, 0, 0]; let i = 0; return () => seq[i++ % 4]; })();
  const calmRng = () => 0;
  // Resolve anything pending after an action; returns a list of [label, settled state].
  function settle(st, label) {
    st.history = []; st.log = []; // never read by the rules; dropping them keeps states small
    if (st.ended || !st.pending) return [[label, st]];
    const p = st.pending;
    const sec = book.sections[st.current];
    const out = [];
    if (p.kind === 'test' && sec.test.type === 'gamble') {
      // dice gamble: any of win / exactly-7 (half Energy) / lose can come up
      for (const outcome of ['win', 'half', 'lose']) {
        const s2 = clone(st);
        E.rollTest(book, s2, calmRng);
        if (!s2.ended) { s2.pending.outcome = outcome; s2.pending.success = outcome === 'win'; E.continueAfterTest(book, s2, calmRng); }
        out.push(...settle(s2, `${label} → ${outcome === 'win' ? 'win the bet' : outcome === 'half' ? 'roll 7' : 'lose the bet'}`));
      }
      return out;
    }
    if (p.kind === 'test') {
      const t = sec.test;
      const goal = t.againstStat ? st.stats[t.againstStat] ?? 0 : null;
      const { count, sides, mod } = parseDice(t.dice);
      const min = count + mod, max = count * sides + mod;
      for (const success of [true, false]) {
        if (t.againstStat && success && goal < min) continue;
        if (t.againstStat && !success && goal >= max) continue;
        const s2 = clone(st);
        E.rollTest(book, s2, calmRng);
        if (!s2.ended) { s2.pending.success = success; E.continueAfterTest(book, s2, calmRng); }
        out.push(...settle(s2, `${label} → ${success ? 'pass' : 'fail'}`));
      }
      return out;
    }
    if (p.kind === 'combat') {
      const s2 = clone(st);
      let guard = 0;
      while (!s2.ended && s2.pending?.kind === 'combat' && !s2.pending.result && guard++ < 100) E.combatRound(book, s2, fightRng);
      if (!s2.ended && s2.pending?.result) E.continueAfterCombat(book, s2, calmRng);
      out.push(...settle(s2, `${label} → win the fight`));
      if (sec.combat.flee) { const s3 = clone(st); E.flee(book, s3, calmRng); out.push(...settle(s3, `${label} → flee`)); }
      return out;
    }
    if (p.kind === 'riddle') {
      const s2 = clone(st);
      let guard = 0;
      while (!s2.ended && s2.pending?.kind === 'riddle' && guard++ < 50) {
        const r = E.currentRiddle(book, s2);
        if (s2.pending.picked === null) E.answerRiddle(book, s2, r.question.answer, calmRng);
        else E.continueRiddle(book, s2, calmRng);
      }
      out.push(...settle(s2, `${label} → solve the riddle`));
      const s3 = clone(st); E.retreatRiddle(book, s3, calmRng); out.push(...settle(s3, `${label} → retreat`));
      return out;
    }
    throw new Error('unknown pending ' + p.kind);
  }

  function actions(st) {
    const out = [];
    const chs = book.sections[st.current].choices || [];
    for (let index = 0; index < chs.length; index++) {
      const c = chs[index];
      if (!E.checkCondition(book, st, c.conditions) || (c.hideIf && E.checkCondition(book, st, c.hideIf))) continue;
      const s2 = clone(st); E.choose(book, s2, index, calmRng);
      out.push(...settle(s2, `${st.current}: ${c.label}`));
    }
    const finalScene = chs.some((c) => book.sections[c.target]?.ending?.type === 'win');
    const lowEnergy = (st.stats[healthStat] ?? Infinity) <= eatBelow;
    if (finalScene || lowEnergy) {
      for (const id of Object.keys(st.inventory)) {
        const def = book.items?.[id];
        if (!def?.use || harmful(def) || !(st.inventory[id] > 0) || !E.checkCondition(book, st, def.use.conditions)) continue;
        const s2 = clone(st); E.useItem(book, s2, id, calmRng); s2.history = []; s2.log = []; out.push([`${st.current}: use ${def.name || id}`, s2]);
      }
    }
    return out;
  }

  return { actions };
}


// ---------- upper bound (for branch-and-bound) ----------
// For every scored stat we bound its final value from any state:
//   current value + gains that can only happen once and are still available in reachable sections
//   + the longest path to a winning ending over all other changes (including the per-move tick),
// capped at the stat's max. "Once" gains are (a) inside {if: {not: flag F}, then: [setFlag F, ...]}
// with F never cleared, or (b) in a section whose number of entries is bounded (every way in is
// hidden once the section was visited / once a flag it sets is on, or comes from such a section).
// If the remaining changes form a loop that gains, the bound for that stat is Infinity (no pruning).
const effTargets = (sec) => {
  const out = [];
  (sec.choices || []).forEach((c) => out.push({ to: c.target, eff: c.effects || [], guard: c.hideIf || null }));
  const outc = (o, extra = []) => o && o.target && out.push({ to: o.target, eff: [...extra, ...(o.effects || [])], guard: null });
  if (sec.test) {
    outc(sec.test.success, sec.test.costEffects || []); outc(sec.test.failure, sec.test.costEffects || []);
    if (sec.test.type === 'gamble') {
      const gb = { stats: { luck: {} } };
      out.pop(); // replace the plain failure edge: a lost gamble also costs Luck
      outc(sec.test.failure, [...(sec.test.costEffects || []), ...E.gambleEffects(gb, sec.test, 'lose')]);
      outc(E.sevenOutcome(sec.test), [...(sec.test.costEffects || []), ...E.gambleEffects(gb, sec.test, 'half')]);
    }
  }
  if (sec.combat) { outc(sec.combat.win); outc(sec.combat.lose); outc(sec.combat.flee); }
  if (sec.riddle) {
    const r = sec.riddle;
    const per = [...(r.onCorrect || [])];
    const corr = Array.from({ length: r.draw ?? r.questions.length }).flatMap(() => per);
    outc(r.success, corr); outc(r.retreat);
  }
  return out;
};
export function buildBounds(book, startStat) {
  const S = book.sections;
  const ids = Object.keys(S);
  const cleared = new Set();
  JSON.stringify(S, (k, v) => { if (v && typeof v.clearFlag === 'string') cleared.add(v.clearFlag); return v; });
  const flagsSetIn = (x) => { const f = new Set(); JSON.stringify(x, (k, v) => { if (v && typeof v.setFlag === 'string' && v.value !== false) f.add(v.setFlag); return v; }); return f; };
  // entry bounds k(S)
  const incoming = {}; ids.forEach((id) => (incoming[id] = []));
  for (const id of ids) for (const e of effTargets(S[id])) if (incoming[e.to]) incoming[e.to].push({ from: id, guard: e.guard });
  incoming[book.start].push({ from: null, guard: 'start' });
  const k = {};
  const visiting = new Set();
  const entryBound = (id) => {
    if (id in k) return k[id];
    if (visiting.has(id)) return Infinity;
    visiting.add(id);
    const sets = flagsSetIn(S[id]);
    let guarded = 0; let total = 0;
    for (const inc of incoming[id]) {
      const g = inc.guard;
      if (g === 'start') { total += 1; continue; }
      const isGuard = g && ((g.visited === id) || (typeof g.flag === 'string' && g.equals !== false && sets.has(g.flag) && !cleared.has(g.flag)));
      if (isGuard) { guarded = 1; continue; }
      total += entryBound(inc.from);
    }
    visiting.delete(id);
    return (k[id] = total + guarded);
  };
  ids.forEach((id) => { visiting.clear(); entryBound(id); });
  // classify effects
  const statIds = Object.keys(book.stats || {});
  const tick = {};
  for (const e of book.rules?.perMoveEffects || []) if (e.stat && typeof e.add === 'number') tick[e.stat] = (tick[e.stat] || 0) + e.add;
  const onceFlagGains = []; // { flag, sec, stat, add }
  const onceSecGains = []; // { sec, stat, add } (times k[sec])
  let unbounded = new Set();
  // sum of an effect list for a stat, with flag-guarded once-gains split out
  const sumEff = (list, stat, sec, collect) => {
    let t = 0;
    for (const e of list || []) {
      if (e.if) {
        const c = e.if;
        const thenSets = flagsSetIn(e.then || []);
        if (c.not && typeof c.not.flag === 'string' && c.not.equals !== false && thenSets.has(c.not.flag) && !cleared.has(c.not.flag) && !e.else) {
          const g = sumEff(e.then, stat, sec, null);
          if (g > 0 && collect) collect.push({ flag: c.not.flag, sec, stat, add: g });
          else if (g < 0) t += 0; // a cost that might not happen: ignore for an upper bound
          continue;
        }
        t += Math.max(sumEff(e.then, stat, sec, null), sumEff(e.else, stat, sec, null), 0);
        continue;
      }
      if (e.stat !== stat) continue;
      if ('set' in e || e.restore) { unbounded.add(stat); continue; }
      if (typeof e.add === 'number') t += e.add;
    }
    return t;
  };
  const weights = {}; // stat -> list of edges { from, to, w }
  for (const stat of statIds) {
    weights[stat] = [];
    for (const id of ids) {
      for (const e of effTargets(S[id])) {
        if (!S[e.to]) continue;
        const toEnding = !!S[e.to].ending;
        const flagG = [];
        let w = sumEff(e.eff, stat, id, flagG) + sumEff(S[e.to].onEnter, stat, e.to, flagG) + (toEnding ? 0 : (tick[stat] || 0));
        flagG.forEach((g) => onceFlagGains.push(g));
        // positive section gains in bounded sections become once-gains (counted k times)
        const gIn = sumEff(S[e.to].onEnter, stat, e.to, null);
        if (gIn > 0 && isFinite(k[e.to]) && !toEnding) { onceSecGains.push({ sec: e.to, stat, add: gIn, times: k[e.to], kind: 'enter' }); w -= gIn; }
        const gOut = sumEff(e.eff, stat, id, null);
        if (gOut > 0 && isFinite(k[id])) { onceSecGains.push({ sec: id, to: e.to, stat, add: gOut, times: k[id], kind: 'exit' }); w -= gOut; }
        weights[stat].push({ from: id, to: e.to, w });
      }
    }
  }
  // dedupe once gains (several edges may report the same one)
  const uniq = (arr, key) => [...new Map(arr.map((g) => [key(g), g])).values()];
  const flagGains = uniq(onceFlagGains, (g) => `${g.flag}|${g.stat}`);
  const secGains = uniq(onceSecGains, (g) => `${g.kind}|${g.sec}|${g.to || ''}|${g.stat}`);
  // longest path to a winning ending, per stat (Bellman-Ford; Infinity where a gaining loop exists)
  const wins = ids.filter((id) => S[id].ending?.type === 'win');
  const L = {};
  for (const stat of statIds) {
    const d = Object.fromEntries(ids.map((id) => [id, -Infinity]));
    wins.forEach((id) => (d[id] = 0));
    let changed = true; let rounds = 0;
    while (changed && rounds++ <= ids.length + 1) {
      changed = false;
      for (const { from, to, w } of weights[stat]) if (d[to] > -Infinity && d[to] + w > d[from]) { d[from] = d[to] + w; changed = true; }
    }
    if (changed) { // a gaining loop: mark everything that can reach it as unbounded
      for (let i = 0; i < ids.length; i++) for (const { from, to, w } of weights[stat]) if (d[to] > -Infinity && d[to] + w > d[from]) d[from] = Infinity;
      for (let i = 0; i < ids.length; i++) for (const { from, to } of weights[stat]) if (d[to] === Infinity) d[from] = Infinity;
    }
    L[stat] = d;
  }
  // reachability, and which tracker flags each section can still set
  const reach = {};
  const setsIn = Object.fromEntries(ids.map((id) => [id, flagsSetIn(S[id])]));
  for (const id of ids) {
    const seen = new Set([id]); const stack = [id];
    while (stack.length) { const v = stack.pop(); for (const w of E.sectionTargets(S[v])) if (S[w] && !seen.has(w)) { seen.add(w); stack.push(w); } }
    reach[id] = seen;
  }
  const flagsReach = Object.fromEntries(ids.map((id) => [id, new Set([...reach[id]].flatMap((r) => [...setsIn[r]]))]));
  // all-pairs longest path (max-plus Floyd-Warshall) for each stat; Infinity on gaining loops
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const LP = {};
  for (const stat of statIds) {
    const n = ids.length;
    const d = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n).fill(-Infinity); r[i] = 0; return r; });
    for (const { from, to, w } of weights[stat]) { const a = idx[from], b = idx[to]; if (w > d[a][b]) d[a][b] = w; }
    for (let m = 0; m < n; m++) for (let i = 0; i < n; i++) { const dim = d[i][m]; if (dim === -Infinity) continue; const dm = d[m]; const di = d[i]; for (let j = 0; j < n; j++) if (dim + dm[j] > di[j]) di[j] = dim + dm[j]; }
    for (let i = 0; i < n; i++) if (d[i][i] > 0) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (d[a][i] > -Infinity && d[i][b] > -Infinity) d[a][b] = Infinity;
    LP[stat] = d;
  }
  return { k, flagGains, secGains, L, LP, idx, unbounded, wins, reach, flagsReach, setsIn };
}

// Upper bound on the final raw score from a settled state (Infinity = no useful bound).
//  * stats other than the timer stat: their own bound (above), usually just the cap;
//  * the timer stat (perMoveEffects) and the collectables (tracker entries, items found, items
//    used, once-only timer gains) together: a route that picks up collectable c must pass one of
//    c's sections l, so the timer can end at most at  now + gains picked up + LP(here, l) + L(l).
//    For a set C of collectables that bounds the timer by now + gains(C) + min over c in C of D(c),
//    D(c) = max over c's sections l of LP(here, l) + L(l); the best C for a threshold t is
//    "everything with D(c) >= t", so the bound is the max over t of that.
export function makeUpperBound(book, rel, B) {
  const health = book.rules?.healthStat || 'energy';
  const hasFood = Object.values(book.items || {}).some((d) => d.use);
  const comps = book.scoring?.components || [];
  const S = book.sections;
  const timer = (book.rules?.perMoveEffects || []).find((e) => e.stat && e.add < 0)?.stat;
  const timerComp = comps.find((c) => c.stat === timer);
  const tp = timerComp ? timerComp.points : 0;
  const statBound = (st, stat) => {
    const cur = st.current;
    const max = typeof st.statMax?.[stat] === 'number' ? st.statMax[stat] : Infinity;
    if ((stat === health && hasFood) || B.unbounded.has(stat)) return max;
    let pool = 0;
    for (const g of B.flagGains) if (g.stat === stat && !st.flags[g.flag] && B.reach[cur].has(g.sec)) pool += g.add;
    for (const g of B.secGains) {
      if (g.stat !== stat || !B.reach[cur].has(g.sec)) continue;
      const rem = g.times - (st.visited[g.sec] || 0) + (g.kind === 'exit' && g.sec === cur ? 1 : 0);
      if (rem > 0) pool += g.add * rem;
    }
    return Math.min(max, st.stats[stat] + pool + B.L[stat][cur]);
  };
  // collectables: { kind, key, locs: [section ids] or null (anywhere), value(st), done(st) }
  const locsOf = (pred) => Object.keys(S).filter((id) => { let hit = false; JSON.stringify(S[id], (k, v) => { if (v && pred(v)) hit = true; return v; }); return hit; });
  const col = [];
  const trackerComp = comps.filter((c) => c.tracker);
  for (const c of trackerComp) {
    const t = (book.trackers || []).find((x) => x.id === c.tracker);
    for (const e of t.entries) {
      const gain = B.flagGains.filter((g) => g.flag === e.flag && g.stat === timer).reduce((a, g) => a + g.add, 0);
      col.push({ locs: locsOf((v) => v.setFlag === e.flag && v.value !== false), value: c.points + tp * gain, done: (st) => !!st.flags[e.flag] });
    }
  }
  const trackerFlags = new Set(trackerComp.flatMap((c) => (book.trackers || []).find((x) => x.id === c.tracker).entries.map((e) => e.flag)));
  for (const g of B.flagGains) if (g.stat === timer && !trackerFlags.has(g.flag)) col.push({ locs: [g.sec], value: tp * g.add, done: (st) => !!st.flags[g.flag] });
  for (const g of B.secGains) if (g.stat === timer) col.push({ locs: [g.sec], value: tp * g.add, sec: g, done: null });
  const foundComp = comps.find((c) => c.items === 'found');
  const usedComp = comps.find((c) => c.items === 'used');
  const itemIds = Object.keys(book.items || {});
  if (foundComp) for (const i of itemIds) { const locs = locsOf((v) => v.addItem === i); if (locs.length) col.push({ locs, value: foundComp.points, done: (st) => !!st.found[i] }); }
  if (usedComp) for (const i of itemIds) {
    const locs = book.items[i].use ? null : locsOf((v) => v.removeItem === i);
    if (locs === null || locs.length) col.push({ locs, value: usedComp.points, done: (st) => !!st.used[i] });
  }
  const others = comps.filter((c) => !(c.stat === timer || c.tracker || c.items));
  const D = (cur, c) => {
    if (!c.locs) return B.L[timer][cur];
    let best = -Infinity;
    const row = B.LP[timer][B.idx[cur]];
    for (const l of c.locs) { const v = row[B.idx[l]] + B.L[timer][l]; if (v > best) best = v; }
    return best;
  };
  return (st) => {
    const cur = st.current;
    if (!timer || B.unbounded.has(timer) || B.L[timer][cur] === Infinity) return Infinity;
    if (B.L[timer][cur] === -Infinity) return -Infinity; // no win reachable
    let ub = E.scoreRaw(book, st).components.filter((c) => { const d = comps.find((x) => x.id === c.id); return d.tracker || d.items; }).reduce((a, c) => a + c.points, 0);
    for (const c of others) { if (!c.stat) return Infinity; ub += c.points * Math.max(0, statBound(st, c.stat)); }
    // remaining collectables with their D
    const rem = [];
    for (const c of col) {
      if (c.sec) {
        const g = c.sec;
        const left = g.times - (st.visited[g.sec] || 0) + (g.kind === 'exit' && g.sec === cur ? 1 : 0);
        if (left <= 0 || !B.reach[cur].has(g.sec)) continue;
        const d = D(cur, c);
        if (d > -Infinity) rem.push([d, c.value * left]);
        continue;
      }
      if (c.done(st)) continue;
      const d = D(cur, c);
      if (d === Infinity) return Infinity;
      if (d > -Infinity) rem.push([d, c.value]);
    }
    rem.sort((a, b) => b[0] - a[0]);
    let bestTail = tp * (st.stats[timer] + B.L[timer][cur]);
    let acc = 0;
    for (const [d, v] of rem) { acc += v; const cand = acc + tp * (st.stats[timer] + d); if (cand > bestTail) bestTail = cand; }
    return ub + bestTail;
  };
}

export function optimalSearch(book, { startStat = book.scoring?.reference?.byStartStat || 'luck', startValue = 12, maxStates = 2e7, eatBelow = 4, beamWidth = 3000, beamOnly = false, onProgress = null, debug = null } = {}) {
  const problems = checkAssumptions(book);
  if (problems.length) throw new Error('optimalSearch assumptions broken: ' + problems.join('; '));
  const rel = analyse(book);
  const statIds = Object.keys(book.stats || {});
  const scoredStats = new Set((book.scoring?.components || []).filter((c) => c.stat).map((c) => c.stat));
  const { actions } = explorer(book, { eatBelow });
  let states = 0;
  let pruned = 0;

  // What can still change the future from this section: all stats, items held, and only the flags,
  // visits and found/used items that a section reachable from here reads or changes. Everything
  // else is already "banked" in the score and can't change any more.
  const hash = (s) => createHash('md5').update(s).digest('base64');
  const domKey = (st) => {
    const r = rel[st.current];
    return hash(JSON.stringify([st.current, st.inventory, st.status || {}, r.flags.filter((f) => st.flags[f]), r.visits.filter((v) => st.visited[v]),
      r.found.filter((i) => st.found[i]), r.used.filter((i) => st.used[i])]));
  };
  // A dice test against a stat can only be failed while the stat is below the highest roll, so a
  // higher value only dominates a lower one below that point (or when they are equal).
  const testMax = {};
  for (const sec of Object.values(book.sections)) {
    const t = sec.test;
    if (t?.againstStat) { const { count, sides, mod } = parseDice(t.dice); testMax[t.againstStat] = Math.max(testMax[t.againstStat] ?? -Infinity, count * sides + mod); }
  }
  const atLeast = (s, a, b) => a === b || (a > b && !(a >= (testMax[s] ?? Infinity)));
  const banked = (st) => {
    const sr = E.scoreRaw(book, st);
    return sr.components.filter((c) => !scoredStats.has((book.scoring.components.find((x) => x.id === c.id) || {}).stat)).reduce((a, c) => a + c.points, 0);
  };
  // Pareto fronts: relevant key -> list of [banked, ...stats] of states already queued.
  const fronts = new Map();
  const vec = (st, b) => [b, ...statIds.map((s) => st.stats[s])];
  const covers = (o, v) => o[0] >= v[0] && statIds.every((s, i) => atLeast(s, o[i + 1], v[i + 1]));
  const admit = (st) => {
    const k = domKey(st);
    const v = vec(st, banked(st));
    const list = fronts.get(k);
    if (!list) { fronts.set(k, [v]); return true; }
    if (list.some((o) => covers(o, v))) return false;
    fronts.set(k, [...list.filter((o) => !covers(v, o)), v]);
    return true;
  };

  const B = buildBounds(book, startStat);
  const upper = makeUpperBound(book, rel, B);

  // Breadth-first: states reached in fewer steps usually have more Pixel Power and Energy, so they
  // are queued first and prune the slower ways of reaching the same situation. On top of that,
  // branch-and-bound: a state is dropped when even its optimistic upper bound can't beat the best
  // win found so far. A quick beam search (keeping only the most promising states per step) runs
  // first to find a good win to compare against. Every admitted state is expanded and a state is
  // only dropped when it provably can't finish higher, so the best score found is the true best.
  const start = E.newGame(book, { rng: () => 0.99, playerName: 'MAX' }).state;
  start.stats[startStat] = startValue; start.statMax[startStat] = startValue;
  function run({ beam = Infinity, incumbent = -Infinity }) {
    fronts.clear();
    const parent = [-1];
    const via = [-1];
    const labels = [];
    const labelId = new Map();
    const intern = (l) => { let i = labelId.get(l); if (i === undefined) { i = labels.length; labels.push(l); labelId.set(l, i); } return i; };
    admit(start);
    let layer = [[JSON.stringify(start), 0, upper(start)]];
    let raw = -Infinity;
    let bestEnd = -1;
    let bestLabel = null;
    let n = 0;
    let cut = 0;
    while (layer.length) {
      let next = [];
      for (let j = 0; j < layer.length; j++) {
        const [json, id, ub] = layer[j];
        layer[j] = null;
        if (ub <= Math.max(raw, incumbent)) { cut++; continue; }
        const st = JSON.parse(json);
        if (debug) debug(st);
        for (const [label, s2] of actions(st)) {
          if (s2.ended) {
            if (s2.ended.type !== 'win') continue;
            const v = E.scoreRaw(book, s2).raw;
            if (v > raw) { raw = v; bestEnd = id; bestLabel = label; }
            continue;
          }
          const ub2 = upper(s2);
          if (ub2 <= Math.max(raw, incumbent)) { cut++; continue; }
          if (!admit(s2)) { pruned++; continue; }
          if (++n > maxStates) throw new Error('search too large');
          if (beam === Infinity) { states = n; if (onProgress && n % 100000 === 0) onProgress(n, pruned, cut); }
          parent.push(id); via.push(intern(label));
          next.push([JSON.stringify(s2), parent.length - 1, ub2]);
        }
      }
      if (next.length > beam) next = next.sort((x, y) => y[2] - x[2]).slice(0, beam);
      layer = next;
    }
    const path = [];
    if (bestEnd >= 0) { path.push(bestLabel); for (let i = bestEnd; i > 0; i = parent[i]) path.push(labels[via[i]]); path.reverse(); }
    return { raw, path, cut };
  }
  const quick = beamWidth > 0 ? run({ beam: beamWidth }) : { raw: -Infinity, path: [] };
  const exact = beamOnly ? { raw: -Infinity, path: [], cut: 0 } : run({ incumbent: quick.raw - 1e-9 });
  const win = exact.raw > quick.raw ? exact : quick;
  const raw = win.raw;
  const path = win.path;
  const final = path.length ? followPath(book, path, { startStat, startValue, eatBelow }) : null;
  if (final && Math.abs(E.scoreRaw(book, final).raw - raw) > 1e-9) throw new Error('path replay does not match the best score');
  return { raw, path, final, states, pruned, cut: exact.cut, beamRaw: quick.raw };
}

// Replay a path from optimalSearch (its list of labels) and return the final state.
export function followPath(book, path, { startStat = book.scoring?.reference?.byStartStat || 'luck', startValue = 12, eatBelow = 4 } = {}) {
  const { actions } = explorer(book, { eatBelow });
  let { state } = E.newGame(book, { rng: () => 0.99, playerName: 'MAX' });
  state.stats[startStat] = startValue; state.statMax[startStat] = startValue;
  for (const label of path) {
    const next = actions(state).find(([l]) => l === label);
    if (!next) throw new Error(`step not possible: ${label} (at ${state.current})`);
    state = next[1];
  }
  return state;
}
