// Gamebook engine: pure state logic, no DOM. Works in the browser and in Node (tests).
// State is a plain JSON object so it can be saved to localStorage as-is.

export const SAVE_VERSION = 3;

// ---------- random numbers ----------
// mulberry32: tiny seedable PRNG so tests can be deterministic (?seed=123).
export function makeRng(seed) {
  if (seed === undefined || seed === null || seed === '') return Math.random;
  let a = (Number(seed) >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DICE_RE = /^([1-9][0-9]?)d(2|4|6|8|10|12|20)([+-][0-9]{1,3})?$/;

export function parseDice(formula) {
  const m = DICE_RE.exec(formula);
  if (!m) throw new Error(`Bad dice formula: ${formula}`);
  return { count: +m[1], sides: +m[2], mod: m[3] ? +m[3] : 0 };
}

export function rollDice(formula, rng = Math.random) {
  const { count, sides, mod } = parseDice(formula);
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(rng() * sides));
  return { rolls, mod, total: rolls.reduce((a, b) => a + b, 0) + mod, sides };
}

// ---------- helpers ----------
export function statBounds(book, state, id) {
  const def = (book.stats || {})[id];
  if (!def) return { min: -Infinity, max: Infinity };
  const min = def.min ?? 0;
  let max = Infinity;
  if (def.max === 'initial') max = state.statMax?.[id] ?? Infinity;
  else if (typeof def.max === 'number') max = def.max;
  return { min, max };
}

function clampStat(book, state, id, value) {
  const { min, max } = statBounds(book, state, id);
  return Math.max(min, Math.min(max, value));
}

function roundBy(v, mode) {
  if (mode === 'up') return Math.ceil(v - 1e-9);
  if (mode === 'nearest') return Math.round(v);
  return Math.floor(v + 1e-9);
}

export function itemCount(state, id) {
  return state.inventory[id] || 0;
}

// The paragraphs of a section that apply right now (paragraphs can carry an "if" condition).
export function sectionParagraphs(book, state, sec) {
  const raw = Array.isArray(sec.text) ? sec.text : [sec.text];
  return raw.filter((p) => typeof p === 'string' || checkCondition(book, state, p.if)).map((p) => (typeof p === 'string' ? p : p.text));
}

export function interpolate(text, ctx = {}) {
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (ctx[k] ?? ''));
}

// ---------- new game ----------
export function newGame(book, { rng = Math.random, playerName = '' } = {}) {
  const state = {
    saveVersion: SAVE_VERSION,
    bookId: book.metadata.id || book.metadata.title,
    bookVersion: book.metadata.version,
    playerName,
    current: book.start,
    stats: {},
    statMax: {},
    inventory: {},
    flags: {},
    history: [],
    visited: {},
    log: [],
    pending: null, // in-progress dice test / combat for the current section
    ended: null,
    startedAt: Date.now(),
    turns: 0,
    moves: 0, // player moves so far (each one applies rules.perMoveEffects)
    found: {}, // items ever picked up (for the score)
    used: {}, // items ever used up or handed over (for the score)
  };
  for (const [id, def] of Object.entries(book.stats || {})) {
    let v;
    let rolled = null;
    if (typeof def.initial === 'number') v = def.initial;
    else { rolled = rollDice(def.initial.dice, rng); v = rolled.total; }
    state.statMax[id] = v;
    state.stats[id] = v;
    if (rolled) state.log.push({ type: 'roll', text: `${def.name}: rolled ${def.initial.dice} = ${v}` });
  }
  for (const [id, def] of Object.entries(book.flags || {})) {
    if (def.initial !== undefined) state.flags[id] = def.initial;
  }
  for (const entry of book.startingInventory || []) {
    const id = typeof entry === 'string' ? entry : entry.item;
    const qty = typeof entry === 'string' ? 1 : entry.quantity ?? 1;
    state.inventory[id] = (state.inventory[id] || 0) + qty;
  }
  const messages = [];
  enterSection(book, state, book.start, messages, rng);
  return { state, messages };
}

