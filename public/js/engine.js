// Gamebook engine: pure state logic, no DOM. Works in the browser and in Node (tests).
// State is a plain JSON object so it can be saved to localStorage as-is.

export const SAVE_VERSION = 1;

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

export function itemCount(state, id) {
  return state.inventory[id] || 0;
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
      if ('add' in e) after = before + e.add;
      else if ('set' in e) after = e.set;
      else if (e.restore) after = statBounds(book, state, e.stat).max;
      after = clampStat(book, state, e.stat, after);
      state.stats[e.stat] = after;
      const d = after - before;
      if (d !== 0) messages.push({ type: 'stat', stat: e.stat, delta: d, text: `${book.stats?.[e.stat]?.name || e.stat} ${d > 0 ? '+' : ''}${d}` });
    } else if ('addItem' in e) {
      const def = book.items?.[e.addItem] || {};
      const q = e.quantity ?? 1;
      let next = itemCount(state, e.addItem) + q;
      if (!def.stackable) next = Math.min(next, 1);
      if (def.maxQuantity) next = Math.min(next, def.maxQuantity);
      const gained = next - itemCount(state, e.addItem);
      state.inventory[e.addItem] = next;
      if (gained > 0) messages.push({ type: 'item', item: e.addItem, delta: gained, text: `Got ${gained > 1 ? gained + '× ' : ''}${def.name || e.addItem}!` });
    } else if ('removeItem' in e) {
      const have = itemCount(state, e.removeItem);
      const q = Math.min(have, e.quantity ?? 1);
      const left = have - q;
      if (left > 0) state.inventory[e.removeItem] = left; else delete state.inventory[e.removeItem];
      if (q > 0) messages.push({ type: 'item', item: e.removeItem, delta: -q, text: `Lost ${q > 1 ? q + '× ' : ''}${book.items?.[e.removeItem]?.name || e.removeItem}` });
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

// If the health stat has hit its minimum, divert to the "depleted" section.
function checkDepleted(book, state, messages, rng) {
  const hs = book.rules?.healthStat;
  const target = book.rules?.onHealthDepleted;
  if (!hs || !target || state.ended) return false;
  const { min } = statBounds(book, state, hs);
  if ((state.stats[hs] ?? 1) <= min && state.current !== target) {
    enterSection(book, state, target, messages, rng);
    return true;
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
    state.ended = { type: sec.ending.type, title: sec.ending.title, stars: sec.ending.stars ?? null, section: id };
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
  }
  checkDepleted(book, state, messages, rng);
  return messages;
}

// ---------- player actions ----------
export function availableChoices(book, state) {
  const sec = book.sections[state.current];
  return (sec.choices || []).map((c, index) => {
    const ok = checkCondition(book, state, c.conditions);
    const hideIf = c.hideIf ? checkCondition(book, state, c.hideIf) : false;
    return { ...c, index, available: ok, hidden: hideIf || (!ok && !!c.hideIfLocked), need: ok ? '' : c.lockedHint || describeCondition(book, c.conditions) };
  });
}

export function choose(book, state, index, rng = Math.random) {
  if (state.ended) throw new Error('Game has ended');
  const sec = book.sections[state.current];
  const c = (sec.choices || [])[index];
  if (!c) throw new Error(`No choice ${index} in ${state.current}`);
  if (!checkCondition(book, state, c.conditions)) throw new Error('Choice is locked');
  if (state.pending && !state.pending.result && state.pending.kind === 'combat') throw new Error('Finish the fight first');
  const messages = [];
  applyEffects(book, state, c.effects, messages);
  if (checkDepleted(book, state, messages, rng)) return messages;
  enterSection(book, state, c.target, messages, rng);
  return messages;
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
  enterSection(book, state, out.target, messages, rng);
  return messages;
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
  // Losing a fight goes to its own lose target rather than the generic depleted section.
  if (p.result === 'win' && checkDepleted(book, state, messages, rng)) return messages;
  enterSection(book, state, out.target, messages, rng);
  return messages;
}

export function flee(book, state, rng = Math.random) {
  const sec = book.sections[state.current];
  const f = sec.combat?.flee;
  if (!f) throw new Error('Cannot flee');
  if (state.pending?.result) throw new Error('Combat already over');
  const messages = [];
  applyEffects(book, state, f.effects, messages);
  if (checkDepleted(book, state, messages, rng)) return messages;
  enterSection(book, state, f.target, messages, rng);
  return messages;
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

// ---------- static analysis (used by tests and dev warnings) ----------
export function sectionTargets(sec) {
  const t = [];
  for (const c of sec.choices || []) t.push(c.target);
  if (sec.test) t.push(sec.test.success.target, sec.test.failure.target);
  if (sec.combat) { t.push(sec.combat.win.target, sec.combat.lose.target); if (sec.combat.flee) t.push(sec.combat.flee.target); }
  return t;
}

export function lintBook(book) {
  const errors = [];
  const warnings = [];
  const S = book.sections || {};
  const items = book.items || {};
  const stats = book.stats || {};
  if (!S[book.start]) errors.push(`start section "${book.start}" does not exist`);
  if (book.rules?.onHealthDepleted && !S[book.rules.onHealthDepleted]) errors.push('rules.onHealthDepleted target missing');
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
  for (const [id, it] of Object.entries(items)) if (it.use) { walkEff(`item ${id}`, it.use.effects); walkCond(`item ${id}`, it.use.conditions); }

  for (const [id, sec] of Object.entries(S)) {
    const where = `section ${id}`;
    for (const t of sectionTargets(sec)) if (!S[t]) errors.push(`${where}: target "${t}" does not exist`);
    walkEff(where, sec.onEnter);
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
    if (sec.ending && (sec.choices?.length || sec.test || sec.combat)) warnings.push(`${where}: ending section also has choices/test/combat (ignored)`);
    if (!sec.ending && !sectionTargets(sec).length) errors.push(`${where}: dead end (no choices, test, combat or ending)`);
  }
  // reachability (ignores conditions: "could be reached")
  const seen = new Set();
  const stack = [book.start];
  if (book.rules?.onHealthDepleted) stack.push(book.rules.onHealthDepleted);
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
