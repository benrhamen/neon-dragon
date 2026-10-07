import * as E from './engine.js';
import { drawAvatar, drawSprite, avatarGrid, SKINS, SKIN_NAMES, HAIR_COLORS, OUTFITS, HAIR_STYLES, ACCESSORIES, EXTRAS, LABELS, defaultAvatar, randomAvatar, normalizeAvatar } from './avatar.js';
import { sfx, setSound, soundOn } from './sound.js';
import * as LB from './leaderboard.js';
import { makeVoucherCode, normalizeVoucher, VOUCHER_BONUS, VOUCHER_BONUS_TEXT } from './voucher.js';

const BOOK_URL = 'data/neon-dragon.json';
const SETTINGS_KEY = 'gb.settings.v1';
const VOUCHERS_USED_KEY = 'gb.vouchers.used.v1'; // PLAY AGAIN voucher codes already redeemed on this device
const usedVouchers = () => { try { return JSON.parse(localStorage.getItem(VOUCHERS_USED_KEY)) || []; } catch { return []; } };
const VOUCHERS_ISSUED_KEY = 'gb.vouchers.issued.v1'; // tickets won on this device (so a reload can't lose one)
const issuedVouchers = () => { try { return JSON.parse(localStorage.getItem(VOUCHERS_ISSUED_KEY)) || []; } catch { return []; } };
const params = new URLSearchParams(location.search);
const rng = E.makeRng(params.get('seed'));
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || params.has('nomotion');

// Every game is independent: the only things kept between games are the Best Scores tables and
// the sound setting. The current run is autosaved (so a reload resumes it) and cleared when it ends.
let book = null;
let player = null; // { name, avatar } for this run only
let state = null;
let prevStats = {};
let prevStars = null; // bonus stars last drawn in the HUD (for the star-burst on a new one)
let lastRenderedSection = null;
let busy = false;
let scoreRecorded = false;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOCK = '<svg class="lock" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M2 0h4v1H2zM1 1h1v3H1zM6 1h1v3H6zM0 3h8v5H0z"/><path fill="#0b0820" d="M3 5h2v2H3z"/></svg>';

function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { console.warn('Could not save', e); } }
const bookId = () => book.metadata.id || book.metadata.title;
const runKey = () => `gb.run.v1.${bookId()}`;
const persist = () => { if (state && player && !state.ended) saveJSON(runKey(), { player, state }); };
const clearRun = () => { try { localStorage.removeItem(runKey()); } catch { /* ignore */ } };
const T = (s) => E.interpolate(s, { name: player?.name || 'PLAYER' });
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));

