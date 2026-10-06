import * as E from './engine.js';
import { drawAvatar, drawSprite, PRESETS, SKINS, HAIR_COLORS, OUTFITS, HAIR_STYLES, ACCESSORIES, LABELS, defaultAvatar, randomAvatar } from './avatar.js';
import { sfx, setSound, soundOn } from './sound.js';

const BOOK_URL = 'data/neon-dragon.json';
const PROFILES_KEY = 'gb.profiles.v1';
const SETTINGS_KEY = 'gb.settings.v1';
const params = new URLSearchParams(location.search);
const rng = E.makeRng(params.get('seed'));
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let book = null;
let profiles = { activeId: null, players: {} };
let state = null;
let prevStats = {};
let lastRenderedSection = null;
let busy = false;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOCK = '<svg class="lock" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M2 0h4v1H2zM1 1h1v3H1zM6 1h1v3H6zM0 3h8v5H0z"/><path fill="#0b0820" d="M3 5h2v2H3z"/></svg>';

function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { console.warn('Could not save', e); } }
const activePlayer = () => profiles.players[profiles.activeId];
const saveKey = (pid = profiles.activeId) => `gb.save.v1.${book.metadata.id}.${pid}`;
const persist = () => saveJSON(saveKey(), state);
const saveProfiles = () => saveJSON(PROFILES_KEY, profiles);
const T = (s) => E.interpolate(s, { name: activePlayer()?.name || 'PLAYER' });
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
  } catch (e) {
    $('#story').innerHTML = `<div class="loading">COULD NOT LOAD THE BOOK.<br><small>Open this site through a web server (see README), not as a file.</small></div>`;
    return;
  }
  const lint = E.lintBook(book);
  lint.errors.forEach((m) => console.error('[book]', m));
  lint.warnings.forEach((m) => console.warn('[book]', m));
  document.title = `${book.metadata.title} · Pixel Gamebook`;
  $('#bookCredit').textContent = `${book.metadata.title} v${book.metadata.version}${book.metadata.original ? ' · original story' : ''} · ${book.metadata.license.name}`;

  profiles = loadJSON(PROFILES_KEY, { activeId: null, players: {} });
  if (!activePlayer()) {
    renderEmpty();
    openCreator({ mode: 'first' });
  } else startOrResume();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !params.has('nosw')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function startOrResume() {
  const saved = loadJSON(saveKey(), null);
  const bookId = book.metadata.id || book.metadata.title;
  if (saved && saved.saveVersion === E.SAVE_VERSION && saved.bookId === bookId && book.sections[saved.current]) {
    state = saved;
  } else {
    state = E.newGame(book, { rng, playerName: activePlayer().name }).state;
    persist();
  }
  prevStats = { ...state.stats };
  lastRenderedSection = null;
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
    if (!state) return;
    if (await confirmModal('START OVER?', 'Your progress in this adventure will be lost.', 'RESTART')) restart();
  });
  $('#playerChip').addEventListener('click', () => book && openPlayerMenu());
  $('#editHeroBtn').addEventListener('click', () => book && activePlayer() && openCreator({ mode: 'edit' }));
}

function updateSoundBtn() {
  const b = $('#soundBtn');
  b.classList.toggle('off', !soundOn());
  b.setAttribute('aria-pressed', String(soundOn()));
  b.title = soundOn() ? 'Sound on' : 'Sound off';
}

function restart() {
  state = E.newGame(book, { rng, playerName: activePlayer().name }).state;
  prevStats = { ...state.stats };
  persist();
  lastRenderedSection = null;
  renderAll();
  sfx.start();
  toast('NEW GAME! Stats re-rolled.', 'info');
}

// ---------------- rendering ----------------
function renderEmpty() {
  $('#story').innerHTML = `<div class="title-screen"><div class="logo big"><span class="logo-main">NEON DRAGON</span><span class="logo-sub">OF PIXEL HARBOUR</span></div><p class="blink">INSERT COIN</p></div>`;
}

function renderAll() {
  renderPlayer();
  renderStory();
  renderStats();
  renderInventory();
  renderJourney();
}

function renderPlayer() {
  const p = activePlayer();
  if (!p) return;
  drawAvatar($('#chipAvatar'), p.avatar);
  drawAvatar($('#heroAvatar'), p.avatar);
  $('#chipName').textContent = p.name;
  $('#heroName').textContent = p.name;
}

