// End-to-end tests in headless Chromium. Serves ./public, plays through the app, checks the UI and
// saves screenshots to ./screenshots. The online leaderboard (Supabase) is mocked: no real network.
// Usage: node tests/e2e.mjs            (starts its own static server on :8765)
//        BASE_URL=http://localhost:8080 node tests/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'screenshots');
mkdirSync(shots, { recursive: true });
let server = null;
let BASE = process.env.BASE_URL;
if (!BASE) {
  server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', path.join(root, 'public')], { stdio: 'ignore' });
  BASE = 'http://127.0.0.1:8765';
  await new Promise((r) => setTimeout(r, 800));
}
const URL = `${BASE}/?seed=42&nosw&nomotion`;
const RUN_KEY = 'gb.run.v1.neon-dragon';
const BEST_KEY = 'gb.best.v1.neon-dragon';

let passed = 0; let failed = 0;
function check(cond, msg) {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
}
const errors = [];
const net = { mode: 'ok', requests: [] };
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (net.mode === 'missing' && /status of 404/.test(m.text())) return; // the mocked "table missing" response
    errors.push(`[${tag}] console: ${m.text()}`);
  });
};
const shot = (page, name) => page.screenshot({ path: path.join(shots, name) });
const T = (page, id) => page.getByTestId(id);
const text = async (page, id) => (await T(page, id).first().textContent()).trim();
const stat = async (page, id) => +(await text(page, `stat-${id}`)).replace(/\/.*/, '');
const choose = async (page, label) => { await page.locator('.choice:not(.locked)', { hasText: label }).first().click(); await page.waitForTimeout(150); };

// --- mocked Supabase REST: records requests, serves a fake World Top 50 or a missing table ---
const globalRows = [
  { nickname: 'PIXELPRO', avatar: { skin: 2, hairStyle: 'bun', hairColor: 3, outfit: 2, accessory: 'crown' }, score_pct: 97, rank: 'NEON HERO', zodiac_count: 11, created_at: '2026-10-01T10:00:00Z' },
  { nickname: 'ZOE', avatar: { skin: 4, hairStyle: 'long', hairColor: 4, outfit: 0, accessory: 'none' }, score_pct: 64, rank: 'DING-DING DASHER', zodiac_count: 7, created_at: '2026-10-02T10:00:00Z' },
];
async function mockSupabase(ctx) {
  await ctx.route(/supabase\.co\/rest\/v1\/scores/, async (route) => {
    const req = route.request();
    net.requests.push({ method: req.method(), url: req.url(), headers: req.headers(), body: req.postData() });
    if (net.mode === 'missing') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.scores' in the schema cache" }) });
    if (req.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(globalRows) });
  });
}

// Put a crafted in-progress run into localStorage (built with the real engine) and reload: this
// also exercises "reload resumes the current run".
async function inject(page, setup, { name = 'MAX' } = {}) {
  await page.evaluate(async ({ setup, name, RUN_KEY }) => {
    const E = await import('./js/engine.js');
    const book = await (await fetch('data/neon-dragon.json')).json();
    E.attachRiddlePool(book, await (await fetch('data/riddles.json')).json());
    const st = E.newGame(book, { rng: () => 0.5, playerName: name, riddleSeed: 12345 }).state;
    new Function('E', 'book', 'st', setup)(E, book, st);
    localStorage.setItem(RUN_KEY, JSON.stringify({ player: { name, avatar: { skin: 1, hairStyle: 'spiky', hairColor: 0, outfit: 4, accessory: 'headphones' } }, state: st }));
  }, { setup, name, RUN_KEY });
  await page.reload();
  await T(page, 'section-title').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
const go = (id) => `E.enterSection(book, st, '${id}', [], () => 0.5);`;
// The riddle on screen was drawn from the pool and saved with the run: look up its answer.
async function riddleNow(page) {
  return page.evaluate(async (RUN_KEY) => {
    const st = JSON.parse(localStorage.getItem(RUN_KEY)).state;
    const pool = (await (await fetch('data/riddles.json')).json()).riddles;
    const r = pool.find((x) => x.id === st.pending.ids[st.pending.q]);
    return { id: r.id, answer: r.answer, n: r.options.length, question: r.question };
  }, RUN_KEY);
}
// riddle screenshots: show the whole riddle box (it sits below the scene), without the resume toast
async function showRiddle(page) {
  await page.evaluate(() => { document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()); document.querySelector('[data-testid=riddle]')?.scrollIntoView({ block: 'end' }); });
  await page.waitForTimeout(150);
}
const noToasts = async (page) => (await page.locator('#toasts .toast').count()) === 0;

