// End-to-end test in headless Chromium. Serves ./public, plays through the app and saves screenshots.
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
const URL = `${BASE}/?seed=42&nosw`;

let passed = 0; let failed = 0;
const results = [];
function check(cond, msg) {
  if (cond) { passed++; results.push(`  ✓ ${msg}`); } else { failed++; results.push(`  ✗ ${msg}`); }
  console.log(results[results.length - 1]);
}
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
};

const browser = await chromium.launch();
try {
  // ---------------- desktop ----------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(URL);
  await page.evaluate(() => document.fonts.ready);
  const modal = page.getByTestId('avatar-modal');
  await modal.waitFor();
  check(await modal.isVisible(), 'first launch shows the Avatar & Name Creator modal');
  check(await page.getByTestId('press-start').isDisabled(), 'PRESS START is disabled until a name is entered');
  const blank = await page.getByTestId('avatar-preview').evaluate((c) => c.toDataURL());
  await page.getByTestId('preset-3').click();
  await page.locator('.cycler[data-key=hairStyle] .arrow[data-dir="1"]').click();
  await page.locator('.swatch[data-key=outfit][data-val="1"]').click();
  await page.locator('.cycler[data-key=accessory] .arrow[data-dir="1"]').click();
  const custom = await page.getByTestId('avatar-preview').evaluate((c) => c.toDataURL());
  check(blank !== custom, 'avatar preview canvas updates when customizing');
  await page.getByTestId('name-input').fill('max');
  check((await page.getByTestId('name-input').inputValue()) === 'MAX', 'name is shown in arcade capitals');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, '01-avatar-creator.png') });
  await page.getByTestId('press-start').click();
  await modal.waitFor({ state: 'detached' });
  const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('gb.profiles.v1')));
  const me = prof.players[prof.activeId];
  check(me?.name === 'MAX' && me.avatar?.hairStyle && me.avatar.outfit === 1, 'name + avatar saved to localStorage');
  check((await page.getByTestId('hero-name').textContent()) === 'MAX', 'hero panel shows the player name');
  check((await page.getByTestId('section-title').textContent()) === 'Insert Coin', 'adventure starts at the first section');
  check((await page.getByTestId('section-text').textContent()).includes('You, MAX,'), 'story text is personalised with the player name');
  check((await page.getByTestId('item-token').getAttribute('aria-label')).includes('× 3'), 'starting inventory: 3 arcade tokens');

  const choose = async (label) => {
    await page.locator('.choice:not(.locked)', { hasText: label }).first().click();
    await page.waitForTimeout(120);
  };
  const stat = async (id) => parseInt(await page.getByTestId(`stat-${id}`).textContent(), 10);
  const title = () => page.getByTestId('section-title').textContent();

  await choose('Ask Auntie Lam');
  check(await page.getByTestId('item-egg_tart').isVisible(), 'choice effect: egg tart added to inventory');
  await choose('Drop a token');
  check((await page.getByTestId('item-token').getAttribute('aria-label')).includes('× 2'), 'choice effect: token removed (3 → 2)');
  await choose('night market');
  check(await page.locator('.choice', { hasText: 'Buy a rabbit lantern' }).isEnabled(), 'item-cost choice available with tokens');
  await choose('Buy a rabbit lantern');
  check(await page.getByTestId('item-lantern').isVisible(), 'bought the rabbit lantern');
  await choose('Look around');
  check(await page.locator('.choice', { hasText: 'Buy a rabbit lantern' }).count() === 0, 'hideIf: buy-lantern choice hidden once owned');
  await choose('ferry pier');
  const ferry = page.locator('.choice', { hasText: 'Pay two tokens' });
  check(await ferry.isDisabled() && (await ferry.textContent()).includes('Needs 2 Arcade Tokens'), 'locked choice shows what it needs (only 1 token left)');
  const e0 = await stat('energy');
  await choose('Sneak aboard');
  check((await stat('energy')) === e0 - 2, `stat change on entering a section (energy ${e0} → ${e0 - 2})`);
  await page.waitForTimeout(500);
  await choose('Squelch back');
  // dice test at the claw machine
  await choose('claw machine');
  check(await page.getByTestId('dice-test').isVisible(), 'dice test (TEST YOUR LUCK) is shown');
  const luck0 = await stat('luck');
  await page.getByTestId('roll').click();
  await page.getByTestId('test-result').waitFor();
  check((await stat('luck')) === luck0 - 1, 'luck test costs 1 LUCK');
  const testResult = await page.getByTestId('test-result').textContent();
  await page.reload();
  await page.getByTestId('test-result').waitFor();
  check((await page.getByTestId('test-result').textContent()) === testResult, 'reload keeps the dice result (no re-rolling)');
  await page.getByTestId('continue').click();
  const t1 = await title();
  check(['Got It!', 'So Close!'].includes(t1), `luck test branches to its outcome (${t1})`);
  const gotKey = t1 === 'Got It!';
  if (!gotKey) await choose('Back to the market');
  await choose('Peak Tram');
  await page.waitForTimeout(2800); // let toasts fade for a clean screenshot
  await page.locator('#app').hover({ position: { x: 5, y: 5 } });
  await page.screenshot({ path: path.join(shots, '02-reader-mid-adventure.png') });
  // ---- reload resumes ----
  const before = { title: await title(), energy: await stat('energy'), luck: await stat('luck'), inv: await page.getByTestId('inventory').textContent(), journey: await page.getByTestId('journey').textContent() };
  await page.reload();
  await page.getByTestId('section-title').waitFor();
  const after = { title: await title(), energy: await stat('energy'), luck: await stat('luck'), inv: await page.getByTestId('inventory').textContent(), journey: await page.getByTestId('journey').textContent() };
  check(JSON.stringify(before) === JSON.stringify(after), `reload resumes progress (section "${after.title}", stats, inventory, history)`);
  check(!(await page.getByTestId('avatar-modal').count()), 'no avatar modal on return visits');
  // ---- use an item from the inventory ----
  // ---- to the end ----
  await choose('Hold up your rabbit lantern');
  check((await title()) === 'Hidden Door', 'item-gated choice works (lantern reveals hidden door)');
  if (gotKey) {
    await choose('Unlock the door');
    await choose('Race up');
  } else {
    await choose('walk up to the Peak');
    await choose('Offer Bolt-Bot your egg tart');
    check(!(await page.getByTestId('item-egg_tart').count()), 'egg tart given away');
    await choose('Sky Tower');
    await choose('Accept the riddle');
    await choose('A clock');
    check(await page.getByTestId('item-pearl').isVisible(), 'got the Pearl of Light');
    await choose('Run up to the roof');
  }
  await choose('Hold up the Pearl');
  const ending = page.getByTestId('ending');
  await ending.waitFor();
  check((await ending.getAttribute('data-ending-type')) === 'win', 'reached the winning ending');
  await page.waitForTimeout(2800);
  await page.screenshot({ path: path.join(shots, '03-ending-win.png') });
  await page.screenshot({ path: path.join(shots, '03b-ending-win-fullpage.png'), fullPage: true });
  await page.reload();
  check(await page.getByTestId('ending').isVisible(), 'ending screen persists after reload');

  // ---- edit hero ----
  await page.getByTestId('edit-hero').click();
  await page.getByTestId('avatar-modal').waitFor();
  await page.getByTestId('name-input').fill('MAX P');
  await page.getByTestId('preset-5').click();
  await page.getByTestId('press-start').click();
  check((await page.getByTestId('hero-name').textContent()) === 'MAX P', 'hero can be edited later (name updated)');

  // ---- play again / restart ----
  await page.getByTestId('play-again').click();
  check((await title()) === 'Insert Coin' && (await page.getByTestId('item-token').getAttribute('aria-label')).includes('× 3'), 'PLAY AGAIN resets to the start with fresh inventory');

  // ---- combat ----
  await choose('Drop a token'); await choose('night market'); await choose('Peak Tram');
  await choose('Feel your way');
  await choose('Climb out');
  await choose('duel');
  check(await page.getByTestId('combat').isVisible(), 'combat encounter UI shown');
  await page.getByTestId('attack').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(shots, '05-combat.png') });
  let guard = 0;
  while (!(await page.getByTestId('combat-result').count()) && guard++ < 60) {
    await page.getByTestId('attack').click();
    await page.waitForTimeout(150);
    await page.waitForFunction(() => !document.querySelector('.die.rolling'));
  }
  const cres = await page.getByTestId('combat-result').textContent();
  check(!!cres, `combat finishes (${cres})`);
  await page.getByTestId('continue').click();
  const t2 = await title();
  check(['Clang!', 'Bopped!'].includes(t2), `combat branches to win/lose section (${t2})`);
  if (t2 === 'Bopped!') check((await page.getByTestId('ending').getAttribute('data-ending-type')) === 'death', 'losing the fight is a GAME OVER ending');

  // ---- restart button with confirm ----
  await page.getByTestId('restart').click();
  await page.getByTestId('confirm-yes').click();
  check((await title()) === 'Insert Coin', 'RESTART button (with confirm) resets progress');

  // ---- second player keeps separate progress ----
  await choose('Ask Auntie Lam');
  await page.getByTestId('player-chip').click();
  await page.getByTestId('new-player').click();
  await page.getByTestId('name-input').fill('ZOE');
  await page.getByTestId('preset-2').click();
  await page.getByTestId('press-start').click();
  await page.getByTestId('avatar-modal').waitFor({ state: 'detached' });
  check((await page.getByTestId('hero-name').textContent()) === 'ZOE' && (await title()) === 'Insert Coin', 'second player (ZOE) starts their own game');
  await page.getByTestId('player-chip').click();
  await page.locator('.player-row', { hasText: 'MAX P' }).locator('[data-play]').click();
  check((await title()) === 'Auntie Lam', 'switching back to MAX resumes their progress');
  await ctx.close();

  // ---------------- mobile ----------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await m.goto(URL);
  await m.evaluate(() => document.fonts.ready);
  await m.getByTestId('avatar-modal').waitFor();
  await m.getByTestId('preset-1').click();
  await m.getByTestId('name-input').fill('ZOE');
  await m.locator('.modal').evaluate((el) => { el.scrollTop = 0; });
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(shots, '06-mobile-avatar-creator.png') });
  await m.getByTestId('press-start').click();
  await m.getByTestId('avatar-modal').waitFor({ state: 'detached' });
  for (const l of ['Ask Auntie Lam', 'Drop a token', 'night market']) { await m.locator('.choice:not(.locked)', { hasText: l }).first().tap(); await m.waitForTimeout(150); }
  check(await m.getByTestId('mini-hud').isVisible(), 'mobile: compact stats bar visible');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `mobile: no horizontal overflow (${overflow}px)`);
  await m.waitForTimeout(2800);
  await m.evaluate(() => window.scrollTo(0, 0));
  await m.screenshot({ path: path.join(shots, '04-mobile-reader.png') });
  await m.locator('.choices').scrollIntoViewIfNeeded();
  await m.waitForTimeout(300);
  await m.screenshot({ path: path.join(shots, '04b-mobile-choices.png') });
  await mctx.close();

  // ---------------- iPad ----------------
  const ictx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, hasTouch: true });
  const ip = await ictx.newPage();
  watch(ip, 'ipad');
  await ip.goto(URL);
  await ip.getByTestId('name-input').fill('BEN');
  await ip.getByTestId('press-start').click();
  await ip.getByTestId('avatar-modal').waitFor({ state: 'detached' });
  await ip.locator('.choice', { hasText: 'Drop a token' }).click();
  await ip.waitForTimeout(2800);
  await ip.screenshot({ path: path.join(shots, '07-ipad-portrait.png') });
  await ictx.close();

  // ---------------- offline (service worker) ----------------
  const octx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const op = await octx.newPage();
  watch(op, 'offline');
  await op.goto(`${BASE}/?seed=7`);
  await op.evaluate(async () => { await navigator.serviceWorker.ready; });
  await op.reload(); // let the SW control the page
  await op.getByTestId('avatar-modal').waitFor();
  await octx.setOffline(true);
  await op.reload();
  await op.getByTestId('avatar-modal').waitFor({ timeout: 5000 });
  await op.getByTestId('name-input').fill('OFFLINE');
  await op.getByTestId('press-start').click();
  check((await op.getByTestId('section-title').textContent()) === 'Insert Coin', 'works offline after first visit (service worker)');
  await octx.close();

  check(errors.length === 0, `no page/console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  failed++;
  console.error('E2E crashed:', e);
} finally {
  await browser.close();
  server?.kill();
}
console.log(`\nE2E: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