function renderStory() {
  const sec = book.sections[state.current];
  const el = $('#story');
  const changed = lastRenderedSection !== state.current + ':' + state.history.length;
  const paras = Array.isArray(sec.text) ? sec.text : [sec.text];
  let illus = '';
  if (sec.illustration?.src) illus = `<figure class="illus"><img class="${sec.illustration.pixelated === false ? '' : 'pix'}" src="${esc(sec.illustration.src)}" alt="${esc(sec.illustration.alt || '')}" width="768" height="432"></figure>`;
  else if (sec.illustration?.sprite) illus = `<figure class="illus sprite-illus"><canvas class="pix" data-illus></canvas></figure>`;
  el.innerHTML = `
    <div class="sec-head">
      <span class="page-no">PAGE ${state.history.length}</span>
      <h1 class="sec-title" data-testid="section-title">${esc(T(sec.title || ''))}</h1>
    </div>
    ${state.ended ? '<div class="ending-first" id="endingSlot"></div>' : ''}
    ${illus}
    <div class="sec-text ${changed ? 'fresh' : ''}" data-testid="section-text">${paras.map((p, i) => `<p style="--d:${i}">${esc(T(p))}</p>`).join('')}</div>
    <div class="actions" id="actions"></div>`;
  el.dataset.section = state.current;
  if (sec.illustration?.sprite) drawSprite($('[data-illus]', el), sec.illustration.sprite);
  renderActions();
  if (changed && lastRenderedSection !== null) {
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    if (window.scrollY > top) window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  lastRenderedSection = state.current + ':' + state.history.length;
}

function renderActions() {
  const box = $('#actions');
  if (state.ended) { box.innerHTML = ''; return renderEnding($('#endingSlot')); }
  if (state.pending?.kind === 'test') return renderTest(box);
  if (state.pending?.kind === 'combat') return renderCombat(box);
  const opts = E.availableChoices(book, state).filter((c) => !c.hidden);
  box.innerHTML = `<div class="choices" data-testid="choices">${opts.map((c) => c.available
    ? `<button class="choice" data-choice="${c.index}"><span class="cursor">▶</span><span class="choice-label">${esc(T(c.label))}</span></button>`
    : `<button class="choice locked" disabled aria-disabled="true"><span class="cursor">${LOCK}</span><span class="choice-label">${esc(T(c.label))}<span class="need">${esc(c.need)}</span></span></button>`).join('')}</div>`;
  $$('.choice[data-choice]', box).forEach((b) => b.addEventListener('click', () => act(() => E.choose(book, state, +b.dataset.choice, rng))));
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
  const { count } = E.parseDice(t.dice);
  const goalLine = t.againstStat
    ? `NEED ${p.roll ? p.roll.goal : state.stats[t.againstStat]} OR LESS <small>(YOUR ${statName})</small>`
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
    btns.innerHTML = `<button class="btn btn-big" data-testid="roll">ROLL DICE</button>`;
    $('button', btns).addEventListener('click', async (ev) => {
      if (busy) return; busy = true; ev.currentTarget.disabled = true;
      const { roll, messages } = E.rollTest(book, state, rng);
      persist(); // the result is locked in: reloading can't re-roll
      await animateDice($$('.die', box), roll.rolls);
      busy = false;
      showMessages(messages);
      renderStats();
      renderTest(box);
    });
  } else showTestResult(box, t, p);
}
function showTestResult(box, t, p) {
  const out = p.success ? t.success : t.failure;
  $('#diceResult', box).innerHTML = `<div class="result ${p.success ? 'ok' : 'bad'}" data-testid="test-result">ROLLED ${p.roll.total} · ${p.success ? 'SUCCESS!' : 'FAILED!'}</div>${out.text ? `<p class="outcome">${esc(T(out.text))}</p>` : ''}`;
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
  const nm = activePlayer().name;
  const { count } = E.parseDice(cs.dice);
  box.innerHTML = `
    <div class="combat" data-testid="combat">
      ${c.intro ? `<p class="combat-intro">${esc(T(c.intro))}</p>` : ''}
      <div class="fighters">
        <div class="fighter you ${last?.winner === 'enemy' ? 'hit' : ''}">
          <canvas class="pix fighter-img" data-you></canvas>
          <div class="fname">${esc(nm)}</div>
          <div class="hpbar"><i style="width:${Math.max(0, (hp / hpMax) * 100)}%"></i></div>
          <div class="fstat">${esc(book.stats[cs.healthStat].name.toUpperCase())} ${hp}/${hpMax}</div>
          <div class="fstat dim">ATTACK ${state.stats[cs.attackStat]}</div>
          <div class="dice-row small" data-pd>${Array.from({ length: count }, (_, i) => dieHTML(last ? last.playerRolls[i] : null)).join('')}</div>
        </div>
        <div class="vs">VS</div>
        <div class="fighter foe ${last?.winner === 'player' ? 'hit' : ''}">
          <canvas class="pix fighter-img" data-foe></canvas>
          <div class="fname">${esc(enemy.name)}</div>
          <div class="hpbar foe-bar"><i style="width:${(p.enemyHealth / enemy.health) * 100}%"></i></div>
          <div class="fstat" data-testid="enemy-hp">HP ${p.enemyHealth}/${enemy.health}</div>
          <div class="fstat dim">ATTACK ${enemy.attack}</div>
          <div class="dice-row small" data-ed>${Array.from({ length: count }, (_, i) => dieHTML(last ? last.enemyRolls[i] : null)).join('')}</div>
        </div>
      </div>
      <div class="round-log" data-testid="round-log">${last ? roundText(last, nm, cs) : 'ROUND 1 · PRESS ATTACK TO ROLL!'}</div>
      <div class="combat-buttons"></div>
    </div>`;
  drawAvatar($('[data-you]', box), activePlayer().avatar);
  if (enemy.sprite) drawSprite($('[data-foe]', box), enemy.sprite);
  const btns = $('.combat-buttons', box);
  if (p.result) {
    const out = p.result === 'win' ? c.win : c.lose;
    btns.innerHTML = `<div class="result ${p.result === 'win' ? 'ok' : 'bad'}" data-testid="combat-result">${p.result === 'win' ? 'YOU WIN THE DUEL!' : 'DEFEATED!'}</div>${out.text ? `<p class="outcome">${esc(T(out.text))}</p>` : ''}<button class="btn btn-big" data-testid="continue">CONTINUE ▶</button>`;
    $('button', btns).addEventListener('click', () => act(() => E.continueAfterCombat(book, state, rng)));
    return;
  }
  btns.innerHTML = `<button class="btn btn-big btn-attack" data-testid="attack">ATTACK! <small>(ROLL)</small></button>${c.flee ? `<button class="btn btn-ghost" data-testid="flee">${esc(c.flee.label || 'RUN AWAY')}</button>` : ''}`;
  $('[data-testid=attack]', btns).addEventListener('click', async (ev) => {
    if (busy) return; busy = true;
    $$('button', btns).forEach((b) => (b.disabled = true));
    const { round, messages } = E.combatRound(book, state, rng);
    persist();
    await animateDice([...$$('[data-pd] .die', box), ...$$('[data-ed] .die', box)], [...round.playerRolls, ...round.enemyRolls]);
    busy = false;
    if (round.winner === 'enemy') sfx.hurt(); else if (round.winner === 'player') sfx.coin();
    showMessages(messages, { silent: true });
    renderStats();
    renderCombat(box);
  });
  if (c.flee) $('[data-testid=flee]', btns).addEventListener('click', () => act(() => E.flee(book, state, rng)));
}
function roundText(r, nm, cs) {
  const you = `${esc(nm)}: ${r.playerRolls.join('+')}+${r.playerTotal - r.playerRolls.reduce((a, b) => a + b, 0)} = <b>${r.playerTotal}</b>`;
  const foe = `${esc(r.enemy)}: ${r.enemyRolls.join('+')}+${r.enemyTotal - r.enemyRolls.reduce((a, b) => a + b, 0)} = <b>${r.enemyTotal}</b>`;
  const res = r.winner === 'player' ? `<span class="ok">YOU LAND A BOP! (-${cs.damage})</span>` : r.winner === 'enemy' ? `<span class="bad">OUCH! YOU GET BOPPED (-${cs.damage})</span>` : '<span>BLOCKED! NOBODY IS HURT</span>';
  return `ROUND ${r.n} · ${you} · ${foe}<br>${res}${r.nextEnemy ? `<br>NEXT UP: ${esc(r.nextEnemy)}!` : ''}`;
}