// ---------- conditions ----------
export function checkCondition(book, state, cond) {
  if (!cond) return true;
  if ('hasItem' in cond) return itemCount(state, cond.hasItem) >= (cond.quantity ?? 1);
  if ('notHasItem' in cond) return itemCount(state, cond.notHasItem) === 0;
  if ('stat' in cond) {
    const v = state.stats[cond.stat] ?? 0;
    switch (cond.op) {
      case 'eq': return v === cond.value;
      case 'neq': return v !== cond.value;
      case 'gt': return v > cond.value;
      case 'gte': return v >= cond.value;
      case 'lt': return v < cond.value;
      case 'lte': return v <= cond.value;
      default: return false;
    }
  }
  if ('flag' in cond) {
    const want = cond.equals ?? true;
    const have = state.flags[cond.flag] ?? false;
    return have === want;
  }
  if ('visited' in cond) return !!state.visited[cond.visited];
  if ('all' in cond) return cond.all.every((c) => checkCondition(book, state, c));
  if ('any' in cond) return cond.any.some((c) => checkCondition(book, state, c));
  if ('not' in cond) return !checkCondition(book, state, cond.not);
  return false;
}

// Human-readable list of what a condition needs (for locked choices).
export function describeCondition(book, cond) {
  if (!cond) return '';
  const itemName = (id) => book.items?.[id]?.name || id;
  const statName = (id) => book.stats?.[id]?.name || id;
  const ops = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
  if ('hasItem' in cond) return (cond.quantity ?? 1) > 1 ? `${cond.quantity}× ${itemName(cond.hasItem)}` : itemName(cond.hasItem);
  if ('notHasItem' in cond) return `no ${itemName(cond.notHasItem)}`;
  if ('stat' in cond) return `${statName(cond.stat)} ${ops[cond.op]} ${cond.value}`;
  if ('flag' in cond) return `a secret`;
  if ('visited' in cond) return `somewhere you haven't been`;
  if ('all' in cond) return cond.all.map((c) => describeCondition(book, c)).join(' + ');
  if ('any' in cond) return cond.any.map((c) => describeCondition(book, c)).join(' or ');
  if ('not' in cond) return 'something else';
  return '';
}

// ---------- effects ----------
export function applyEffects(book, state, effects, messages = []) {
  for (const e of effects || []) {
    if ('if' in e) {
      applyEffects(book, state, checkCondition(book, state, e.if) ? e.then : e.else || [], messages);
    } else if ('stat' in e) {
      const before = state.stats[e.stat] ?? 0;
      let after = before;
      const factor = e.halve ? 0.5 : e.multiply;
      if ('add' in e) after = before + e.add;
      else if ('set' in e) after = e.set;
      else if (e.restore) after = statBounds(book, state, e.stat).max;
      else if (factor !== undefined) after = roundBy(before * factor, e.round || 'down');
      after = clampStat(book, state, e.stat, after);
      state.stats[e.stat] = after;
      const d = after - before;
      const name = book.stats?.[e.stat]?.name || e.stat;
      if (factor !== undefined) {
        const verb = factor === 0.5 ? 'halved' : `×${factor}`;
        messages.push({ type: 'stat', stat: e.stat, delta: d, scaled: factor, halved: factor === 0.5, text: `${name} ${verb}! ${before} → ${after}` });
      } else if (d !== 0) messages.push({ type: 'stat', stat: e.stat, delta: d, text: `${name} ${d > 0 ? '+' : ''}${d}` });
    } else if ('addItem' in e) {
      const def = book.items?.[e.addItem] || {};
      const q = e.quantity ?? 1;
      let next = itemCount(state, e.addItem) + q;
      if (!def.stackable) next = Math.min(next, 1);
      if (def.maxQuantity) next = Math.min(next, def.maxQuantity);
      const gained = next - itemCount(state, e.addItem);
      state.inventory[e.addItem] = next;
      if (gained > 0 && state.found) state.found[e.addItem] = true;
      if (gained > 0) messages.push({ type: 'item', item: e.addItem, delta: gained, text: `Got ${gained > 1 ? gained + '× ' : ''}${def.name || e.addItem}!` });
    } else if ('removeItem' in e) {
      const have = itemCount(state, e.removeItem);
      const q = Math.min(have, e.quantity ?? 1);
      const left = have - q;
      if (left > 0) state.inventory[e.removeItem] = left; else delete state.inventory[e.removeItem];
      if (q > 0 && state.used) state.used[e.removeItem] = true;
      if (q > 0) messages.push({ type: 'item', item: e.removeItem, delta: -q, text: `Used ${q > 1 ? q + '× ' : ''}${book.items?.[e.removeItem]?.name || e.removeItem}` });
    } else if ('setFlag' in e) {
      state.flags[e.setFlag] = e.value ?? true;
    } else if ('clearFlag' in e) {
      delete state.flags[e.clearFlag];
    } else if ('message' in e) {
      messages.push({ type: 'message', text: e.message });
    }
  }
  return messages;
}

