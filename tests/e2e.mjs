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
    const st = E.newGame(book, { rng: () => 0.5, playerName: name }).state;
    new Function('E', 'book', 'st', setup)(E, book, st);
    localStorage.setItem(RUN_KEY, JSON.stringify({ player: { name, avatar: { skin: 1, hairStyle: 'spiky', hairColor: 0, outfit: 4, accessory: 'headphones' } }, state: st }));
  }, { setup, name, RUN_KEY });
  await page.reload();
  await T(page, 'section-title').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}
const go = (id) => `E.enterSection(book, st, '${id}', [], () => 0.5);`;

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
  check(await stat(page, 'power') === 40 && await stat(page, 'energy') === 12 && await stat(page, 'tokens') === 6, 'starts with 40 Pixel Power, 12 Energy, 6 tokens');
  check((await text(page, 'tracker-count')) === '0/11', 'Zodiac Collection panel shows 0/11');
  check(await page.locator('.stat.timer .timer-bar').count() === 1, 'Pixel Power is shown as a countdown bar');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check(keys.includes(RUN_KEY) && !keys.some((k) => k.startsWith('gb.profiles')), 'only the current run is autosaved (no player profiles)');
  await choose(page, 'Ask Auntie Lam');
  check(await stat(page, 'power') === 39, 'each move uses 1 Pixel Power');
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
  for (const [id, file] of [['liv', '07-riddle-liv.png'], ['tram_monkey', '08-riddle-monkey.png'], ['loulou', '09-riddle-loulou.png'], ['vault_snake', '10-riddle-snake.png']]) {
    await inject(page, go(id) + "st.inventory.brass_key = 1;");
    check(await T(page, 'riddle').isVisible() && (await T(page, 'riddle-option-0').count()) === 1, `${id}: multiple-choice riddle with the NPC`);
    check(await T(page, 'riddle-retreat').isVisible(), `${id}: "head back" retreat is offered before answering`);
    await shot(page, file);
  }
  // Loulou: correct, wrong + pay, wrong + halve
  await inject(page, go('loulou') + 'st.stats.tokens = 6; st.stats.energy = 12;');
  const ans = [1, 2, 0];
  await T(page, `riddle-option-${ans[0]}`).click();
  check((await T(page, 'riddle-result').getAttribute('data-correct')) === 'true', 'Loulou riddle 1: correct answer passes');
  const tokAfterCorrect = await stat(page, 'tokens');
  await T(page, 'continue').click();
  await T(page, `riddle-option-${(ans[1] + 1) % 3}`).click();
  check((await T(page, 'riddle-result').getAttribute('data-correct')) === 'false' && await T(page, 'riddle-penalty').isVisible(), 'riddle 2: wrong answer asks for a penalty');
  await shot(page, '11-riddle-penalty.png');
  await T(page, 'penalty-0').click();
  check(await stat(page, 'tokens') === tokAfterCorrect - 2, 'wrong + pay: costs 2 tokens');
  await T(page, 'continue').click();
  await T(page, `riddle-option-${(ans[2] + 1) % 3}`).click();
  await T(page, 'penalty-1').click();
  check(await stat(page, 'energy') === 6, 'wrong + halve: Energy 12 → 6');
  await T(page, 'continue').click();
  await page.waitForTimeout(200);
  check((await text(page, 'section-title')) === 'The Peak' && (await text(page, 'tracker-count')) === '1/11', 'Loulou finished: back at the Peak, Goat added to the Zodiac Collection');
  // retreat
  await inject(page, go('liv') + 'st.stats.power = 30;');
  const tBefore = await stat(page, 'tokens');
  await T(page, 'riddle-retreat').click();
  await page.waitForTimeout(200);
  check((await text(page, 'section-title')) === 'Causeway Bay' && await stat(page, 'tokens') === tBefore && await stat(page, 'power') === 29, 'retreat: back to Causeway Bay, no penalty (just the move)');
  // fewer than 2 tokens: only halving allowed
  await inject(page, go('liv') + 'st.stats.tokens = 1;');
  await T(page, 'riddle-option-0').click();
  check(await T(page, 'penalty-0').isDisabled() && !(await T(page, 'penalty-1').isDisabled()), 'with fewer than 2 tokens, only "halve Energy" can be picked');

  console.log('out of tokens');
  await inject(page, go('liv') + 'st.stats.tokens = 2;');
  await T(page, 'riddle-option-0').click();
  check((await T(page, 'penalty-0').textContent()).includes('⚠'), 'paying your last tokens is flagged with ⚠');
  await T(page, 'penalty-0').click();
  await T(page, 'ending').waitFor();
  check((await text(page, 'trapped-title')) === 'OUT OF TOKENS' && (await text(page, 'trapped-cause')).includes('TOKENS'), 'paying the last 2 tokens = OUT OF TOKENS ending');
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
  check((await text(page, 'hero-name')) === 'KAI' && await stat(page, 'power') === 40 && (await text(page, 'section-title')) === 'Insert Coin', 'START begins a fresh game with the new hero');

  console.log('win + score');
  net.mode = 'ok';
  await inject(page, go('dragon_summit') + "st.inventory.pearl = 1; st.found.pearl = true; st.found.lantern = true; st.used.lantern = true; for (const z of ['rat','rabbit','ox','monkey']) st.flags['zodiac_' + z] = true; st.stats.power = 14; st.stats.energy = 9;");
  await choose(page, 'Hold up the Pearl of Light');
  await T(page, 'score-screen').waitFor();
  const pct = +(await text(page, 'score-pct')).replace('%', '');
  check(pct > 0 && pct < 100, `win shows a SCORE percentage (${pct}%)`);
  check((await text(page, 'score-rank')).length > 0 && await page.locator('.score-row').count() === 7, 'score breakdown: 6 components + total, and a rank title');
  check((await text(page, 'end-zodiac')) === '4/11', 'end scorecard shows ZODIAC 4/11');
  const best = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), BEST_KEY);
  check(best?.[0]?.nickname === 'MAX' && best[0].score_pct === pct, 'score saved to this device\'s Best Scores');
  check((await text(page, 'hero-best')) === `${pct}%`, 'hero panel shows the best score');
  await page.waitForTimeout(500);
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

  console.log('zodiac master');
  await inject(page, go('dragon_summit') + "st.inventory.pearl = 1; for (const e of book.trackers[0].entries) st.flags[e.flag] = true; st.stats.power = 20;");
  await choose(page, 'Hold up the Pearl of Light');
  await T(page, 'zodiac-master').waitFor();
  check((await text(page, 'zodiac-master')).includes('ZODIAC MASTER') && (await text(page, 'end-zodiac')) === '11/11', 'all 11 animals: ZODIAC MASTER badge on the win screen');
  check((await text(page, 'section-text')).includes('ZODIAC MASTER'), 'bonus zodiac paragraph appears in the victory text');
  await page.waitForTimeout(500);
  await shot(page, '17-zodiac-master.png');
  await T(page, 'play-again').click();
  await T(page, 'avatar-modal').waitFor();
  check((await T(page, 'name-input').inputValue()) === '', 'after a win, PLAY AGAIN also starts from a blank creator');
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
  await shot(m, '19-mobile-riddle.png');
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