async function createHero(page, name, { customise = true } = {}) {
  const modal = T(page, 'avatar-modal');
  await modal.waitFor();
  if (customise) {
    await page.locator('.cycler[data-key=hairStyle] .arrow[data-dir="1"]').click();
    await page.locator('.swatch[data-key=outfit][data-val="1"]').click();
  }
  await T(page, 'name-input').fill(name);
  await T(page, 'press-start').click();
  await modal.waitFor({ state: 'detached' });
}

const browser = await chromium.launch();
try {
  // ======================= desktop =======================
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await mockSupabase(ctx);
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(URL);
  await page.evaluate(() => document.fonts.ready);

  console.log('creator');
  const modal = T(page, 'avatar-modal');
  await modal.waitFor();
  check(await modal.isVisible(), 'first launch shows the hero creator');
  check(await T(page, 'press-start').isDisabled(), 'PRESS START is disabled until a nickname is entered');
  check((await text(page, 'nick-tip')).includes('nickname, not your real name'), 'creator reminds: use a nickname, not your real name');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  check(await modal.isVisible(), 'the creator cannot be dismissed (Escape / clicking outside)');
  const blank = await T(page, 'avatar-preview').evaluate((c) => c.toDataURL());
  await T(page, 'name-input').fill('stupid head');
  check(await T(page, 'press-start').isDisabled() && (await text(page, 'nick-problem')).length > 0, 'rude nicknames are blocked with a friendly message');
  await T(page, 'name-input').fill('a very long nickname here');
  check((await T(page, 'name-input').inputValue()).length <= 12, 'nicknames are at most 12 characters');
  await page.locator('.cycler[data-key=hairStyle] .arrow[data-dir="1"]').click();
  await page.locator('.swatch[data-key=outfit][data-val="1"]').click();
  await page.locator('.cycler[data-key=accessory] .arrow[data-dir="1"]').click();
  check(blank !== await T(page, 'avatar-preview').evaluate((c) => c.toDataURL()), 'avatar preview updates while customising');
  await T(page, 'name-input').fill('max');
  check((await T(page, 'name-input').inputValue()) === 'MAX', 'nickname is shown in arcade capitals');
  await page.waitForTimeout(300);
  await shot(page, '01-creator.png');
  await T(page, 'press-start').click();
  await modal.waitFor({ state: 'detached' });

  console.log('first moves');
  check((await text(page, 'hero-name')) === 'MAX', 'hero panel shows the nickname');
  check((await text(page, 'section-title')) === 'Insert Coin', 'adventure starts at the first section');
  check(await stat(page, 'power') === 58 && await stat(page, 'energy') === 12 && await stat(page, 'tokens') === 6, 'starts with 58 Pixel Power, 12 Energy, 6 tokens');
  check((await text(page, 'tracker-count')) === '0/12', 'Zodiac Collection panel shows 0/12');
  check(await page.locator('.stat.timer .timer-bar').count() === 1, 'Pixel Power is shown as a countdown bar');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check(keys.includes(RUN_KEY) && !keys.some((k) => k.startsWith('gb.profiles')), 'only the current run is autosaved (no player profiles)');
  await choose(page, 'Ask Auntie Lam');
  check(await stat(page, 'power') === 57, 'each move uses 1 Pixel Power');
  check((await text(page, 'move-count')) === 'MOVE 1', 'move counter shows MOVE 1');
  const where = await text(page, 'section-title');
  await page.reload();
  await T(page, 'section-title').waitFor();
  check((await text(page, 'section-title')) === where && (await text(page, 'hero-name')) === 'MAX', 'reloading mid-game resumes the current run');
  await page.goto(`${BASE}/?seed=42&nosw&nomotion`);

  console.log('HK scenes');
  for (const [id, file] of [['causeway_bay', '02-scene-causeway-bay.png'], ['mtr_station', '03-scene-mtr.png'], ['dingding', '04-scene-dingding-tram.png'], ['man_mo', '05-scene-man-mo.png']]) {
    await inject(page, go(id));
    check((await page.locator('.illus img').getAttribute('src')).endsWith('.svg'), `${id}: scene illustration shows`);
    await shot(page, file);
  }

  console.log('halving');
  await inject(page, go('mtr_platform') + 'st.stats.energy = 9;');
  await choose(page, 'Squeeze into the packed train');
  check(await stat(page, 'energy') === 4, 'rush-hour squeeze halves Energy (9 → 4, rounded down)');
  check(await page.locator('.toast.halved').count() > 0, 'a HALVED! toast flashes');
  await shot(page, '06-halved.png');

  console.log('riddles');
  for (const [i, [id, file]] of [['liv', '07-riddle-liv.png'], ['tram_monkey', '08-riddle-monkey.png'], ['loulou', '09-riddle-loulou.png'], ['vault_snake', '10-riddle-snake.png']].entries()) {
    await inject(page, `st.riddleSeed = ${100 + i};` + go(id) + "st.inventory.brass_key = 1;");
    check(await T(page, 'riddle').isVisible() && (await T(page, 'riddle-option-0').count()) === 1, `${id}: multiple-choice riddle with the NPC`);
    check(await T(page, 'riddle-retreat').isVisible(), `${id}: "head back" retreat is offered before answering`);
    await showRiddle(page);
    await shot(page, file);
  }
  // every encounter asks ONE riddle drawn from the pool
  check((await text(page, 'riddle-question')).length > 5 && (await page.locator('.riddle-count').textContent()).includes('ONE RIDDLE'), 'one riddle per character, from the pool');
  // a second game gets a different riddle; reloading keeps the same one
  await inject(page, 'st.riddleSeed = 1;' + go('liv'));
  const q1 = await text(page, 'riddle-question');
  await showRiddle(page);
  await shot(page, '07-riddle-game1.png');
  await page.reload(); await T(page, 'riddle').waitFor();
  check((await text(page, 'riddle-question')) === q1, 'reload keeps the same riddle (seed saved with the run)');
  await inject(page, 'st.riddleSeed = 2;' + go('liv'));
  const q2 = await text(page, 'riddle-question');
  check(q2 !== q1, 'a new game draws a different riddle');
  await showRiddle(page);
  await shot(page, '07b-riddle-game2.png');
  // correct answer (Loulou)
  await inject(page, go('loulou') + 'st.stats.tokens = 6; st.stats.energy = 12;');
  let rq = await riddleNow(page);
  check((await text(page, 'riddle-question')) === rq.question, 'the saved riddle is the one on screen');
  await T(page, `riddle-option-${rq.answer}`).click();
  check((await T(page, 'riddle-result').getAttribute('data-correct')) === 'true', 'Loulou: correct answer passes');
  check(await stat(page, 'tokens') === 7, 'correct answer: +1 token');
  await T(page, 'continue').click();
  await page.waitForTimeout(200);
  check((await text(page, 'section-title')) === 'The Peak' && (await text(page, 'tracker-count')) === '1/12', 'Loulou finished after one riddle: back at the Peak, Goat added to the Zodiac Collection');
  // wrong + pay (Monkey)
  await inject(page, go('tram_monkey') + 'st.stats.tokens = 6;');
  rq = await riddleNow(page);
  await T(page, `riddle-option-${(rq.answer + 1) % rq.n}`).click();
  check((await T(page, 'riddle-result').getAttribute('data-correct')) === 'false' && await T(page, 'riddle-penalty').isVisible(), 'wrong answer asks for a penalty');
  check((await text(page, 'riddle-explain')).includes('The answer was'), 'a wrong answer shows the right one');
  await showRiddle(page);
  await shot(page, '11-riddle-penalty.png');
  await T(page, 'penalty-0').click();
  check(await stat(page, 'tokens') === 4, 'wrong + pay: costs 2 tokens');
  await T(page, 'continue').click();
  await page.waitForTimeout(200);
  check((await text(page, 'section-title')) === 'The Peak Tram', 'after paying, the monkey still lets you through');
  // wrong + halve (Snake)
  await inject(page, go('vault_snake') + 'st.stats.energy = 12;');
  rq = await riddleNow(page);
  await T(page, `riddle-option-${(rq.answer + 1) % rq.n}`).click();
  await T(page, 'penalty-1').click();
  check(await stat(page, 'energy') === 6, 'wrong + halve: Energy 12 → 6');
  // retreat
  await inject(page, go('liv') + 'st.stats.power = 30;');
  const tBefore = await stat(page, 'tokens');
  await T(page, 'riddle-retreat').click();
  await page.waitForTimeout(200);
  check((await text(page, 'section-title')) === 'Causeway Bay' && await stat(page, 'tokens') === tBefore && await stat(page, 'power') === 29, 'retreat: back to Causeway Bay, no penalty (just the move)');
  // fewer than 2 tokens: only halving allowed
  await inject(page, go('liv') + 'st.stats.tokens = 1;');
  rq = await riddleNow(page);
  await T(page, `riddle-option-${(rq.answer + 1) % rq.n}`).click();
  check(await T(page, 'penalty-0').isDisabled() && !(await T(page, 'penalty-1').isDisabled()), 'with fewer than 2 tokens, only "halve Energy" can be picked');

  console.log('out of tokens');
  await inject(page, go('liv') + 'st.stats.tokens = 2;');
  rq = await riddleNow(page);
  await T(page, `riddle-option-${(rq.answer + 1) % rq.n}`).click();
  check((await T(page, 'penalty-0').textContent()).includes('⚠'), 'paying your last tokens is flagged with ⚠');
  await T(page, 'penalty-0').click();
  await T(page, 'ending').waitFor();
  check((await text(page, 'trapped-title')) === 'OUT OF TOKENS' && (await text(page, 'trapped-cause')).includes('TOKENS'), 'paying the last 2 tokens = OUT OF TOKENS ending');
  await page.waitForTimeout(600);
  check(await noToasts(page), 'no toast pop-ups over the OUT OF TOKENS screen');
  await shot(page, '12-out-of-tokens.png');

  console.log('trapped');
  await inject(page, go('tram') + 'st.stats.energy = 3;');
  check((await page.locator('.choice', { hasText: 'Feel your way' }).textContent()).includes('ENERGY WOULD RUN OUT'), 'the dangerous choice warns that Energy would run out');
  await choose(page, 'Feel your way through the dark');
  await T(page, 'ending').waitFor();
  check((await T(page, 'ending').getAttribute('data-style')) === 'trapped', 'Energy at 0 = trapped-style ending');
  check((await text(page, 'trapped-title')) === 'TRAPPED IN THE GAME FOREVER' && (await text(page, 'trapped-cause')).includes('ENERGY'), 'shows TRAPPED IN THE GAME FOREVER and the cause');
  check(!(await page.evaluate((k) => localStorage.getItem(k), RUN_KEY)), 'the finished run is cleared from storage');
  await page.waitForTimeout(400);
  await page.waitForTimeout(700);
  check(await noToasts(page), 'no toast pop-ups cover the trapped GAME OVER screen');
  await shot(page, '13-trapped.png');
  await T(page, 'play-again').click();
  await T(page, 'avatar-modal').waitFor();
  check((await T(page, 'name-input').inputValue()) === '', 'PLAY AGAIN opens a blank creator (no pre-filled name)');
  check(await T(page, 'press-start').isDisabled(), 'START is required: disabled until a new nickname is typed');
  await page.keyboard.press('Escape');
  check(await T(page, 'avatar-modal').isVisible(), 'the restart creator cannot be dismissed');
  await T(page, 'name-input').fill('kai');
  await T(page, 'press-start').click();
  await T(page, 'avatar-modal').waitFor({ state: 'detached' });
  check((await text(page, 'hero-name')) === 'KAI' && await stat(page, 'power') === 58 && (await text(page, 'section-title')) === 'Insert Coin', 'START begins a fresh game with the new hero');

  console.log('win + score');
  net.mode = 'ok';
  await inject(page, go('dragon_summit') + "st.inventory.pearl = 1; st.found.pearl = true; st.found.lantern = true; st.used.lantern = true; for (const z of ['rat','rabbit','ox','monkey']) st.flags['zodiac_' + z] = true; st.stats.power = 14; st.stats.energy = 9;");
  await choose(page, 'Hold up the Pearl of Light');
  await T(page, 'score-screen').waitFor();
  const pct = +(await text(page, 'score-pct')).replace('%', '');
  check(pct > 0 && pct < 100, `win shows a SCORE percentage (${pct}%)`);
  check((await text(page, 'score-rank')).length > 0 && await page.locator('.score-row').count() === 7, 'score breakdown: 6 components + total, and a rank title');
  check((await text(page, 'end-zodiac')) === '4/12', 'end scorecard shows ZODIAC 4/12');
  const best = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), BEST_KEY);
  check(best?.[0]?.nickname === 'MAX' && best[0].score_pct === pct, 'score saved to this device\'s Best Scores');
  check((await text(page, 'hero-best')) === `${pct}%`, 'hero panel shows the best score');
  await page.waitForTimeout(500);
  await page.waitForTimeout(700);
  check(await noToasts(page), 'no toast pop-ups cover the score screen');
  await shot(page, '14-score.png');
  await T(page, 'post-global').click();
  await T(page, 'post-result').waitFor();
  const post = net.requests.find((r) => r.method === 'POST');
  check((await text(page, 'post-result')).includes('SENT'), 'POST TO WORLD TOP 50 sends the score (mocked)');
  check(post && post.headers.apikey?.startsWith('sb_publishable_') && !post.headers.authorization, 'REST call uses the apikey header only (publishable key, no Bearer)');
  check(post && JSON.parse(post.body).nickname === 'MAX' && JSON.parse(post.body).score_pct === pct, 'posted row has nickname + score');

  console.log('best scores');
  await T(page, 'end-scores').click();
  await T(page, 'scores-modal').waitFor();
  await page.locator('[data-testid=scores-body] [data-testid=score-row]').first().waitFor();
  check(await page.locator('[data-testid=score-row]').count() === 2 && (await page.locator('[data-testid=score-row] .nm').first().textContent()) === 'PIXELPRO', 'World Top 50 tab shows the shared board');
  await page.waitForTimeout(700);
  await shot(page, '15-best-scores-world.png');
  await T(page, 'tab-local').click();
  check((await page.locator('[data-testid=score-row] .nm').first().textContent()) === 'MAX', 'My Device tab shows this device\'s top 10');
  await page.waitForTimeout(300);
  await shot(page, '16-best-scores-device.png');
  await T(page, 'scores-back').click();
  net.mode = 'missing';
  await T(page, 'end-scores').click();
  await T(page, 'global-offline').waitFor();
  check(await T(page, 'global-offline').isVisible() && await page.locator('[data-testid=score-row]').count() >= 1, 'missing table / offline: falls back to this device\'s scores');
  await T(page, 'scores-back').click();
  net.mode = 'ok';

  console.log('shopping forever');
  await inject(page, go('sale_trap') + 'st.stats.power = 25;');
  await choose(page, 'Grab another one');
  await T(page, 'trapped-title').waitFor();
  check((await text(page, 'trapped-title')) === 'SHOPPING FOREVER' && (await text(page, 'trapped-cause')) === 'YOUR PIXEL POWER RAN OUT', 'Shopping Forever: trapped GAME OVER with YOUR PIXEL POWER RAN OUT');
  check(await stat(page, 'power') === 0 && await noToasts(page), 'Shopping Forever: the stats panel shows 0 Pixel Power, no toast over the buttons');
  check((await text(page, 'section-text')).toLowerCase().includes('drained your last pixel power'), 'Shopping Forever: the story says the gremlins drained your last pixel power');
  await page.waitForTimeout(400);
  await shot(page, '23-shopping-forever.png');

  console.log('dice gamble');
  await inject(page, go('horse_race') + 'st.stats.energy = 12; st.stats.tokens = 5;');
  const odds = await text(page, 'gamble-odds');
  check(odds.includes('WIN 8+ (42%)') && odds.includes('7 = HALF LUCK (17%)') && odds.includes('6 OR LESS LOSE -2 LUCK (42%)'), `gamble screen shows the odds (${odds})`);
  const luckBefore = await stat(page, 'luck');
  await T(page, 'roll').click();
  await T(page, 'test-result').waitFor();
  const res = await text(page, 'test-result');
  const total = +res.match(/ROLLED (\d+)/)[1];
  const verdictOk = total >= 8 ? res.includes('YOU WIN') : total === 7 ? res.includes('HALF YOUR LUCK') : res.includes('YOU LOSE! -2 LUCK');
  check(verdictOk, `gamble result follows the 8+/7/6- rule (${res})`);
  await shot(page, '20-gamble-odds.png');
  await T(page, 'continue').click();
  await page.waitForTimeout(300);
  const eAfter = await stat(page, 'energy'), tAfter = await stat(page, 'tokens'), luckNow = await stat(page, 'luck');
  const luckWant = total >= 8 ? luckBefore : total === 7 ? Math.floor(luckBefore / 2) : luckBefore - 2;
  check((await text(page, 'section-title')) === 'Causeway Bay' && eAfter === 12 && luckNow === luckWant && tAfter === (total >= 8 ? 8 : 5), `gamble outcome applied, Luck only (roll ${total}: Luck ${luckBefore} → ${luckNow}, Energy ${eAfter}, tokens ${tAfter})`);
  await inject(page, go('claw') + 'st.stats.luck = 2;');
  check((await text(page, 'gamble-risk')).includes('LOSING WOULD TRAP YOU'), 'gamble warns when losing would empty your Luck');
  await inject(page, go('horse_race') + 'st.stats.luck = 1;');
  await T(page, 'roll').click();
  await T(page, 'test-result').waitFor();
  const r1 = await text(page, 'test-result');
  await T(page, 'continue').click();
  await page.waitForTimeout(400);
  if (!r1.includes('YOU WIN')) check((await text(page, 'trapped-cause')) === 'YOUR LUCK RAN OUT' && await stat(page, 'luck') === 0, `Luck 0 = trapped GAME OVER: YOUR LUCK RAN OUT (${r1})`);
  else check((await text(page, 'section-title')) === 'Causeway Bay', 'won the bet at Luck 1');

  console.log('run away from Bolt-Bot');
  // round 0: before any attack
  await inject(page, go('bot_battle') + 'st.stats.energy = 9;');
  const flee = T(page, 'flee');
  check(await flee.isVisible() && (await flee.textContent()).includes('RUN AWAY! (back to the tram, -1 Energy)'), 'RUN AWAY button is visible and labelled before the first round');
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()));
  await shot(page, '21-bolt-bot-run-away.png');
  await flee.click();
  await page.waitForTimeout(300);
  check((await text(page, 'section-title')) === 'Central' && await stat(page, 'energy') === 8, 'RUN AWAY on round 0: back to Central, -1 Energy');
  // after 1 and 2 attack rounds (Bolt-Bot needs 3 bops and you can take 5, so it's never decided yet)
  for (const rounds of [1, 2]) {
    await inject(page, go('bot_battle') + 'st.stats.energy = 12;');
    for (let i = 0; i < rounds; i++) {
      await T(page, 'attack').click();
      await page.waitForFunction(() => { const b = document.querySelector('[data-testid=attack]'); return b && !b.disabled && document.querySelector('[data-testid=flee]'); }, null, { timeout: 10000 });
    }
    const hint = await text(page, 'flee-hint');
    const e = await stat(page, 'energy');
    check(await T(page, 'flee').isVisible() && hint.includes(`ROUND ${rounds + 1}`), `RUN AWAY still offered after ${rounds} attack round(s)`);
    await T(page, 'flee').click();
    await page.waitForTimeout(300);
    check((await text(page, 'section-title')) === 'Central' && await stat(page, 'energy') === e - 1, `RUN AWAY after ${rounds} round(s) works: Central, -1 Energy`);
  }
  await inject(page, go('bot_battle') + 'st.stats.energy = 1;');
  check((await T(page, 'flee').textContent()).includes('⚠') && await T(page, 'warning').first().isVisible(), 'RUN AWAY at Energy 1 shows the ⚠ trapped warning');

  console.log('zodiac master');
  await inject(page, go('dragon_summit') + "st.inventory.pearl = 1; for (const e of book.trackers[0].entries.slice(0, 11)) st.flags[e.flag] = true; st.stats.power = 20;");
  check((await text(page, 'tracker-count')) === '11/12', 'before the finale: 11/12 (the Dragon is still busy with the moon)');
  await choose(page, 'Hold up the Pearl of Light');
  await T(page, 'zodiac-master').waitFor();
  check((await text(page, 'zodiac-master')).includes('ZODIAC MASTER') && (await text(page, 'end-zodiac')) === '12/12', 'all 12 animals (the Dragon joins at the finale): ZODIAC MASTER, 12/12');
  check((await text(page, 'section-text')).includes('ALL 12 ZODIAC'), 'bonus paragraph: the Dragon joins, all 12');
  check(await T(page, 'legend').isVisible() && (await text(page, 'legend')).includes('LEGEND!'), 'big LEGEND! celebration on the full route');
  const vcode = await text(page, 'voucher-code');
  check(/^ND-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(vcode) && (await text(page, 'voucher-name')) === 'MAX' && /^\d{4}-\d{2}-\d{2}$/.test(await text(page, 'voucher-date')), `PLAY AGAIN VOUCHER with name, date and code (${vcode})`);
  check(await T(page, 'print-voucher').isVisible() && await noToasts(page), 'voucher can be printed; no toasts over the finale');
  await T(page, 'voucher').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, '17-legend-voucher.png');
  await T(page, 'legend').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, '17b-legend.png');
  await T(page, 'play-again').click();
  await T(page, 'avatar-modal').waitFor();
  check((await T(page, 'name-input').inputValue()) === '', 'after a win, PLAY AGAIN also starts from a blank creator');
  await page.reload();
  await T(page, 'avatar-modal').waitFor();
  check((await text(page, 'voucher-saved')).includes(vcode), 'the won voucher is kept on the device: the creator offers it even after a reload');
  await T(page, 'voucher-input').fill('ND-AAAA-AAAA');
  await T(page, 'voucher-redeem').click();
  check((await text(page, 'voucher-msg')).includes('ISN\'T VALID'), 'a made-up voucher code is rejected');
  await T(page, 'voucher-input').fill(vcode.toLowerCase());
  await T(page, 'voucher-redeem').click();
  check((await text(page, 'voucher-msg')).includes('+2 TOKENS'), 'the real voucher code is accepted in the creator');
  await shot(page, '24-creator-voucher.png');
  await T(page, 'name-input').fill('ZED');
  await T(page, 'press-start').click();
  await T(page, 'avatar-modal').waitFor({ state: 'detached' });
  check(await stat(page, 'tokens') === 8, 'redeemed voucher: the new game starts with 8 tokens');
  await page.locator('#restartBtn').click();
  await T(page, 'confirm-yes').click();
  await T(page, 'avatar-modal').waitFor();
  await T(page, 'voucher-input').fill(vcode);
  await T(page, 'voucher-redeem').click();
  check((await text(page, 'voucher-msg')).includes('ALREADY BEEN USED') && await T(page, 'voucher-saved').count() === 0, 'a voucher works only once (remembered on this device)');
  await T(page, 'name-input').fill('ZED');
  await T(page, 'press-start').click();
  await T(page, 'avatar-modal').waitFor({ state: 'detached' });
  check(await stat(page, 'tokens') === 6, 'used voucher: no bonus (6 tokens)');
  await page.locator('#restartBtn').click();
  await T(page, 'confirm-yes').click();
  await T(page, 'avatar-modal').waitFor();
  await T(page, 'creator-scores').click();
  await T(page, 'scores-modal').waitFor();
  await T(page, 'scores-back').click();
  check(await T(page, 'avatar-modal').isVisible(), 'Best Scores is reachable from the creator and returns to it');
  await page.close();

  // ======================= mobile =======================
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mockSupabase(mctx);
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await m.goto(URL);
  await m.evaluate(() => document.fonts.ready);
  await T(m, 'avatar-modal').waitFor();
  await shot(m, '18-mobile-creator.png');
  await createHero(m, 'zoe');
  await inject(m, go('loulou'), { name: 'ZOE' });
  await showRiddle(m);
  await shot(m, '19-mobile-riddle.png');
  // mobile: the RUN AWAY button is on screen (no scrolling hunt) and works after a round
  await inject(m, go('bot_battle') + 'st.stats.energy = 12;', { name: 'ZOE' });
  await T(m, 'attack').tap();
  await m.waitForFunction(() => { const b = document.querySelector('[data-testid=attack]'); return b && !b.disabled && document.querySelector('[data-testid=flee]'); }, null, { timeout: 10000 });
  const fb = await T(m, 'flee').boundingBox();
  check(fb && fb.y + fb.height <= 844 && fb.width >= 390 * 0.65, `mobile: RUN AWAY is full-width and inside the screen after a round (y=${Math.round(fb?.y)})`);
  await m.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()));
  await shot(m, '22-mobile-run-away.png');
  const me = await stat(m, 'energy');
  await T(m, 'flee').tap();
  await m.waitForTimeout(300);
  check((await text(m, 'section-title')) === 'Central' && await stat(m, 'energy') === me - 1, 'mobile: tapping RUN AWAY goes back to Central, -1 Energy');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'mobile: no horizontal scrolling');
  await m.close();
} finally {
  await browser.close();
  server?.kill();
}
if (errors.length) { console.log('\nBrowser errors:'); errors.forEach((e) => console.log('  ' + e)); }
console.log(`\n${passed} passed, ${failed} failed${errors.length ? `, ${errors.length} browser errors` : ''}`);
process.exit(failed || errors.length ? 1 : 0);