// ---- ending ----
function renderEnding(box) {
  const end = state.ended;
  const kind = end.type === 'win' ? 'win' : end.type === 'neutral' ? 'neutral' : 'lose';
  const banner = { win: 'YOU WIN!', neutral: 'THE END', lose: 'GAME OVER' }[kind];
  const stars = end.stars ?? (kind === 'win' ? 3 : 0);
  const items = Object.keys(state.inventory).length;
  box.innerHTML = `
    <div class="ending ending-${kind}" data-testid="ending" data-ending-type="${esc(end.type)}">
      <div class="ending-banner">${banner}</div>
      <div class="ending-title">${esc(T(end.title))}</div>
      <div class="stars" aria-label="${stars} of 3 stars">${[0, 1, 2].map((i) => `<span class="star ${i < stars ? 'on' : ''}">★</span>`).join('')}</div>
      <div class="ending-stats">
        <div><b>${state.history.length}</b><span>PAGES</span></div>
        <div><b>${items}</b><span>ITEMS</span></div>
        <div><b>${new Set(state.history).size}</b><span>PLACES</span></div>
      </div>
      <button class="btn btn-big btn-start" data-testid="play-again">PLAY AGAIN</button>
    </div>`;
  $('[data-testid=play-again]', box).addEventListener('click', restart);
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
    const shown = Number.isFinite(max) ? max : v;
    const delta = prevStats[id] !== undefined ? v - prevStats[id] : 0;
    const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
    const pct = shown > 0 ? Math.max(0, Math.min(100, (v / shown) * 100)) : 0;
    rows.push(`
      <div class="stat ${cls}" data-stat="${id}" style="--c:${def.color || '#29e7ff'}" title="${esc(def.description || '')}">
        <div class="stat-top"><span class="stat-name"><span class="stat-icon">${esc(def.icon || '')}</span>${esc(def.name.toUpperCase())}</span><span class="stat-val" data-testid="stat-${id}">${v}<small>/${shown}</small></span></div>
        ${def.display === 'number' ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`}
      </div>`);
    mini.push(`<span class="mini-stat ${cls}" style="--c:${def.color || '#29e7ff'}">${esc(def.short || def.name)} <b>${v}</b></span>`);
  }
  wrap.innerHTML = rows.join('');
  const tokens = Object.entries(state.inventory).filter(([, q]) => q > 0);
  mini.push(`<button class="mini-stat mini-inv" data-jump="inventory">BAG <b>${tokens.length}</b></button>`);
  hud.innerHTML = mini.join('');
  $('[data-jump]', hud)?.addEventListener('click', () => $('#inventory').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  prevStats = { ...state.stats };
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
  const list = $('#journey');
  const hist = state.history;
  const start = Math.max(0, hist.length - 8);
  list.start = start + 1;
  list.innerHTML = hist.slice(start).map((id, i) => `<li class="${start + i === hist.length - 1 ? 'here' : ''}">${esc(T(book.sections[id]?.title || id))}</li>`).join('');
}

// ---------------- actions & feedback ----------------
function act(fn) {
  if (busy) return;
  let msgs;
  try { msgs = fn() || []; } catch (e) { console.error(e); toast(e.message.toUpperCase(), 'bad'); return; }
  persist();
  renderAll();
  if (state.ended) {
    state.ended.type === 'win' ? sfx.win() : state.ended.type === 'neutral' ? sfx.select() : sfx.lose();
    showMessages(msgs, { silent: true });
  } else showMessages(msgs);
}

function showMessages(msgs, { silent = false } = {}) {
  let sound = 'select';
  msgs.forEach((m, i) => {
    let kind = 'info';
    if (m.type === 'stat') kind = m.delta > 0 ? 'good' : 'bad';
    if (m.type === 'item') kind = m.delta > 0 ? 'good' : 'bad';
    if (kind === 'good' && sound === 'select') sound = 'coin';
    if (kind === 'bad' && m.type === 'stat') sound = 'hurt';
    setTimeout(() => toast(m.text.toUpperCase(), kind), i * 180);
  });
  if (!silent) sfx[sound]();
}

function toast(text, kind = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2700);
}

// ---------------- modals ----------------
function openModal(html, { dismissible = true, cls = '', testid = 'modal' } = {}) {
  closeModal();
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${cls}" role="dialog" aria-modal="true" data-testid="${testid}">${html}</div></div>`;
  const back = $('.modal-backdrop', root);
  if (dismissible) {
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }
  document.body.classList.add('modal-open');
  return $('.modal', root);
}
function closeModal() { $('#modalRoot').innerHTML = ''; document.body.classList.remove('modal-open'); }