function healthStatFor(book, combat) {
  return combat?.healthStat || book.rules?.healthStat;
}

// All "if this stat runs out, go here" rules: rules.depletion[] plus the older healthStat/onHealthDepleted pair.
export function depletionRules(book) {
  const list = [...(book.rules?.depletion || [])];
  if (book.rules?.healthStat && book.rules?.onHealthDepleted) list.push({ stat: book.rules.healthStat, target: book.rules.onHealthDepleted });
  return list;
}

// Checked after every change to the game state. If a watched stat has run out, divert immediately.
function checkDepleted(book, state, messages, rng) {
  if (state.ended) return false;
  for (const r of depletionRules(book)) {
    const limit = r.atOrBelow ?? statBounds(book, state, r.stat).min;
    if ((state.stats[r.stat] ?? Infinity) <= limit && state.current !== r.target) {
      messages.push({ type: 'depleted', stat: r.stat, text: `${book.stats?.[r.stat]?.name || r.stat} hit ${state.stats[r.stat]}!` });
      enterSection(book, state, r.target, messages, rng);
      if (state.ended) state.ended.cause = { stat: r.stat, value: state.stats[r.stat] };
      return true;
    }
  }
  return false;
}

export function enterSection(book, state, id, messages = [], rng = Math.random) {
  const sec = book.sections[id];
  if (!sec) throw new Error(`Unknown section: ${id}`);
  state.current = id;
  state.history.push(id);
  state.visited[id] = (state.visited[id] || 0) + 1;
  state.pending = null;
  state.turns += 1;
  applyEffects(book, state, sec.onEnter, messages);
  if (sec.ending) {
    state.ended = { type: sec.ending.type, title: sec.ending.title, stars: sec.ending.stars ?? null, style: sec.ending.style || 'standard', section: id };
    return messages;
  }
  if (sec.combat) {
    const c = sec.combat;
    state.pending = {
      kind: 'combat',
      enemyIndex: 0,
      enemyHealth: c.enemies[0].health,
      round: 0,
      rounds: [],
      result: null,
    };
  } else if (sec.test) {
    state.pending = { kind: 'test', roll: null, success: null };
  } else if (sec.riddle) {
    state.pending = { kind: 'riddle', q: 0, picked: null, correct: null, penaltyDue: false, score: 0, wrong: 0 };
  }
  checkDepleted(book, state, messages, rng);
  return messages;
}

// A MOVE = going to a new section because of something the player did (a choice, a dice test,
// a fight, a riddle, retreating). rules.perMoveEffects (e.g. Pixel Power -1) are applied first;
// if they empty a death stat, the depletion ending replaces the destination.
function move(book, state, target, messages, rng) {
  state.moves = (state.moves || 0) + 1;
  const per = book.rules?.perMoveEffects;
  if (per?.length) {
    applyEffects(book, state, per, []); // silent: the HUD shows the countdown
    if (checkDepleted(book, state, messages, rng)) return messages;
  }
  return enterSection(book, state, target, messages, rng);
}

// ---------- player actions ----------
export function availableChoices(book, state) {
  const sec = book.sections[state.current];
  return (sec.choices || []).map((c, index) => {
    const ok = checkCondition(book, state, c.conditions);
    const hideIf = c.hideIf ? checkCondition(book, state, c.hideIf) : false;
    return { ...c, index, available: ok, hidden: hideIf || (!ok && !!c.hideIfLocked), need: ok ? '' : c.lockedHint || describeCondition(book, c.conditions), warning: ok ? wouldDeplete(book, state, c.effects, c.target) : null };
  });
}