// ---------------- boot ----------------
async function boot() {
  const settings = loadJSON(SETTINGS_KEY, { sound: true });
  setSound(settings.sound !== false);
  updateSoundBtn();
  wireChrome();
  try {
    const res = await fetch(BOOK_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    book = await res.json();
    if (book.riddlePool) {
      const rp = await fetch(new URL(book.riddlePool, new URL(BOOK_URL, location.href)), { cache: 'no-cache' });
      if (!rp.ok) throw new Error(rp.status);
      E.attachRiddlePool(book, await rp.json());
    }
  } catch (e) {
    $('#story').innerHTML = `<div class="loading">COULD NOT LOAD THE BOOK.<br><small>Open this site through a web server (see README), not as a file.</small></div>`;
    return;
  }
  const lint = E.lintBook(book);
  lint.errors.forEach((m) => console.error('[book]', m));
  lint.warnings.forEach((m) => console.warn('[book]', m));
  document.title = `${book.metadata.title} · Pixel Gamebook`;
  $('#bookCredit').textContent = `${book.metadata.title} v${book.metadata.version}${book.metadata.original ? ' · original story' : ''} · ${book.metadata.license.name}`;
  // tidy up data from older versions (per-player profiles and saves are gone)
  try { Object.keys(localStorage).filter((k) => k.startsWith('gb.profiles.') || k.startsWith('gb.save.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

  const saved = loadJSON(runKey(), null);
  if (saved?.player?.name && saved.state && saved.state.saveVersion === E.SAVE_VERSION && saved.state.bookId === bookId()
      && book.sections[saved.state.current] && !saved.state.ended) {
    player = saved.player;
    state = saved.state;
    beginRender();
    toast(`WELCOME BACK, ${player.name}!`, 'info');
  } else {
    clearRun();
    newRun();
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !params.has('nosw')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      // check for a new version now and whenever the tab comes back to the front
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    // a new worker took over: offer a reload (the run is autosaved, so nothing is lost)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || document.querySelector('.update-banner')) return;
      const b = document.createElement('button');
      b.className = 'update-banner'; b.dataset.testid = 'update-banner';
      b.textContent = 'NEW VERSION! TAP TO RELOAD';
      b.addEventListener('click', () => location.reload());
      document.body.appendChild(b);
    });
  }
}

// Start a brand-new game: always a blank creator (name + hero from scratch).
function newRun() {
  clearRun();
  state = null;
  player = null;
  scoreRecorded = false;
  renderTitle();
  openCreator();
}

function beginRender() {
  prevStats = { ...state.stats };
  prevStars = null;
  lastRenderedSection = null;
  scoreRecorded = !!state.ended;
  document.body.classList.add('in-game');
  renderAll();
}

function syncTopbarHeight() {
  document.documentElement.style.setProperty('--tb', $('.topbar').offsetHeight + 'px');
}

function wireChrome() {
  syncTopbarHeight();
  window.addEventListener('resize', syncTopbarHeight);
  if (window.ResizeObserver) new ResizeObserver(syncTopbarHeight).observe($('.topbar'));
  $('#soundBtn').addEventListener('click', () => {
    setSound(!soundOn()); saveJSON(SETTINGS_KEY, { sound: soundOn() }); updateSoundBtn(); sfx.select();
  });
  $('#restartBtn').addEventListener('click', async () => {
    if (!book) return;
    if (!state || state.ended) return newRun();
    if (await confirmModal('START OVER?', 'This adventure will end and you will make a brand-new hero.', 'RESTART')) newRun();
  });
  $('#scoresBtn').addEventListener('click', () => book && openScores());
}

function updateSoundBtn() {
  const b = $('#soundBtn');
  b.classList.toggle('off', !soundOn());
  b.setAttribute('aria-pressed', String(soundOn()));
  b.title = soundOn() ? 'Sound on' : 'Sound off';
}

// ---------------- rendering ----------------
function renderTitle() {
  document.body.classList.remove('in-game');
  $('#story').innerHTML = `<div class="title-screen"><div class="logo big"><span class="logo-main">NEON DRAGON</span><span class="logo-sub">OF PIXEL HARBOUR</span></div><p class="blink">INSERT COIN</p><button class="btn btn-ghost" data-testid="title-scores">🏆 BEST SCORES</button></div>`;
  $('[data-testid=title-scores]').addEventListener('click', () => openScores());
  renderHeroCard();
}

function renderAll() {
  renderHeroCard();
  renderStory();
  renderStats();
  renderInventory();
  renderJourney();
}

function renderHeroCard() {
  const nameEl = $('#heroName');
  if (player) {
    drawAvatar($('#heroAvatar'), player.avatar);
    nameEl.textContent = player.name;
  } else {
    drawAvatar($('#heroAvatar'), defaultAvatar());
    nameEl.textContent = '—';
  }
  const best = book ? LB.bestLocal(bookId()) : null;
  const mine = book && player ? LB.bestLocal(bookId(), player.name) : null;
  $('#heroBest').innerHTML = `${mine ? `<span>YOUR BEST <b data-testid="hero-best">${mine.score_pct}%</b></span>` : ''}${best ? `<span>HI-SCORE <b data-testid="hero-hiscore">${best.score_pct}%</b> ${esc(best.nickname)}</span>` : '<span>HI-SCORE <b>—</b></span>'}`;
}

// Character sprites drawn on top of a scene, on the scene's pixel grid (default 96×54).
function drawOverlay(canvas, ill) {
  const g = ill.grid || { w: 96, h: 54 };
  canvas.width = g.w; canvas.height = g.h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, g.w, g.h);
  for (const ch of ill.characters || []) {
    const sp = book.characters?.[ch.id]?.sprite;
    if (sp) paintSprite(ctx, sp, ch.x, ch.y, ch.scale || 1, ch.flip);
  }
}
function paintSprite(ctx, sp, ox, oy, scale = 1, flip = false) {
  const w = Math.max(...sp.rows.map((r) => r.length));
  sp.rows.forEach((row, y) => [...row].forEach((c, x) => {
    const col = sp.palette[c];
    if (!col || c === '.' || c === ' ') return;
    ctx.fillStyle = col;
    ctx.fillRect(ox + (flip ? w - 1 - x : x) * scale, oy + y * scale, scale, scale);
  }));
}
function illustrationHTML(ill) {
  if (!ill) return '';
  if (ill.src) return `<figure class="illus"><span class="illus-box"><img class="${ill.pixelated === false ? '' : 'pix'}" src="${esc(ill.src)}" alt="${esc(ill.alt || '')}" width="768" height="432">${ill.characters?.length ? '<canvas class="pix illus-chars" data-chars aria-hidden="true"></canvas>' : ''}</span></figure>`;
  if (ill.sprite) return `<figure class="illus sprite-illus"><canvas class="pix" data-illus></canvas></figure>`;
  return '';
}

function renderStory() {
  const sec = book.sections[state.current];
  const el = $('#story');
  const changed = lastRenderedSection !== state.current + ':' + state.history.length;
  const paras = E.sectionParagraphs(book, state, sec);
  el.innerHTML = `
    <div class="sec-head">
      <span class="page-no" data-testid="move-count">MOVE ${state.moves || 0}</span>
      <h1 class="sec-title" data-testid="section-title">${esc(T(sec.title || ''))}</h1>
    </div>
    ${state.ended ? '<div class="ending-first" id="endingSlot"></div>' : ''}
    ${state.ended?.style === 'trapped' ? '' : illustrationHTML(sec.illustration)}
    <div class="sec-text ${changed ? 'fresh' : ''}" data-testid="section-text">${paras.map((p, i) => `<p style="--d:${i}">${esc(T(p))}</p>`).join('')}</div>
    <div class="actions" id="actions"></div>`;
  el.dataset.section = state.current;
  if (sec.illustration?.sprite) drawSprite($('[data-illus]', el), sec.illustration.sprite);
  const ov = $('[data-chars]', el);
  if (ov) drawOverlay(ov, sec.illustration);
  renderActions();
  if (changed && lastRenderedSection !== null) {
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    if (window.scrollY > top) window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  lastRenderedSection = state.current + ':' + state.history.length;
}

// Locked-choice hint. CSS adds "NEEDS: " in front, except when the hint already says "Needs ..."
// or is a full sentence of its own (the Gremlin Goggles alarm, "If only someone had warned you...").
const needSpan = (t) => `<span class="need${/^needs\b/i.test(t) || /[!.]$/.test(t) ? ' own' : ''}">${esc(t)}</span>`;
// No "⚠ X WOULD RUN OUT" warnings on choices: running out of a stat is a surprise (the game-over
// screen still explains what ran out).

function renderActions() {
  const box = $('#actions');
  if (state.ended) { box.innerHTML = ''; return renderEnding($('#endingSlot')); }
  if (state.pending?.kind === 'test') return renderTest(box);
  if (state.pending?.kind === 'combat') return renderCombat(box);
  if (state.pending?.kind === 'riddle') return renderRiddle(box);
  const opts = E.availableChoices(book, state).filter((c) => !c.hidden);
  box.innerHTML = `<div class="choices" data-testid="choices">${opts.map((c) => c.available
    ? `<button class="choice" data-choice="${c.index}"><span class="cursor">▶</span><span class="choice-label">${esc(T(c.label))}</span></button>`
    : `<button class="choice locked" disabled aria-disabled="true"><span class="cursor">${LOCK}</span><span class="choice-label">${esc(T(c.label))}${needSpan(c.need)}</span></button>`).join('')}</div>`;
  $$('.choice[data-choice]', box).forEach((b) => b.addEventListener('click', () => act(() => E.choose(book, state, +b.dataset.choice, rng))));
}

// ---- riddles (an NPC asks multiple-choice questions) ----
// After a wrong answer the right one is shown too, so every riddle teaches something.
function explainHTML(q, showAnswer = false) {
  const ans = showAnswer ? `The answer was <b>${esc(T(q.options[q.answer]))}</b>. ` : '';
  return ans || q.explain ? `<p class="riddle-explain" data-testid="riddle-explain">${ans}${q.explain ? esc(T(q.explain)) : ''}</p>` : '';
}
function renderRiddle(box) {
  const r = E.currentRiddle(book, state);
  const p = state.pending;
  const rd = book.sections[state.current].riddle;
  const npc = book.characters?.[rd.character];
  const total = r.total;
  let body = '';
  if (p.picked === null) {
    body = `
      <div class="riddle-q" data-testid="riddle-question">${esc(T(r.question.question))}</div>
      <div class="riddle-options">${r.question.options.map((o, i) => `<button class="choice riddle-opt" data-opt="${i}" data-testid="riddle-option-${i}"><span class="cursor">${'ABCD'[i] || i + 1}</span><span class="choice-label">${esc(T(o))}</span></button>`).join('')}</div>
      <button class="btn btn-ghost riddle-retreat" data-testid="riddle-retreat">↩ ${esc(T(rd.retreat.label || 'Head back and take another path'))}</button>`;
  } else if (p.correct) {
    body = `<div class="result ok" data-testid="riddle-result" data-correct="true">CORRECT!</div>${r.question.correctText ? `<p class="outcome">${esc(T(r.question.correctText))}</p>` : ''}${explainHTML(r.question)}
      <button class="btn btn-big" data-testid="continue">CONTINUE ▶</button>`;
  } else if (p.penaltyDue) {
    const pens = E.riddlePenalties(book, state);
    body = `<div class="result bad" data-testid="riddle-result" data-correct="false">WRONG!</div>
      <p class="outcome">${esc(T(r.question.wrongText || rd.wrong?.text || 'Wrong! Choose your penalty.'))}</p>${explainHTML(r.question, true)}
      <div class="riddle-penalty" data-testid="riddle-penalty">${pens.map((o) => o.available
        ? `<button class="choice" data-pen="${o.index}" data-testid="penalty-${o.index}"><span class="cursor">▶</span><span class="choice-label">${esc(T(o.label))}</span></button>`
        : `<button class="choice locked" disabled data-testid="penalty-${o.index}"><span class="cursor">${LOCK}</span><span class="choice-label">${esc(T(o.label))}${needSpan(o.need)}</span></button>`).join('')}</div>`;
  } else {
    body = `<div class="result bad" data-testid="riddle-result" data-correct="false">PENALTY PAID</div>${r.untilCorrect
      ? `<p class="outcome">${esc((npc?.name || 'They').toUpperCase())} HAS ANOTHER RIDDLE FOR YOU. YOU CAN STILL HEAD BACK BEFORE ANSWERING IT.</p><button class="btn btn-big" data-testid="continue">NEXT RIDDLE ▶</button>`
      : '<button class="btn btn-big" data-testid="continue">CONTINUE ▶</button>'}`;
  }
  box.innerHTML = `
    <div class="riddle" data-testid="riddle" data-character="${esc(rd.character)}">
      <div class="riddle-head">
        <canvas class="pix riddle-npc" data-npc></canvas>
        <div><div class="riddle-name">${esc((npc?.name || rd.character).toUpperCase())}</div>
        <div class="riddle-count" data-testid="riddle-count">${r.untilCorrect ? `RIDDLE ${r.index + 1}${r.question.category ? ` · ${esc(r.question.category.toUpperCase())}` : ''}${r.index ? ' · TRY AGAIN!' : ''}` : total > 1 ? `RIDDLE ${Math.min(r.index + 1, total)} OF ${total}` : `ONE RIDDLE${r.question.category ? ` · ${esc(r.question.category.toUpperCase())}` : ''}`}</div></div>
      </div>
      ${body}
    </div>`;
  if (npc?.sprite) drawSprite($('[data-npc]', box), npc.sprite);
  $$('[data-opt]', box).forEach((b) => b.addEventListener('click', () => {
    act(() => E.answerRiddle(book, state, +b.dataset.opt, rng), { sound: state.pending && r.question.answer === +b.dataset.opt ? 'coin' : 'hurt' });
  }));
  $$('[data-pen]', box).forEach((b) => b.addEventListener('click', () => act(() => E.payRiddlePenalty(book, state, +b.dataset.pen, rng))));
  $('[data-testid=riddle-retreat]', box)?.addEventListener('click', () => act(() => E.retreatRiddle(book, state, rng)));
  $('[data-testid=continue]', box)?.addEventListener('click', () => act(() => E.continueRiddle(book, state, rng)));
}

// ---- dice ----
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieHTML(v, cls = '') {
  return `<div class="die ${cls}" data-value="${v || ''}" aria-label="${v ? 'die showing ' + v : 'die'}">${Array.from({ length: 9 }, (_, i) => `<i class="${v && PIPS[v].includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;
}
function setDie(el, v) {
  el.dataset.value = v;
  $$('i', el).forEach((pip, i) => pip.classList.toggle('on', PIPS[v].includes(i)));
}
async function animateDice(els, finals) {
  sfx.roll();
  els.forEach((e) => e.classList.add('rolling'));
  const frames = reduceMotion ? 0 : 9;
  for (let f = 0; f < frames; f++) {
    els.forEach((e) => setDie(e, 1 + Math.floor(Math.random() * 6)));
    await sleep(65);
  }
  els.forEach((e, i) => { setDie(e, finals[i]); e.classList.remove('rolling'); e.classList.add('landed'); });
}

function renderTest(box) {
  const t = book.sections[state.current].test;
  const p = state.pending;
  const statName = t.againstStat ? book.stats[t.againstStat].name.toUpperCase() : '';
  const { count } = E.parseDice(t.dice || '2d6');
  const goal = p.roll ? p.roll.goal : state.stats[t.againstStat];
  const goalLine = t.type === 'gamble' ? gambleLine(t) : t.againstStat
    ? `NEED ${goal} OR LESS <small>(YOUR ${statName})</small>${goal < count ? '<div class="warn" data-testid="luck-empty">YOUR ' + statName + ' IS TOO LOW: THIS CAN\'T SUCCEED</div>' : ''}`
    : `NEED ${t.target} OR MORE`;
  box.innerHTML = `
    <div class="dice-box" data-testid="dice-test">
      <div class="dice-label">${esc(t.label || 'ROLL THE DICE')}</div>
      ${t.prompt ? `<p class="dice-prompt">${esc(T(t.prompt))}</p>` : ''}
      <div class="goal">${goalLine}</div>
      <div class="dice-row">${Array.from({ length: count }, (_, i) => dieHTML(p.roll ? p.roll.rolls[i] : (i % 6) + 1)).join('')}</div>
      <div class="dice-result" id="diceResult"></div>
      <div class="dice-buttons"></div>
    </div>`;
  const btns = $('.dice-buttons', box);
  if (!p.roll) {
    btns.innerHTML = '<button class="btn btn-big" data-testid="roll">ROLL DICE</button>';
    $('button', btns).addEventListener('click', async (ev) => {
      if (busy) return; busy = true; ev.currentTarget.disabled = true;
      const { roll, messages, diverted } = E.rollTest(book, state, rng);
      persist(); // the result is locked in: reloading can't re-roll
      await animateDice($$('.die', box), roll.rolls);
      busy = false;
      if (diverted) return afterAction(messages);
      showMessages(messages);
      renderStats();
      renderTest(box);
    });
  } else showTestResult(box, t, p);
}
// Dice gamble: always show the odds, so kids can see that gambling usually doesn't pay.
const pct = (x) => `${Math.round(x * 100)}%`;
function gambleLine(t) {
  const g = E.gambleRules(book, t);
  const o = E.gambleOdds(book, t);
  const nm = (book.stats[g.stat]?.name || g.stat).toUpperCase();
  return `<div class="gamble-odds" data-testid="gamble-odds"><span class="g-win">WIN ${g.winAt}+ (${pct(o.win)})</span> · <span class="g-half">${g.halfOn} = HALF ${esc(nm)} (${pct(o.half)})</span> · <span class="g-lose">${g.halfOn - 1} OR LESS LOSE -${g.loseBy} ${esc(nm)} (${pct(o.lose)})</span></div>
    <div class="gamble-note">YOU LOSE MORE OFTEN THAN YOU WIN: ${pct(o.half + o.lose)} OF ROLLS ARE BAD NEWS!</div>`;
}
function showTestResult(box, t, p) {
  const gamble = t.type === 'gamble';
  const half = gamble && p.outcome === 'half';
  const out = half ? E.sevenOutcome(t) : p.success ? t.success : t.failure;
  const gs = gamble ? (book.stats[E.gambleRules(book, t).stat]?.name || '').toUpperCase() : '';
  const verdict = gamble ? (p.success ? 'YOU WIN!' : half ? `${p.roll.total}: LOSE HALF YOUR ${gs}!` : `YOU LOSE! -${E.gambleRules(book, t).loseBy} ${gs}`) : p.success ? 'SUCCESS!' : 'FAILED!';
  $('#diceResult', box).innerHTML = `<div class="result ${p.success ? 'ok' : 'bad'}" data-testid="test-result">ROLLED ${p.roll.total} · ${verdict}</div>${out.text ? `<p class="outcome">${esc(T(out.text))}</p>` : ''}`;
  $('.dice-buttons', box).innerHTML = `<button class="btn btn-big" data-testid="continue">CONTINUE ▶</button>`;
  $('.dice-buttons button', box).addEventListener('click', () => act(() => E.continueAfterTest(book, state, rng)));
}

// ---- combat ----
function renderCombat(box) {
  const sec = book.sections[state.current];
  const c = sec.combat;
  const p = state.pending;
  const cs = E.combatSettings(book, sec);
  const enemy = c.enemies[p.enemyIndex];
  const hpMax = E.statBounds(book, state, cs.healthStat).max;
  const hp = state.stats[cs.healthStat];
  const last = p.rounds[p.rounds.length - 1];
  const nm = player.name;
  const { count } = E.parseDice(cs.dice);
  const dmg = E.combatDamage(book, state, sec, enemy);
  const boostsHTML = c.boosts?.length ? `<div class="boosts" data-testid="boosts">${c.boosts.map((b) => {
    const on = dmg.boosts.includes(b);
    const fx = [b.attack && `+${b.attack} ATK`, b.armor && `-${b.armor} DMG`, b.stun && `BOT -${b.stun} HP`, b.note && esc(T(b.note).toUpperCase())].filter(Boolean).join(' · ');
    return `<span class="boost ${on ? 'on' : ''}" data-testid="boost">${on ? '✔' : '·'} ${esc(T(b.label).toUpperCase())}: ${fx}</span>`;
  }).join('')}</div>` : '';
  box.innerHTML = `
    <div class="combat ${enemy.damage && enemy.damage > cs.damage ? 'boss' : ''}" data-testid="combat">
      ${c.intro ? `<p class="combat-intro">${esc(T(c.intro))}</p>` : ''}
      <div class="fighters">
        <div class="fighter you ${last?.winner === 'enemy' ? 'hit' : ''}">
          <canvas class="pix fighter-img" data-you></canvas>
          <div class="fname">${esc(nm)}</div>
          <div class="hpbar"><i style="width:${Math.max(0, (hp / hpMax) * 100)}%"></i></div>
          <div class="fstat">${esc(book.stats[cs.healthStat].name.toUpperCase())} ${hp}/${hpMax}</div>
          <div class="fstat dim" data-testid="your-attack">ATTACK ${state.stats[cs.attackStat] + dmg.attack}${dmg.attack ? ` <span class="ok">(+${dmg.attack})</span>` : ''}</div>
          <div class="dice-row small" data-pd>${Array.from({ length: count }, (_, i) => dieHTML(last ? last.playerRolls[i] : null)).join('')}</div>
        </div>
        <div class="vs">VS</div>
        <div class="fighter foe ${last?.winner === 'player' ? 'hit' : ''}">
          <canvas class="pix fighter-img" data-foe></canvas>
          <div class="fname">${esc(enemy.name)}</div>
          <div class="hpbar foe-bar"><i style="width:${(p.enemyHealth / enemy.health) * 100}%"></i></div>
          <div class="fstat" data-testid="enemy-hp">HP ${p.enemyHealth}/${enemy.health}</div>
          <div class="fstat dim">ATTACK ${enemy.attack} · BOP -${dmg.enemy}</div>
          <div class="dice-row small" data-ed>${Array.from({ length: count }, (_, i) => dieHTML(last ? last.enemyRolls[i] : null)).join('')}</div>
        </div>
      </div>
      ${boostsHTML}
      <div class="round-log" data-testid="round-log">${last ? roundText(last, nm, cs) : 'ROUND 1 · PRESS ATTACK TO ROLL!'}</div>
      <div class="combat-buttons"></div>
    </div>`;
  drawAvatar($('[data-you]', box), player.avatar);
  if (enemy.sprite) drawSprite($('[data-foe]', box), enemy.sprite);
  const btns = $('.combat-buttons', box);
  if (p.result) {
    const out = p.result === 'win' ? c.win : c.lose;
    btns.innerHTML = `<div class="result ${p.result === 'win' ? 'ok' : 'bad'}" data-testid="combat-result">${p.result === 'win' ? 'YOU WIN THE DUEL!' : 'DEFEATED!'}</div>${out.text ? `<p class="outcome">${esc(T(out.text))}</p>` : ''}<button class="btn btn-big" data-testid="continue">CONTINUE ▶</button>`;
    $('button', btns).addEventListener('click', () => act(() => E.continueAfterCombat(book, state, rng)));
    return;
  }
  // RUN AWAY is offered every round until the duel is decided, as a big button next to ATTACK
  // (it used to be a dim ghost button that was easy to miss, and below the fold on phones).
  btns.innerHTML = `<button class="btn btn-big btn-attack" data-testid="attack">ATTACK! <small>(ROLL)</small></button>${c.flee
    ? `<button class="btn btn-big btn-flee" data-testid="flee">🏃 ${esc(T(c.flee.label || 'RUN AWAY!'))}</button>
       <div class="flee-hint" data-testid="flee-hint">${p.round ? `ROUND ${p.round + 1}: ` : ''}YOU CAN STILL RUN AWAY UNTIL THE DUEL IS DECIDED</div>` : ''}`;
  if (p.round) btns.scrollIntoView({ block: 'nearest' });
  $('[data-testid=attack]', btns).addEventListener('click', async () => {
    if (busy) return; busy = true;
    $$('button', btns).forEach((b) => (b.disabled = true));
    let res;
    try {
      res = E.combatRound(book, state, rng);
      persist();
      await animateDice([...$$('[data-pd] .die', box), ...$$('[data-ed] .die', box)], [...res.round.playerRolls, ...res.round.enemyRolls]);
    } catch (e) { console.error(e); } finally { busy = false; }
    if (!res) return renderCombat(box);
    const { round, messages, diverted } = res;
    if (round.winner === 'enemy') sfx.hurt(); else if (round.winner === 'player') sfx.coin();
    if (diverted) return afterAction(messages);
    showMessages(messages, { silent: true });
    renderStats();
    renderCombat(box);
  });
  if (c.flee) $('[data-testid=flee]', btns).addEventListener('click', () => { busy = false; act(() => E.flee(book, state, rng)); });
}
function roundText(r, nm, cs) {
  const you = `${esc(nm)}: ${r.playerRolls.join('+')}+${r.playerTotal - r.playerRolls.reduce((a, b) => a + b, 0)}${r.boost ? ` (INCL. +${r.boost} BOOST)` : ''} = <b>${r.playerTotal}</b>`;
  const foe = `${esc(r.enemy)}: ${r.enemyRolls.join('+')}+${r.enemyTotal - r.enemyRolls.reduce((a, b) => a + b, 0)} = <b>${r.enemyTotal}</b>`;
  const res = r.winner === 'player' ? `<span class="ok">YOU LAND A BOP! (-${r.damage ?? cs.damage})</span>` : r.winner === 'enemy' ? `<span class="bad">OUCH! YOU GET BOPPED (-${r.damage ?? cs.damage})</span>` : '<span>BLOCKED! NOBODY IS HURT</span>';
  return `ROUND ${r.n} · ${you} · ${foe}<br>${res}${r.nextEnemy ? `<br>NEXT UP: ${esc(r.nextEnemy)}!` : ''}`;
}

// ---- endings ----
const zodiacTotal = () => book?.trackers?.find((t) => t.id === 'zodiac')?.entries.length || 12;
function zodiacInfo() { return E.trackerProgress(book, state).find((t) => t.id === 'zodiac') || null; }

function renderEnding(box) {
  const end = state.ended;
  $('#toasts').innerHTML = ''; // clear pop-ups so they never cover the ending buttons
  if (end.style === 'trapped') return renderTrapped(box);
  const kind = end.type === 'win' ? 'win' : end.type === 'neutral' ? 'neutral' : 'lose';
  const banner = { win: 'YOU WIN!', neutral: 'THE END', lose: 'GAME OVER' }[kind];
  const stars = end.stars ?? (kind === 'win' ? 3 : 0);
  const z = zodiacInfo();
  const score = kind === 'win' ? E.computeScore(book, state) : null;
  box.innerHTML = `
    <div class="ending ending-${kind}" data-testid="ending" data-ending-type="${esc(end.type)}">
      <div class="ending-banner">${banner}</div>
      <div class="ending-title">${esc(T(end.title))}</div>
      <div class="stars" aria-label="${stars} of 3 stars">${[0, 1, 2].map((i) => `<span class="star ${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
      ${z?.complete ? `<div class="badge-master" data-testid="zodiac-master">★ ${esc(z.badge || 'COMPLETE')} ★</div>` : ''}
      ${kind === 'win' && z?.complete ? legendHTML(z) : ''}
      <div class="ending-stats">
        <div><b>${state.moves || 0}</b><span>MOVES</span></div>
        <div><b data-testid="end-zodiac">${z ? `${z.met.length}/${z.total}` : '-'}</b><span>ZODIAC</span></div>
        <div><b>${new Set(state.history).size}</b><span>PLACES</span></div>
        ${endStarsHTML()}
      </div>
      ${score ? scoreBoardHTML(score) : `<p class="no-score">NO SCORE THIS TIME. ONLY HEROES WHO SAVE PIXEL HARBOUR GET A SCORE!</p>`}
      <div class="ending-buttons">
        <button class="btn btn-big btn-start" data-testid="play-again">PLAY AGAIN</button>
        <button class="btn btn-ghost" data-testid="end-scores">🏆 BEST SCORES</button>
      </div>
    </div>`;
  wireEndingButtons(box);
  if (score) finishScore(box, score);
  if (kind === 'win' && z?.complete) { $('[data-testid=print-voucher]', box)?.addEventListener('click', () => window.print()); sfx.win(); }
}

// The hidden all-12-zodiac route: LEGEND! with fireworks, and a PLAY AGAIN VOUCHER ticket. The code
// is made once and kept with the finished run, so reloading shows the same ticket.
function legendHTML(z) {
  if (!state.voucher) {
    const d = new Date();
    state.voucher = { code: makeVoucherCode(), name: player.name, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
    persist();
    try { localStorage.setItem(VOUCHERS_ISSUED_KEY, JSON.stringify([...issuedVouchers(), state.voucher].slice(-20))); } catch { /* storage full: the ticket is still on screen */ }
  }
  const v = state.voucher;
  const fw = Array.from({ length: 7 }, (_, i) => `<i class="fw fw${i}"></i>`).join('');
  return `
    <div class="legend" data-testid="legend">
      <div class="fireworks" aria-hidden="true">${fw}</div>
      <div class="legend-word" data-text="LEGEND!">LEGEND!</div>
      <div class="legend-sub">ALL ${z.total} ZODIAC ANIMALS · ${z.met.length}/${z.total}</div>
    </div>
    <div class="voucher" data-testid="voucher">
      <div class="v-holes" aria-hidden="true"></div>
      <div class="v-head">★ PLAY AGAIN VOUCHER ★</div>
      <div class="v-game">NEON DRAGON OF PIXEL HARBOUR</div>
      <div class="v-row"><span>HERO</span><b data-testid="voucher-name">${esc(v.name)}</b></div>
      <div class="v-row"><span>DATE</span><b data-testid="voucher-date">${esc(v.date)}</b></div>
      <div class="v-row"><span>FOR</span><b>ALL ${z.total} ZODIAC · LEGEND!</b></div>
      <div class="v-code" data-testid="voucher-code">${esc(v.code)}</div>
      <div class="v-small">TYPE THIS CODE IN THE HERO CREATOR BEFORE YOUR NEXT GAME FOR ${VOUCHER_BONUS_TEXT}. ONE USE ONLY.</div>
    </div>
    <div class="voucher-actions"><button class="btn btn-small" data-testid="print-voucher">🖨 PRINT VOUCHER</button><span class="dim">OR TAKE A SCREENSHOT!</span></div>`;
}

function endStarsHTML() {
  if (!E.bonusStarsEnabled(book)) return '';
  return `<div class="end-stars"><b data-testid="end-stars"><span class="star-pix"><i class="pstar"></i></span>${state.bonusStars || 0}</b><span>BONUS STARS</span></div>`;
}

function scoreBoardHTML(score) {
  return `
    <div class="score-screen" data-testid="score-screen">
      <div class="score-head">SCORE</div>
      <div class="score-rows">${score.components.map((c, i) => `
        <div class="score-row" style="--i:${i}" data-testid="score-${c.id}"><span class="sr-label">${esc(c.label)}</span><span class="sr-calc">${c.value} × ${c.each}</span><span class="sr-pts">${c.points}</span></div>`).join('')}
        <div class="score-row total" style="--i:${score.components.length}"><span class="sr-label">TOTAL</span><span class="sr-calc">/ ${score.reference ?? '?'}</span><span class="sr-pts">${score.raw}</span></div>
      </div>
      <div class="score-pct" data-testid="score-pct" style="--i:${score.components.length + 1}">${score.percent ?? '--'}<small>%</small></div>
      <div class="score-rank" data-testid="score-rank" style="--i:${score.components.length + 2}">${esc(score.rank || '')}</div>
      <div class="score-status" id="scoreStatus"></div>
    </div>`;
}

// Save the score on this device (once per run) and offer the shared board.
function finishScore(box, score) {
  const status = $('#scoreStatus', box);
  const z = zodiacInfo();
  const entry = { nickname: player.name, avatar: player.avatar, score_pct: score.percent ?? 0, rank: score.rank || '', zodiac_count: z ? z.met.length : 0, bonus_stars: state.bonusStars || 0 };
  if (!scoreRecorded) {
    const before = LB.bestLocal(bookId());
    const pos = LB.addLocalScore(bookId(), entry);
    scoreRecorded = true;
    state.scorePosition = pos;
    state.newHigh = !before || entry.score_pct > before.score_pct;
    renderHeroCard();
  }
  const pos = state.scorePosition;
  status.innerHTML = `${state.newHigh ? '<div class="new-high blink" data-testid="new-high">NEW HIGH SCORE!</div>' : ''}
    <div class="dim">${pos ? `#${pos} ON THIS DEVICE` : 'NOT IN THIS DEVICE\'S TOP 10'}</div>
    ${LB.globalConfigured() ? '<button class="btn btn-small" data-testid="post-global">POST TO WORLD TOP 50</button><div class="nick-tip">Posts your nickname, hero and score. No real names!</div>' : ''}`;
  $('[data-testid=post-global]', status)?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; b.textContent = 'SENDING...';
    try {
      await LB.submitGlobal(entry);
      b.outerHTML = '<div class="ok" data-testid="post-result">SENT TO THE WORLD BOARD!</div>';
      sfx.coin();
    } catch (e) {
      console.warn('global board', e);
      b.outerHTML = '<div class="bad" data-testid="post-result">WORLD BOARD OFFLINE. YOUR SCORE IS SAVED ON THIS DEVICE.</div>';
    }
  });
}

function wireEndingButtons(box) {
  $('[data-testid=play-again]', box).addEventListener('click', () => { sfx.select(); newRun(); });
  $('[data-testid=end-scores]', box)?.addEventListener('click', () => openScores());
}

// The dramatic "trapped in the game" ending: glitchy GAME OVER, your hero stuck behind the glass.
function renderTrapped(box) {
  const end = state.ended;
  const cause = end.cause ? book.stats[end.cause.stat]?.name?.toUpperCase() : null;
  box.innerHTML = `
    <div class="ending ending-trapped" data-testid="ending" data-ending-type="${esc(end.type)}" data-style="trapped">
      <div class="glitch" data-text="GAME OVER">GAME OVER</div>
      <div class="ending-title trapped-title" data-testid="trapped-title">${esc(T(end.title))}</div>
      ${cause ? `<div class="trapped-cause" data-testid="trapped-cause">YOUR ${esc(cause)} RAN OUT</div>` : ''}
      <canvas class="pix trapped-art" id="trappedArt" width="192" height="108" aria-label="Your hero trapped inside the arcade machine"></canvas>
      <div class="continue-count" aria-hidden="true">CONTINUE? <b id="contNum">9</b></div>
      <div class="ending-stats">
        <div><b>${state.moves || 0}</b><span>MOVES</span></div>
        <div><b data-testid="end-zodiac">${zodiacInfo() ? `${zodiacInfo().met.length}/${zodiacInfo().total}` : '-'}</b><span>ZODIAC</span></div>
        ${endStarsHTML()}
      </div>
      <div class="ending-buttons">
        <button class="btn btn-big btn-start insert-coin-btn" data-testid="play-again">INSERT COIN · PLAY AGAIN</button>
        <button class="btn btn-ghost" data-testid="end-scores">🏆 BEST SCORES</button>
      </div>
    </div>`;
  wireEndingButtons(box);
  drawTrapped($('#trappedArt', box));
  let n = 9;
  const tick = () => {
    const el = document.getElementById('contNum');
    if (!el) return;
    n = Math.max(0, n - 1);
    el.textContent = n;
    if (n > 0) setTimeout(tick, reduceMotion ? 0 : 900); else el.parentElement.classList.add('done');
  };
  if (!reduceMotion) setTimeout(tick, 900); else { $('#contNum', box).textContent = '0'; }
}

function drawTrapped(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const W = 192, H = 108;
  const ill = book.sections[state.current].illustration;
  const finish = () => {
    // the hero, small and sad, inside the cabinet screen, behind bars
    const grid = avatarGrid(player.avatar);
    const tmp = document.createElement('canvas');
    drawAvatar(tmp, player.avatar);
    void grid;
    const sx = 80, sy = 26, sc = 2;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(tmp, sx, sy, 16 * sc, 16 * sc);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#9aa3c7';
    for (let x = sx - 4; x <= sx + 16 * sc + 4; x += 6) ctx.fillRect(x, sy - 4, 2, 16 * sc + 6);
    ctx.fillRect(sx - 4, sy - 4, 16 * sc + 10, 2);
    ctx.fillRect(sx - 4, sy + 16 * sc, 16 * sc + 10, 2);
  };
  if (ill?.src) {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, W, H); finish(); };
    img.onerror = () => { ctx.fillStyle = '#0b0820'; ctx.fillRect(0, 0, W, H); finish(); };
    img.src = ill.src;
  } else { ctx.fillStyle = '#0b0820'; ctx.fillRect(0, 0, W, H); finish(); }
}

// ---- side panels ----
function renderStats() {
  const wrap = $('#stats');
  const hud = $('#miniHud');
  const rows = [];
  const mini = [];
  for (const [id, def] of Object.entries(book.stats || {})) {
    if (def.hidden) continue;
    const v = state.stats[id];
    const { max } = E.statBounds(book, state, id);
    const delta = prevStats[id] !== undefined ? v - prevStats[id] : 0;
    const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
    const icon = def.sprite ? `<canvas class="pix stat-sprite" data-sprite="${id}"></canvas>` : `<span class="stat-icon">${esc(def.icon || '')}</span>`;
    if (def.display === 'timer') {
      // countdown bar: the initial value is "full"; bonuses can push it past full
      const full = Math.max(typeof def.initial === 'number' ? def.initial : state.statMax[id] || v, 1);
      const pct = Math.max(0, Math.min(100, (v / full) * 100));
      const low = v <= 10;
      rows.push(`
        <div class="stat timer ${cls} ${low ? 'low' : ''}" data-stat="${id}" style="--c:${def.color || '#29e7ff'}" title="${esc(def.description || '')}">
          <div class="stat-top"><span class="stat-name">${icon}${esc(def.name.toUpperCase())}</span><span class="stat-val" data-testid="stat-${id}">${v}</span></div>
          <div class="bar timer-bar"><i style="width:${pct}%"></i>${v > full ? '<em class="bonus">+BONUS</em>' : ''}</div>
          <div class="timer-note">${low ? '⚠ ' : ''}${v} MOVE${v === 1 ? '' : 'S'} LEFT</div>
        </div>`);
    } else {
      const shown = Number.isFinite(max) ? max : v;
      const pct = shown > 0 ? Math.max(0, Math.min(100, (v / shown) * 100)) : 0;
      const note = id === 'luck' && v <= 1 ? '<div class="timer-note warn-note">LUCK TESTS WILL FAIL</div>' : '';
      rows.push(`
        <div class="stat ${cls}" data-stat="${id}" style="--c:${def.color || '#29e7ff'}" title="${esc(def.description || '')}">
          <div class="stat-top"><span class="stat-name">${icon}${esc(def.name.toUpperCase())}</span><span class="stat-val" data-testid="stat-${id}">${v}${def.display === 'number' ? '' : `<small>/${shown}</small>`}</span></div>
          ${def.display === 'number' ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`}${note}
        </div>`);
    }
    mini.push(`<span class="mini-stat ${cls} ${def.display === 'timer' && v <= 10 ? 'low' : ''}" style="--c:${def.color || '#29e7ff'}">${esc(def.short || def.name)} <b>${v}</b></span>`);
  }
  // timed status effects (e.g. POISONED x5): a badge with the moves left, ticking down each move
  for (const [id, left] of Object.entries(state.status || {})) {
    if (!(left > 0)) continue;
    const def = book.statusEffects?.[id] || {};
    const label = `${esc(def.icon || '!')} ${esc((def.badge || def.name || id).toUpperCase())} x${left}`;
    rows.push(`<div class="status-badge" data-testid="status-${esc(id)}" data-left="${left}" style="--c:${def.color || '#7dff4a'}" title="${esc(def.description || '')}">${label}<small>${left} MOVE${left === 1 ? '' : 'S'} LEFT</small></div>`);
    mini.push(`<span class="mini-stat mini-status" data-testid="mini-status-${esc(id)}" style="--c:${def.color || '#7dff4a'}">${esc(def.icon || '!')} <b>x${left}</b></span>`);
  }
  const starsOn = E.bonusStarsEnabled(book);
  const nStars = state.bonusStars || 0;
  const newStar = starsOn && prevStars !== null && nStars > prevStars;
  if (starsOn) {
    rows.push(starsPanelHTML(nStars, newStar));
    mini.push(`<span class="mini-stat mini-stars ${newStar ? 'up' : ''}" data-testid="mini-stars"><i class="pstar"></i> <b>${nStars}</b></span>`);
  }
  prevStars = nStars;
  wrap.innerHTML = rows.join('');
  if (newStar) { const el = $('[data-testid=stars-panel]', wrap); setTimeout(() => el?.classList.remove('burst'), 1300); }
  $$('[data-sprite]', wrap).forEach((c) => drawSprite(c, book.stats[c.dataset.sprite].sprite));
  const items = Object.entries(state.inventory).filter(([, q]) => q > 0);
  mini.push(`<button class="mini-stat mini-inv" data-jump="inventory">BAG <b>${items.length}</b></button>`);
  hud.innerHTML = mini.join('');
  $('[data-jump]', hud)?.addEventListener('click', () => $('#inventory').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  prevStats = { ...state.stats };
}

// Bonus stars: a sparkly, purely cosmetic counter (one per won luck roll). A new star plays a
// pixel star-burst: 8 little pixel squares fly out from the star and the number pops.
function starsPanelHTML(n, burst) {
  const sparks = Array.from({ length: 8 }, (_, i) => `<i class="spark s${i}"></i>`).join('');
  const twinkles = Array.from({ length: Math.min(n, 12) }, (_, i) => `<i class="tw" style="--d:${(i * 0.37) % 2}s"></i>`).join('');
  return `
        <div class="stat stars-stat ${burst ? 'burst' : ''}" data-testid="stars-panel" title="Bonus stars: win a luck roll to earn one. Just for fun: they don't count in your score and can't be spent.">
          <div class="stat-top"><span class="stat-name"><span class="star-pix" aria-hidden="true"><i class="pstar"></i><span class="burst-sparks">${sparks}</span></span>BONUS STARS</span><span class="stat-val stars-val" data-testid="stars">${n}</span></div>
          <div class="star-twinkles" aria-hidden="true">${twinkles || '<span class="stars-hint">WIN A LUCK ROLL!</span>'}</div>
          <div class="timer-note stars-note">NOT IN YOUR SCORE</div>
        </div>`;
}

let openItem = null;
function renderInventory() {
  const wrap = $('#inventory');
  const entries = Object.entries(state.inventory).filter(([, q]) => q > 0);
  if (!entries.length) { wrap.innerHTML = '<div class="empty">EMPTY POCKETS</div>'; $('#itemDetail').hidden = true; return; }
  wrap.innerHTML = entries.map(([id, q]) => {
    const it = book.items[id] || { name: id };
    return `<button class="item ${openItem === id ? 'sel' : ''}" data-item="${id}" data-testid="item-${id}" title="${esc(it.name)}" aria-label="${esc(it.name)}${q > 1 ? ' × ' + q : ''}">
      ${it.sprite ? '<canvas class="pix"></canvas>' : `<span class="item-icon">${esc(it.icon || '?')}</span>`}
      ${q > 1 ? `<span class="qty">×${q}</span>` : ''}
      <span class="item-name">${esc(it.name)}</span>
    </button>`;
  }).join('');
  $$('.item', wrap).forEach((b) => {
    const it = book.items[b.dataset.item];
    if (it?.sprite) drawSprite($('canvas', b), it.sprite);
    b.addEventListener('click', () => { openItem = openItem === b.dataset.item ? null : b.dataset.item; sfx.select(); renderInventory(); });
  });
  const det = $('#itemDetail');
  if (openItem && state.inventory[openItem]) {
    const it = book.items[openItem];
    const canUse = it.use && !state.ended && E.checkCondition(book, state, it.use.conditions);
    det.hidden = false;
    det.innerHTML = `<div class="item-detail-name">${esc(it.name)}</div><p>${esc(T(it.description || ''))}</p>${it.use ? `<button class="btn btn-small" data-testid="use-item" ${canUse ? '' : 'disabled'}>${esc(it.use.label.toUpperCase())}</button>` : ''}`;
    $('[data-testid=use-item]', det)?.addEventListener('click', () => {
      const id = openItem; openItem = null;
      act(() => E.useItem(book, state, id, rng));
    });
  } else { det.hidden = true; openItem = null; }
}

function renderJourney() {
  const zwrap = $('#zodiac');
  const trackers = E.trackerProgress(book, state);
  zwrap.innerHTML = trackers.map((t) => {
    const def = book.trackers.find((x) => x.id === t.id);
    return `<div class="tracker" data-testid="tracker-${t.id}">
      <div class="tracker-head"><span>${esc(def.label)}</span><b data-testid="tracker-count">${t.met.length}/${t.total}</b></div>
      <div class="tracker-grid">${def.entries.map((e) => `<div class="tk ${t.met.includes(e.id) ? 'met' : ''}" title="${esc(t.met.includes(e.id) ? e.name : '???')}"><canvas class="pix" data-tk="${esc(e.character || '')}"></canvas></div>`).join('')}</div>
      ${t.complete ? `<div class="badge-master small">★ ${esc(t.badge || 'COMPLETE')} ★</div>` : ''}
    </div>`;
  }).join('');
  $$('[data-tk]', zwrap).forEach((c) => { const sp = book.characters?.[c.dataset.tk]?.sprite; if (sp) drawSprite(c, sp); });
  const list = $('#journey');
  const hist = state.history;
  const start = Math.max(0, hist.length - 8);
  list.start = start + 1;
  list.innerHTML = hist.slice(start).map((id, i) => `<li class="${start + i === hist.length - 1 ? 'here' : ''}">${esc(T(book.sections[id]?.title || id))}</li>`).join('');
}

// ---------------- actions & feedback ----------------
function act(fn, { sound } = {}) {
  if (busy) return;
  let msgs;
  try {
    const out = fn();
    msgs = Array.isArray(out) ? out : out?.messages || [];
  } catch (e) { console.error(e); toast(e.message.toUpperCase(), 'bad'); return; }
  afterAction(msgs, sound);
}
function afterAction(msgs, sound) {
  if (state.ended) clearRun(); else persist();
  renderAll();
  if (msgs.some((m) => m.halved)) glitch();
  if (state.ended) {
    state.ended.type === 'win' ? sfx.win() : state.ended.type === 'neutral' ? sfx.select() : sfx.lose();
    showMessages(msgs, { silent: true });
  } else {
    showMessages(msgs, { silent: !!sound });
    if (sound) sfx[sound]?.();
  }
}
function glitch() {
  document.body.classList.remove('halved');
  void document.body.offsetWidth;
  document.body.classList.add('halved');
  setTimeout(() => document.body.classList.remove('halved'), 700);
}

function showMessages(msgs, { silent = false } = {}) {
  let sound = 'select';
  msgs.forEach((m, i) => {
    let kind = 'info';
    if (m.type === 'stat') kind = m.delta > 0 ? 'good' : 'bad';
    if (m.type === 'item') kind = m.delta > 0 ? 'good' : 'bad';
    if (m.halved) kind = 'halved';
    if (m.type === 'depleted') kind = 'bad';
    if (m.type === 'star') kind = 'star';
    if (m.type === 'status') kind = m.cured || m.wornOff ? 'good' : 'poison';
    if ((kind === 'good' || kind === 'star') && sound === 'select') sound = 'coin';
    if ((kind === 'bad' || kind === 'halved') && m.type === 'stat') sound = 'hurt';
    if (kind === 'poison') sound = 'hurt';
    setTimeout(() => toast(m.text.toUpperCase(), kind), i * 180);
  });
  if (!silent) sfx[sound]();
}

function toast(text, kind = 'info') {
  // no pop-ups over the GAME OVER / ending screens (they covered the buttons)
  if (state?.ended) return;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  if (kind === 'star') { t.insertAdjacentHTML('afterbegin', '<i class="pstar"></i> '); t.insertAdjacentHTML('beforeend', ' <i class="pstar"></i>'); }
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2700);
}