function confirmModal(title, text, yes = 'YES') {
  return new Promise((resolve) => {
    const m = openModal(`<h2 class="modal-title">${esc(title)}</h2><p class="modal-text">${esc(text)}</p><div class="modal-buttons"><button class="btn btn-ghost" data-no>CANCEL</button><button class="btn" data-yes data-testid="confirm-yes">${esc(yes)}</button></div>`, { cls: 'small', testid: 'confirm' });
    $('[data-yes]', m).addEventListener('click', () => { closeModal(); resolve(true); });
    $('[data-no]', m).addEventListener('click', () => { closeModal(); resolve(false); });
    $('[data-yes]', m).focus();
  });
}

function openCreator({ mode }) {
  const editing = mode === 'edit';
  const player = editing ? activePlayer() : null;
  const av = { ...(player?.avatar || defaultAvatar()) };
  const swatches = (key, colors) => `<div class="swatches" role="radiogroup" aria-label="${key}">${colors.map((c, i) => `<button class="swatch" role="radio" data-key="${key}" data-val="${i}" style="--s:${c}" aria-label="${key} ${i + 1}"></button>`).join('')}</div>`;
  const cycler = (key) => `<div class="cycler" data-key="${key}"><button class="arrow" data-dir="-1" aria-label="previous ${key}">◀</button><span class="cycle-val" data-val-for="${key}"></span><button class="arrow" data-dir="1" aria-label="next ${key}">▶</button></div>`;
  const m = openModal(`
    <div class="creator-head">
      <div class="insert-coin blink">${editing ? 'EDIT HERO' : 'PLAYER 1 · INSERT COIN'}</div>
      <h2 class="creator-title">${editing ? 'CUSTOMIZE YOUR HERO' : 'CREATE YOUR HERO'}</h2>
    </div>
    <div class="creator-grid">
      <div class="stage">
        <div class="stage-spot"></div>
        <canvas class="pix big-avatar" id="cAvatar" data-testid="avatar-preview"></canvas>
        <div class="stage-floor"></div>
        <div class="stage-name" id="cEcho">???</div>
      </div>
      <div class="controls">
        <div class="ctl-label">CHOOSE A HERO</div>
        <div class="presets">${PRESETS.map((p, i) => `<button class="preset" data-preset="${i}" data-testid="preset-${i}" title="${p.label}"><canvas class="pix"></canvas><span>${p.label}</span></button>`).join('')}</div>
        <div class="ctl-label">CUSTOMIZE <button class="btn btn-small btn-ghost" id="cRandom" data-testid="randomize">? RANDOM</button></div>
        <div class="ctl-row"><span>SKIN</span>${swatches('skin', SKINS)}</div>
        <div class="ctl-row"><span>HAIR</span>${cycler('hairStyle')}</div>
        <div class="ctl-row"><span>COLOR</span>${swatches('hairColor', HAIR_COLORS)}</div>
        <div class="ctl-row"><span>OUTFIT</span>${swatches('outfit', OUTFITS)}</div>
        <div class="ctl-row"><span>EXTRA</span>${cycler('accessory')}</div>
        <label class="ctl-label" for="cName">ENTER YOUR NAME</label>
        <input id="cName" class="name-input" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="YOUR NAME" data-testid="name-input" value="${esc(player?.name || '')}">
      </div>
    </div>
    <div class="creator-foot">
      ${mode !== 'first' ? '<button class="btn btn-ghost" id="cCancel">CANCEL</button>' : ''}
      <button class="btn btn-start" id="cStart" data-testid="press-start">${editing ? 'SAVE HERO' : 'PRESS START'}</button>
    </div>`, { dismissible: mode !== 'first', cls: 'creator', testid: 'avatar-modal' });

  const preview = $('#cAvatar', m);
  const nameIn = $('#cName', m);
  const startBtn = $('#cStart', m);
  const lists = { hairStyle: HAIR_STYLES, accessory: ACCESSORIES };
  const refresh = () => {
    drawAvatar(preview, av);
    $$('.swatch', m).forEach((s) => { const on = av[s.dataset.key] === +s.dataset.val; s.classList.toggle('on', on); s.setAttribute('aria-checked', String(on)); });
    for (const k of Object.keys(lists)) $(`[data-val-for=${k}]`, m).textContent = LABELS[av[k]] || av[k];
    $$('.preset', m).forEach((b) => { const p = PRESETS[+b.dataset.preset]; b.classList.toggle('on', ['skin', 'hairStyle', 'hairColor', 'outfit', 'accessory'].every((k) => p[k] === av[k])); });
    const nm = cleanName(nameIn.value);
    $('#cEcho', m).textContent = nm || '???';
    startBtn.disabled = !nm;
  };
  $$('.preset', m).forEach((b) => {
    drawAvatar($('canvas', b), PRESETS[+b.dataset.preset]);
    b.addEventListener('click', () => { Object.assign(av, PRESETS[+b.dataset.preset]); sfx.select(); refresh(); });
  });
  $$('.swatch', m).forEach((s) => s.addEventListener('click', () => { av[s.dataset.key] = +s.dataset.val; sfx.select(); refresh(); }));
  $$('.cycler', m).forEach((c) => $$('.arrow', c).forEach((a) => a.addEventListener('click', () => {
    const list = lists[c.dataset.key];
    av[c.dataset.key] = list[(list.indexOf(av[c.dataset.key]) + +a.dataset.dir + list.length) % list.length];
    sfx.select(); refresh();
  })));
  $('#cRandom', m).addEventListener('click', () => { Object.assign(av, randomAvatar()); sfx.select(); refresh(); });
  nameIn.addEventListener('input', () => { const c = nameIn.value.toUpperCase(); if (c !== nameIn.value) nameIn.value = c; refresh(); });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !startBtn.disabled) startBtn.click(); });
  $('#cCancel', m)?.addEventListener('click', closeModal);
  startBtn.addEventListener('click', () => {
    const name = cleanName(nameIn.value);
    if (!name) return;
    const avatar = { skin: av.skin, hairStyle: av.hairStyle, hairColor: av.hairColor, outfit: av.outfit, accessory: av.accessory };
    if (editing) {
      Object.assign(player, { name, avatar });
      saveProfiles();
      closeModal();
      sfx.start();
      renderAll();
      toast('HERO SAVED!', 'good');
    } else {
      const id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      profiles.players[id] = { id, name, avatar, createdAt: Date.now() };
      profiles.activeId = id;
      saveProfiles();
      closeModal();
      sfx.start();
      startOrResume();
      toast(`GET READY, ${name}!`, 'good');
    }
  });
  refresh();
  setTimeout(() => nameIn.focus({ preventScroll: true }), 50);
}