export function choose(book, state, index, rng = Math.random) {
  if (state.ended) throw new Error('Game has ended');
  const sec = book.sections[state.current];
  const c = (sec.choices || [])[index];
  if (!c) throw new Error(`No choice ${index} in ${state.current}`);
  if (!checkCondition(book, state, c.conditions)) throw new Error('Choice is locked');
  if (state.pending && !state.pending.result && state.pending.kind === 'combat') throw new Error('Finish the fight first');
  if (state.pending?.kind === 'riddle') throw new Error('Answer the riddles first');
  const messages = [];
  applyEffects(book, state, c.effects, messages);
  if (checkDepleted(book, state, messages, rng)) return messages;
  return move(book, state, c.target, messages, rng);
}

export function rollTest(book, state, rng = Math.random) {
  const sec = book.sections[state.current];
  const t = sec.test;
  if (!t || state.pending?.kind !== 'test') throw new Error('No test here');
  if (state.pending.roll) return { roll: state.pending.roll, success: state.pending.success, messages: [] };
  const roll = rollDice(t.dice, rng);
  let success;
  let goal;
  if (t.againstStat) { goal = state.stats[t.againstStat] ?? 0; success = roll.total <= goal; }
  else { const bonus = t.addStat ? state.stats[t.addStat] ?? 0 : 0; roll.total += bonus; roll.bonus = bonus; goal = t.target; success = roll.total >= goal; }
  roll.goal = goal;
  const messages = [];
  applyEffects(book, state, t.costEffects, messages);
  state.pending.roll = roll;
  state.pending.success = success;
  if (checkDepleted(book, state, messages, rng)) return { roll, success, messages, diverted: true };
  return { roll, success, messages };
}

export function continueAfterTest(book, state, rng = Math.random) {
  const sec = book.sections[state.current];
  const p = state.pending;
  if (!p || p.kind !== 'test' || !p.roll) throw new Error('Roll first');
  const out = p.success ? sec.test.success : sec.test.failure;
  const messages = [];
  applyEffects(book, state, out.effects, messages);
  if (checkDepleted(book, state, messages, rng)) return messages;
  return move(book, state, out.target, messages, rng);
}

export function combatSettings(book, sec) {
  const c = sec.combat;
  return {
    attackStat: c.attackStat || book.rules?.combat?.attackStat,
    healthStat: healthStatFor(book, c),
    dice: c.dice || book.rules?.combat?.dice || '2d6',
    damage: c.damage || book.rules?.combat?.damage || 2,
    loseAt: c.loseAt ?? 0,
  };
}

export function combatRound(book, state, rng = Math.random) {
  const sec = book.sections[state.current];
  const p = state.pending;
  if (!sec.combat || p?.kind !== 'combat') throw new Error('No combat here');
  if (p.result) return { round: p.rounds[p.rounds.length - 1], messages: [] };
  const cs = combatSettings(book, sec);
  const enemy = sec.combat.enemies[p.enemyIndex];
  const pr = rollDice(cs.dice, rng);
  const er = rollDice(cs.dice, rng);
  const playerTotal = pr.total + (state.stats[cs.attackStat] ?? 0);
  const enemyTotal = er.total + enemy.attack;
  const round = { n: ++p.round, enemy: enemy.name, playerRolls: pr.rolls, enemyRolls: er.rolls, playerTotal, enemyTotal, winner: 'tie' };
  const messages = [];
  if (playerTotal > enemyTotal) {
    p.enemyHealth = Math.max(0, p.enemyHealth - cs.damage);
    round.winner = 'player';
  } else if (enemyTotal > playerTotal) {
    round.winner = 'enemy';
    const before = state.stats[cs.healthStat];
    state.stats[cs.healthStat] = clampStat(book, state, cs.healthStat, before - cs.damage);
    messages.push({ type: 'stat', stat: cs.healthStat, delta: state.stats[cs.healthStat] - before, text: `${book.stats?.[cs.healthStat]?.name || cs.healthStat} -${cs.damage}` });
  }
  round.enemyHealth = p.enemyHealth;
  round.playerHealth = state.stats[cs.healthStat];
  p.rounds.push(round);
  if (checkDepleted(book, state, messages, rng)) { round.diverted = state.current; return { round, messages, diverted: true }; }
  if (p.enemyHealth <= 0) {
    if (p.enemyIndex + 1 < sec.combat.enemies.length) {
      p.enemyIndex += 1;
      p.enemyHealth = sec.combat.enemies[p.enemyIndex].health;
      round.nextEnemy = sec.combat.enemies[p.enemyIndex].name;
    } else p.result = 'win';
  } else if (state.stats[cs.healthStat] <= cs.loseAt) {
    p.result = 'lose';
  }
  return { round, messages };
}