// ---------------- modals ----------------
function openModal(html, { dismissible = true, cls = '', testid = 'modal', onClose = null } = {}) {
  closeModal();
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${cls}" role="dialog" aria-modal="true" data-testid="${testid}">${html}</div></div>`;
  const back = $('.modal-backdrop', root);
  if (dismissible) {
    const close = () => { closeModal(); onClose?.(); };
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  document.body.classList.add('modal-open');
  return $('.modal', root);
}
function closeModal() { $('#modalRoot').innerHTML = ''; document.body.classList.remove('modal-open'); }

function confirmModal(title, text, yes = 'YES') {
  return new Promise((resolve) => {
    const m = openModal(`<h2 class="modal-title">${esc(title)}</h2><p class="modal-text">${esc(text)}</p><div class="modal-buttons"><button class="btn btn-ghost" data-no>CANCEL</button><button class="btn" data-yes data-testid="confirm-yes">${esc(yes)}</button></div>`, { cls: 'small', testid: 'confirm', onClose: () => resolve(false) });
    $('[data-yes]', m).addEventListener('click', () => { closeModal(); resolve(true); });
    $('[data-no]', m).addEventListener('click', () => { closeModal(); resolve(false); });
    $('[data-yes]', m).focus();
  });
}

// The hero creator. Every new game starts here with a blank name and the default hero; it can't
// be dismissed: the only way on is PRESS START.
function openCreator() {
  const av = defaultAvatar();
  delete av.label;
  const swatches = (key, colors, names) => `<div class="swatches" role="radiogroup" aria-label="${key}">${colors.slice(0, 8).map((c, i) => `<button class="swatch" role="radio" data-key="${key}" data-val="${i}" style="--s:${c}" aria-label="${key} ${names ? names[i] : i + 1}"></button>`).join('')}</div>`;
  const toggles = EXTRAS.map((k) => `<button class="btn btn-small toggle" data-extra="${k}" aria-pressed="false" data-testid="extra-${k}">${LABELS[k]}</button>`).join('');
  const cycler = (key) => `<div class="cycler" data-key="${key}"><button class="arrow" data-dir="-1" aria-label="previous ${key}">◀</button><span class="cycle-val" data-val-for="${key}"></span><button class="arrow" data-dir="1" aria-label="next ${key}">▶</button></div>`;
  const m = openModal(`
    <div class="creator-head">
      <div class="insert-coin blink">PLAYER 1 · INSERT COIN</div>
      <h2 class="creator-title">CREATE YOUR HERO</h2>
    </div>
    <div class="creator-grid">
      <div class="stage">
        <div class="stage-spot"></div>
        <canvas class="pix big-avatar" id="cAvatar" data-testid="avatar-preview"></canvas>
        <div class="stage-floor"></div>
        <div class="stage-name" id="cEcho">???</div>
      </div>
      <div class="controls">
        <div class="ctl-label">BUILD YOUR HERO <button class="btn btn-small btn-ghost" id="cRandom" data-testid="randomize">? RANDOM</button></div>
        <div class="ctl-row"><span>SKIN</span>${swatches('skin', SKINS, SKIN_NAMES)}</div>
        <div class="ctl-row"><span>HAIR</span>${cycler('hairStyle')}</div>
        <div class="ctl-row"><span>COLOR</span>${swatches('hairColor', HAIR_COLORS)}</div>
        <div class="ctl-row"><span>OUTFIT</span>${swatches('outfit', OUTFITS)}</div>
        <div class="ctl-row"><span>EXTRA</span>${cycler('accessory')}</div>
        <div class="ctl-row"><span>ADD-ONS</span><div class="toggles" role="group" aria-label="add-ons">${toggles}</div></div>
        <label class="ctl-label" for="cName">ENTER A NICKNAME</label>
        <input id="cName" class="name-input" maxlength="${LB.NICK_MAX}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="NICKNAME" data-testid="name-input" value="">
        <div class="nick-tip" data-testid="nick-tip">Use a nickname, not your real name. Max ${LB.NICK_MAX} letters.</div>
        <div class="nick-problem" id="cProblem" data-testid="nick-problem"></div>
        <label class="ctl-label" for="cVoucher">GOT A PLAY AGAIN VOUCHER? <small>(OPTIONAL)</small></label>
        <div class="voucher-row"><input id="cVoucher" class="name-input voucher-input" maxlength="14" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ND-XXXX-XXXX" data-testid="voucher-input"><button class="btn btn-small" id="cRedeem" data-testid="voucher-redeem">REDEEM</button></div>
        <div class="voucher-msg" id="cVMsg" data-testid="voucher-msg"></div>
        ${(() => { const v = issuedVouchers().reverse().find((x) => !usedVouchers().includes(x.code)); return v ? `<button class="link-btn" id="cSavedV" data-code="${esc(v.code)}" data-testid="voucher-saved">USE YOUR SAVED VOUCHER ${esc(v.code)} (${esc(v.name)})</button>` : ''; })()}
      </div>
    </div>
    <div class="creator-foot">
      <button class="btn btn-ghost" id="cScores" data-testid="creator-scores">🏆 BEST SCORES</button>
      <button class="btn btn-start" id="cStart" data-testid="press-start">PRESS START</button>
    </div>`, { dismissible: false, cls: 'creator', testid: 'avatar-modal' });

  const preview = $('#cAvatar', m);
  const nameIn = $('#cName', m);
  const startBtn = $('#cStart', m);
  const lists = { hairStyle: HAIR_STYLES, accessory: ACCESSORIES };
  const refresh = () => {
    drawAvatar(preview, av);
    $$('.swatch', m).forEach((s) => { const on = av[s.dataset.key] === +s.dataset.val; s.classList.toggle('on', on); s.setAttribute('aria-checked', String(on)); });
    for (const k of Object.keys(lists)) $(`[data-val-for=${k}]`, m).textContent = LABELS[av[k]] || av[k];
    $$('[data-extra]', m).forEach((b) => { const on = !!av[b.dataset.extra]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.textContent = `${on ? '✔ ' : ''}${LABELS[b.dataset.extra]}`; });
    const nm = LB.cleanNickname(nameIn.value);
    const problem = nm ? LB.nicknameProblem(nm) : null;
    $('#cEcho', m).textContent = nm || '???';
    $('#cProblem', m).textContent = problem || '';
    startBtn.disabled = !nm || !!problem;
  };
  $$('.swatch', m).forEach((s) => s.addEventListener('click', () => { av[s.dataset.key] = +s.dataset.val; sfx.select(); refresh(); }));
  $$('.cycler', m).forEach((c) => $$('.arrow', c).forEach((a) => a.addEventListener('click', () => {
    const list = lists[c.dataset.key];
    av[c.dataset.key] = list[(list.indexOf(av[c.dataset.key]) + +a.dataset.dir + list.length) % list.length];
    sfx.select(); refresh();
  })));
  $$('[data-extra]', m).forEach((b) => b.addEventListener('click', () => { const k = b.dataset.extra; if (av[k]) delete av[k]; else av[k] = true; sfx.select(); refresh(); }));
  $('#cRandom', m).addEventListener('click', () => { const r = randomAvatar(); delete r.label; for (const k of EXTRAS) delete av[k]; Object.assign(av, r); sfx.select(); refresh(); });
  nameIn.addEventListener('input', () => { const c = nameIn.value.toUpperCase(); if (c !== nameIn.value) nameIn.value = c; refresh(); });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !startBtn.disabled) startBtn.click(); });
  $('#cScores', m).addEventListener('click', () => openScores({ back: openCreator }));
  // PLAY AGAIN voucher (earned on the LEGEND! finale): checked here, used up when the game starts
  let voucher = null;
  const vIn = $('#cVoucher', m), vMsg = $('#cVMsg', m);
  const redeem = () => {
    const code = normalizeVoucher(vIn.value);
    voucher = null;
    vMsg.className = 'voucher-msg bad';
    if (!vIn.value.trim()) vMsg.textContent = '';
    else if (!code) vMsg.textContent = 'THAT CODE ISN\'T VALID. CHECK THE TICKET!';
    else if (usedVouchers().includes(code)) vMsg.textContent = 'THAT VOUCHER HAS ALREADY BEEN USED.';
    else { voucher = code; vIn.value = code; vMsg.className = 'voucher-msg ok'; vMsg.textContent = `✓ VOUCHER OK! ${VOUCHER_BONUS_TEXT} WHEN YOU PRESS START`; sfx.coin(); }
  };
  $('#cRedeem', m).addEventListener('click', redeem);
  $('#cSavedV', m)?.addEventListener('click', (ev) => { vIn.value = ev.currentTarget.dataset.code; redeem(); });
  vIn.addEventListener('input', () => { voucher = null; vMsg.textContent = ''; });
  vIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });
  startBtn.addEventListener('click', () => {
    const name = LB.cleanNickname(nameIn.value);
    if (!name || LB.nicknameProblem(name)) return;
    player = { name, avatar: normalizeAvatar(av) };
    const useVoucher = voucher && !usedVouchers().includes(voucher);
    state = E.newGame(book, { rng, playerName: name, riddleSeed: params.get('riddleSeed') ? +params.get('riddleSeed') : null, ...(useVoucher ? { bonusEffects: VOUCHER_BONUS, bonusLabel: `voucher ${voucher}` } : {}) }).state;
    if (useVoucher) localStorage.setItem(VOUCHERS_USED_KEY, JSON.stringify([...usedVouchers(), voucher]));
    closeModal();
    persist();
    beginRender();
    sfx.start();
    toast(`GET READY, ${name}!`, 'good');
    if (useVoucher) toast(`VOUCHER REDEEMED: ${VOUCHER_BONUS_TEXT}!`, 'good');
  });
  refresh();
  setTimeout(() => nameIn.focus({ preventScroll: true }), 50);
}