function cleanName(s) { return s.toUpperCase().replace(/[^A-Z0-9 \-!.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12); }

function openPlayerMenu() {
  const rows = Object.values(profiles.players).sort((a, b) => a.createdAt - b.createdAt).map((p) => {
    const s = loadJSON(saveKey(p.id), null);
    const where = s && book.sections[s.current] ? (s.ended ? `FINISHED: ${s.ended.title}` : `PAGE ${s.history.length} · ${book.sections[s.current].title || ''}`) : 'NEW GAME';
    return `<div class="player-row ${p.id === profiles.activeId ? 'active' : ''}">
      <canvas class="pix" data-pid="${p.id}"></canvas>
      <div class="player-info"><b>${esc(p.name)}</b><small>${esc(where.toUpperCase())}</small></div>
      ${p.id === profiles.activeId ? '<span class="tag">PLAYING</span>' : `<button class="btn btn-small" data-play="${p.id}">PLAY</button>`}
      <button class="btn btn-small btn-ghost" data-del="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>
    </div>`;
  }).join('');
  const m = openModal(`<h2 class="modal-title">SELECT PLAYER</h2><div class="player-list">${rows}</div><div class="modal-buttons"><button class="btn btn-ghost" data-edit>EDIT MY HERO</button><button class="btn" data-new data-testid="new-player">+ NEW PLAYER</button></div>`, { cls: 'players', testid: 'player-menu' });
  $$('canvas[data-pid]', m).forEach((c) => drawAvatar(c, profiles.players[c.dataset.pid].avatar));
  $$('[data-play]', m).forEach((b) => b.addEventListener('click', () => { profiles.activeId = b.dataset.play; saveProfiles(); closeModal(); sfx.start(); startOrResume(); }));
  $$('[data-del]', m).forEach((b) => b.addEventListener('click', async () => {
    const p = profiles.players[b.dataset.del];
    if (!(await confirmModal(`REMOVE ${p.name}?`, 'This deletes this player and their saved progress on this device.', 'REMOVE'))) return openPlayerMenu();
    localStorage.removeItem(saveKey(p.id));
    delete profiles.players[p.id];
    if (profiles.activeId === p.id) profiles.activeId = Object.keys(profiles.players)[0] || null;
    saveProfiles();
    if (!activePlayer()) { state = null; renderEmpty(); openCreator({ mode: 'first' }); } else { startOrResume(); openPlayerMenu(); }
  }));
  $('[data-edit]', m).addEventListener('click', () => openCreator({ mode: 'edit' }));
  $('[data-new]', m).addEventListener('click', () => openCreator({ mode: 'new' }));
}

boot();