export function continueAfterCombat(book, state, rng = Math.random) {
  const sec = book.sections[state.current];
  const p = state.pending;
  if (!p || p.kind !== 'combat' || !p.result) throw new Error('Combat not finished');
  const out = p.result === 'win' ? sec.combat.win : sec.combat.lose;
  const messages = [];
  applyEffects(book, state, out.effects, messages);
  // Depletion always wins: if a death stat ran out, that ending beats the fight's own lose target.
  if (checkDepleted(book, state, messages, rng)) return messages;
  return move(book, state, out.target, messages, rng);
}

export function flee(book, state, rng = Math.random) {
  const sec = book.sections[state.current];
  const f = sec.combat?.flee;
  if (!f) throw new Error('Cannot flee');
  if (state.pending?.result) throw new Error('Combat already over');
  const messages = [];
  applyEffects(book, state, f.effects, messages);
  if (checkDepleted(book, state, messages, rng)) return messages;
  return move(book, state, f.target, messages, rng);
}

// ---------- riddles ----------
// Flow per question: answerRiddle(i) -> if wrong, payRiddlePenalty(j) -> continueRiddle().
// After the last question, continueRiddle() applies riddle.success and moves on.
export function currentRiddle(book, state) {
  const sec = book.sections[state.current];
  const p = state.pending;
  if (!sec?.riddle || p?.kind !== 'riddle') return null;
  return { riddle: sec.riddle, question: sec.riddle.questions[p.q], index: p.q, total: sec.riddle.questions.length, pending: p };
}

export function answerRiddle(book, state, option, rng = Math.random) {
  const r = currentRiddle(book, state);
  if (!r) throw new Error('No riddle here');
  const p = r.pending;
  if (p.picked !== null) throw new Error('Already answered');
  if (!Number.isInteger(option) || option < 0 || option >= r.question.options.length) throw new Error('No such answer');
  const messages = [];
  p.picked = option;
  p.correct = option === r.question.answer;
  if (p.correct) {
    p.score += 1;
    applyEffects(book, state, r.riddle.onCorrect, messages);
    if (checkDepleted(book, state, messages, rng)) return { correct: true, messages, diverted: true };
  } else {
    p.wrong += 1;
    p.penaltyDue = true;
  }
  return { correct: p.correct, messages };
}

export function riddlePenalties(book, state) {
  const r = currentRiddle(book, state);
  if (!r) return [];
  return (r.riddle.wrong?.options || []).map((o, index) => {
    const ok = checkCondition(book, state, o.conditions);
    return { ...o, index, available: ok, need: ok ? '' : o.lockedHint || describeCondition(book, o.conditions), warning: ok ? wouldDeplete(book, state, o.effects) : null };
  });
}

export function payRiddlePenalty(book, state, index, rng = Math.random) {
  const r = currentRiddle(book, state);
  if (!r || !r.pending.penaltyDue) throw new Error('Nothing to pay');
  const o = r.riddle.wrong.options[index];
  if (!o) throw new Error('No such penalty');
  if (!checkCondition(book, state, o.conditions)) throw new Error('You cannot choose that');
  const messages = [];
  applyEffects(book, state, o.effects, messages);
  r.pending.penaltyDue = false;
  r.pending.paid = index;
  checkDepleted(book, state, messages, rng);
  return messages;
}