// ---------------- best scores ----------------
function scoreRowsHTML(rows) {
  if (!rows.length) return '<div class="empty" data-testid="scores-empty">NO SCORES YET. BE THE FIRST!</div>';
  return `<table class="scores-table" data-testid="scores-table"><thead><tr><th>#</th><th></th><th>NAME</th><th>SCORE</th><th>RANK</th><th>ZODIAC</th><th class="st" title="Bonus stars: just for fun, not part of the score"><i class="pstar"></i> STARS</th><th>DATE</th></tr></thead><tbody>${rows.map((r, i) => `
    <tr class="${i === 0 ? 'top' : ''}" data-testid="score-row"><td>${i + 1}</td><td><canvas class="pix score-av" data-av="${i}"></canvas></td><td class="nm">${esc(r.nickname)}</td><td class="pct">${r.score_pct}%</td><td class="rk">${esc(r.rank || '')}</td><td>${r.zodiac_count ?? 0}/${zodiacTotal()}</td><td class="st" data-testid="score-stars">${r.bonus_stars == null ? '-' : `<span class="star-pix"><i class="pstar"></i></span>${r.bonus_stars | 0}`}</td><td class="dt">${esc(String(r.created_at || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`;
}

function openScores({ back = null } = {}) {
  const goBack = () => { closeModal(); if (back) back(); else if (!state) openCreator(); };
  const m = openModal(`
    <h2 class="modal-title">🏆 BEST SCORES</h2>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="global" data-testid="tab-global">WORLD TOP 50</button>
      <button class="tab" role="tab" data-tab="local" data-testid="tab-local">MY DEVICE</button>
    </div>
    <div class="scores-body" data-testid="scores-body"></div>
    <div class="modal-buttons"><button class="btn" data-testid="scores-back">BACK</button></div>`,
  { cls: 'scores', testid: 'scores-modal', onClose: () => { if (back) back(); else if (!state) openCreator(); } });
  const body = $('.scores-body', m);
  const draw = (rows) => { body.innerHTML = scoreRowsHTML(rows); $$('[data-av]', body).forEach((c) => drawAvatar(c, rows[+c.dataset.av].avatar || defaultAvatar())); };
  const show = async (tab) => {
    $$('.tab', m).forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    if (tab === 'local') { draw(LB.localScores(bookId())); return; }
    if (!LB.globalConfigured()) { body.innerHTML = '<div class="empty" data-testid="global-offline">THE WORLD BOARD ISN\'T SET UP. SHOWING THIS DEVICE.</div>'; setTimeout(() => show('local'), reduceMotion ? 0 : 900); return; }
    body.innerHTML = '<div class="loading">LOADING<span class="blink">_</span></div>';
    try {
      const rows = await LB.fetchGlobal(50);
      if ($('.tab.on', m)?.dataset.tab === 'global') draw(rows);
    } catch (e) {
      console.warn('global board', e);
      if ($('.tab.on', m)?.dataset.tab !== 'global') return;
      body.innerHTML = `<div class="empty" data-testid="global-offline">WORLD BOARD OFFLINE. HERE ARE THIS DEVICE'S BEST:</div>`;
      const rows = LB.localScores(bookId());
      const holder = document.createElement('div');
      holder.innerHTML = scoreRowsHTML(rows);
      body.appendChild(holder);
      $$('[data-av]', body).forEach((c) => drawAvatar(c, rows[+c.dataset.av].avatar || defaultAvatar()));
    }
  };
  $$('.tab', m).forEach((t) => t.addEventListener('click', () => { sfx.select(); show(t.dataset.tab); }));
  $('[data-testid=scores-back]', m).addEventListener('click', goBack);
  show(LB.globalConfigured() ? 'global' : 'local');
}

boot();