export function continueRiddle(book, state, rng = Math.random) {
  const r = currentRiddle(book, state);
  if (!r) throw new Error('No riddle here');
  const p = r.pending;
  if (p.picked === null) throw new Error('Answer first');
  if (p.penaltyDue) throw new Error('Choose a penalty first');
  const messages = [];
  if (p.q + 1 < r.total) {
    Object.assign(p, { q: p.q + 1, picked: null, correct: null, paid: undefined });
    return messages;
  }
  const out = r.riddle.success;
  applyEffects(book, state, out.effects, messages);
  if (checkDepleted(book, state, messages, rng)) return messages;
  return move(book, state, out.target, messages, rng);
}

// Leave before answering the current question: no penalty, but the riddle's success (and its reward) is missed.
export function retreatRiddle(book, state, rng = Math.random) {
  const r = currentRiddle(book, state);
  if (!r) throw new Error('No riddle here');
  if (r.pending.picked !== null) throw new Error('Too late to retreat: you already answered');
  const messages = [];
  applyEffects(book, state, r.riddle.retreat.effects, messages);
  if (checkDepleted(book, state, messages, rng)) return messages;
  return move(book, state, r.riddle.retreat.target, messages, rng);
}

// Would these effects trigger a depletion rule (e.g. spending your last token)? Returns the rule or null.
// Would taking these effects (and then arriving at `target`, running its onEnter) use up a stat
// that ends the game? Used to put a "⚠" warning on risky choices so danger is always signposted.
// The per-move Pixel Power tick is not included (the countdown bar shows that).
export function wouldDeplete(book, state, effects, target = null) {
  const arrive = target && book.sections[target]?.onEnter?.length && !book.sections[target]?.ending;
  if (!effects?.length && !arrive) return null;
  const sim = JSON.parse(JSON.stringify(state));
  applyEffects(book, sim, effects, []);
  if (arrive) {
    sim.current = target;
    sim.visited[target] = (sim.visited[target] || 0) + 1;
    applyEffects(book, sim, book.sections[target].onEnter, []);
  }
  for (const r of depletionRules(book)) {
    const limit = r.atOrBelow ?? statBounds(book, sim, r.stat).min;
    if ((sim.stats[r.stat] ?? Infinity) <= limit) return { stat: r.stat, name: book.stats?.[r.stat]?.name || r.stat, target: r.target };
  }
  return null;
}

// Tracker progress, e.g. the Zodiac Collection: [{id, label, met:[ids], total, complete}]
export function trackerProgress(book, state) {
  return (book.trackers || []).map((t) => {
    const met = t.entries.filter((e) => state.flags[e.flag]).map((e) => e.id);
    return { id: t.id, label: t.label, met, total: t.entries.length, complete: met.length === t.entries.length, badge: t.completeBadge || null };
  });
}

export function useItem(book, state, itemId, rng = Math.random) {
  const def = book.items?.[itemId];
  if (!def?.use) throw new Error('Item cannot be used');
  if (itemCount(state, itemId) < 1) throw new Error('You do not have that');
  if (state.ended) throw new Error('Game has ended');
  if (!checkCondition(book, state, def.use.conditions)) throw new Error('Cannot use that now');
  const messages = [];
  if (def.use.consumable !== false) applyEffects(book, state, [{ removeItem: itemId }], []);
  applyEffects(book, state, def.use.effects, messages);
  checkDepleted(book, state, messages, rng);
  return messages;
}

// ---------- score ----------
// book.scoring = { components: [{id, label, points, stat | tracker | items: 'found'|'used'}],
//                  reference: number | { byStartStat, values: { "<start value>": number } },
//                  ranks: [{ min, title }] (highest min first) }
// Each component is value × points. The total is shown as a percentage of the reference: the
// best possible total (found by exhaustive search, see scripts/score-reference.mjs), so the
// optimal path scores exactly 100%. The reference can depend on a rolled starting stat (Luck)
// so that every starting roll can still reach 100%.
export function scoreReference(book, state) {
  const ref = book.scoring?.reference;
  if (typeof ref === 'number') return ref;
  if (!ref) return null;
  const start = state.statMax?.[ref.byStartStat];
  return ref.values?.[String(start)] ?? null;
}
export function scoreRaw(book, state) {
  const sc = book.scoring;
  if (!sc) return null;
  const components = sc.components.map((c) => {
    let value = 0;
    if (c.stat) value = Math.max(0, state.stats[c.stat] ?? 0);
    else if (c.tracker) value = trackerProgress(book, state).find((t) => t.id === c.tracker)?.met.length ?? 0;
    else if (c.items === 'found') value = Object.keys(state.found || {}).length;
    else if (c.items === 'used') value = Object.keys(state.used || {}).length;
    return { id: c.id, label: c.label, value, each: c.points, points: value * c.points };
  });
  return { components, raw: components.reduce((a, c) => a + c.points, 0) };
}
export function computeScore(book, state) {
  const r = scoreRaw(book, state);
  if (!r) return null;
  const reference = scoreReference(book, state);
  const percent = reference ? Math.max(0, Math.min(100, Math.floor((100 * r.raw) / reference + 1e-9))) : null;
  const ranks = [...(book.scoring.ranks || [])].sort((a, b) => b.min - a.min);
  const rank = percent === null ? null : ranks.find((k) => percent >= k.min)?.title || null;
  return { ...r, reference, percent, rank };
}

// ---------- static analysis (used by tests and dev warnings) ----------
export function sectionTargets(sec) {
  const t = [];
  for (const c of sec.choices || []) t.push(c.target);
  if (sec.test) t.push(sec.test.success.target, sec.test.failure.target);
  if (sec.combat) { t.push(sec.combat.win.target, sec.combat.lose.target); if (sec.combat.flee) t.push(sec.combat.flee.target); }
  if (sec.riddle) t.push(sec.riddle.success.target, sec.riddle.retreat.target);
  return t;
}

export function lintBook(book) {
  const errors = [];
  const warnings = [];
  const S = book.sections || {};
  const items = book.items || {};
  const stats = book.stats || {};
  const chars = book.characters || {};
  for (const t of book.trackers || []) for (const e of t.entries) {
    if (!(book.flags || {})[e.flag]) errors.push(`tracker ${t.id}: flag ${e.flag} is not declared`);
    if (e.character && !chars[e.character]) errors.push(`tracker ${t.id}: unknown character ${e.character}`);
  }
  if (!S[book.start]) errors.push(`start section "${book.start}" does not exist`);
  if (book.rules?.onHealthDepleted && !S[book.rules.onHealthDepleted]) errors.push('rules.onHealthDepleted target missing');
  for (const r of book.rules?.depletion || []) {
    if (!stats[r.stat]) errors.push(`rules.depletion: unknown stat ${r.stat}`);
    if (!S[r.target]) errors.push(`rules.depletion: target "${r.target}" does not exist`);
  }
  if (book.rules?.healthStat && !stats[book.rules.healthStat]) errors.push('rules.healthStat is not a defined stat');
  if (book.rules?.combat?.attackStat && !stats[book.rules.combat.attackStat]) errors.push('rules.combat.attackStat is not a defined stat');
  for (const e of book.startingInventory || []) { const id = typeof e === 'string' ? e : e.item; if (!items[id]) errors.push(`startingInventory: unknown item ${id}`); }

  const walkCond = (where, c) => {
    if (!c) return;
    if ('hasItem' in c && !items[c.hasItem]) errors.push(`${where}: unknown item ${c.hasItem}`);
    if ('notHasItem' in c && !items[c.notHasItem]) errors.push(`${where}: unknown item ${c.notHasItem}`);
    if ('stat' in c && !stats[c.stat]) errors.push(`${where}: unknown stat ${c.stat}`);
    if ('visited' in c && !S[c.visited]) errors.push(`${where}: unknown section ${c.visited}`);
    for (const k of ['all', 'any']) if (c[k]) c[k].forEach((x) => walkCond(where, x));
    if (c.not) walkCond(where, c.not);
  };
  const walkEff = (where, list) => {
    for (const e of list || []) {
      if ('stat' in e && !stats[e.stat]) errors.push(`${where}: unknown stat ${e.stat}`);
      if ('addItem' in e && !items[e.addItem]) errors.push(`${where}: unknown item ${e.addItem}`);
      if ('removeItem' in e && !items[e.removeItem]) errors.push(`${where}: unknown item ${e.removeItem}`);
      if ('if' in e) { walkCond(where, e.if); walkEff(where, e.then); walkEff(where, e.else); }
    }
  };
  walkEff('rules.perMoveEffects', book.rules?.perMoveEffects);
  for (const [id, it] of Object.entries(items)) if (it.use) { walkEff(`item ${id}`, it.use.effects); walkCond(`item ${id}`, it.use.conditions); }

  for (const [id, sec] of Object.entries(S)) {
    const where = `section ${id}`;
    for (const t of sectionTargets(sec)) if (!S[t]) errors.push(`${where}: target "${t}" does not exist`);
    walkEff(where, sec.onEnter);
    if (Array.isArray(sec.text)) sec.text.forEach((p) => typeof p === 'object' && walkCond(where, p.if));
    (sec.choices || []).forEach((c, i) => { walkCond(`${where} choice ${i}`, c.conditions); walkCond(`${where} choice ${i}`, c.hideIf); walkEff(`${where} choice ${i}`, c.effects); });
    if (sec.test) {
      if (sec.test.againstStat && !stats[sec.test.againstStat]) errors.push(`${where}: unknown stat ${sec.test.againstStat}`);
      walkEff(where, sec.test.costEffects); walkEff(where, sec.test.success.effects); walkEff(where, sec.test.failure.effects);
    }
    if (sec.combat) {
      const cs = combatSettings(book, sec);
      if (!stats[cs.attackStat]) errors.push(`${where}: combat needs an attack stat`);
      if (!stats[cs.healthStat]) errors.push(`${where}: combat needs a health stat`);
    }
    if (sec.riddle) {
      const rd = sec.riddle;
      if (rd.character && !chars[rd.character]) errors.push(`${where}: unknown character ${rd.character}`);
      rd.questions.forEach((q, i) => { if (q.answer < 0 || q.answer >= q.options.length) errors.push(`${where}: riddle ${i} answer index out of range`); });
      walkEff(where, rd.onCorrect); walkEff(where, rd.success.effects); walkEff(where, rd.retreat.effects);
      (rd.wrong?.options || []).forEach((o, i) => { walkCond(`${where} penalty ${i}`, o.conditions); walkEff(`${where} penalty ${i}`, o.effects); });
      if (!(rd.wrong?.options || []).some((o) => !o.conditions)) warnings.push(`${where}: riddle has no always-available penalty (player could get stuck)`);
      if (sec.choices?.length || sec.test || sec.combat) warnings.push(`${where}: riddle section also has choices/test/combat`);
    }
    for (const ch of sec.illustration?.characters || []) if (!chars[ch.id]) errors.push(`${where}: illustration uses unknown character ${ch.id}`);
    if (sec.ending && (sec.choices?.length || sec.test || sec.combat)) warnings.push(`${where}: ending section also has choices/test/combat (ignored)`);
    if (!sec.ending && !sectionTargets(sec).length) errors.push(`${where}: dead end (no choices, test, combat or ending)`);
  }
  // reachability (ignores conditions: "could be reached")
  const seen = new Set();
  const stack = [book.start];
  for (const r of depletionRules(book)) stack.push(r.target);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !S[id]) continue;
    seen.add(id);
    stack.push(...sectionTargets(S[id]));
  }
  for (const id of Object.keys(S)) if (!seen.has(id)) warnings.push(`section ${id} is unreachable`);
  const endings = Object.entries(S).filter(([, s]) => s.ending);
  if (!endings.some(([, s]) => s.ending.type === 'win')) warnings.push('book has no winning ending');
  return { errors, warnings, reachable: seen.size, total: Object.keys(S).length, endings: endings.map(([id, s]) => ({ id, type: s.ending.type })) };
}
