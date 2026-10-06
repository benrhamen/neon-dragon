# Neon Dragon: a retro arcade gamebook reader

A static web app (HTML/CSS/vanilla JS, no build step, no server code) for playing choose-your-path
gamebooks. A **JSON Schema** describes each book, and a small engine runs it: sections, choices,
stats, inventory, flags, dice tests, light combat and endings. It comes with an **original** sample
adventure, *The Neon Dragon of Pixel Harbour* (34 sections, 5 endings), written for kids aged about
9 to 11.

- Arcade-style **Avatar & Name Creator** on first launch: 6 preset heroes plus skin, hair, hair colour,
  outfit and accessory, drawn as 16×16 pixel sprites. Several players can each keep their own save.
- **Reader**: section text with pixel-art scenes, choice buttons (locked choices say what they need),
  live stats bars, an inventory you can use items from, dice tests, round-by-round combat, and
  endings with stars.
- **Progress autosaves** in `localStorage` (section, stats, inventory, flags, history, and even a
  pending dice result) and picks up where you left off after a reload. RESTART resets it.
- Works offline after the first visit (service worker) and can be added to an iPad/iPhone home screen.
  Fonts are self-hosted.

> **Copyright:** the app contains **no text from any published gamebook**. The structure research used
> one book from archive.org (*Double Trouble*, Nintendo Adventure Books #1, 1991, © Nintendo), which is
> still in copyright. See [`docs/COPYRIGHT-FINDINGS.md`](docs/COPYRIGHT-FINDINGS.md) and
> [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md).

## Quick start (local)

```bash
npm install          # only needed for tests (ajv + playwright)
npm run serve        # → http://localhost:8080  (python3 -m http.server, serves ./public)
```

The site has to be served over http(s), because the book JSON is loaded with `fetch`. Opening
`public/index.html` directly as a file won't work.

Useful URL options: `?seed=42` makes dice rolls repeatable (handy for testing), and `?nosw` turns off
the service worker.

## Project layout

```
public/                  ← the deployable site (index.html is at the root of this folder)
  index.html  css/  js/engine.js (rules, no DOM)  js/app.js (UI)  js/avatar.js  js/sound.js
  data/neon-dragon.json  ← the sample book
  img/  fonts/  icons/  manifest.webmanifest  sw.js
schema/gamebook.schema.json   ← JSON Schema (draft 2020-12)
tests/validate.mjs            ← ajv schema validation + book lint (missing targets, dead ends…)
tests/engine.test.mjs         ← engine unit tests + 3000 random playthroughs
tests/e2e.mjs                 ← Playwright/Chromium end-to-end test, writes screenshots/
scripts/make-art.py           ← regenerates the pixel-art SVG scenes
docs/                         ← copyright findings, research notes, archive.org metadata
.github/workflows/pages.yml   ← GitHub Pages deploy (ready, not pushed)
vercel.json
```

## The gamebook JSON Schema

File: [`schema/gamebook.schema.json`](schema/gamebook.schema.json) (JSON Schema draft 2020-12).

| Part | What it holds |
|---|---|
| `metadata` | `title`, `author`, `version`, `license {name, url, holder, notes}`, plus optional `id` (used as the save key), `original`, `ageRange`, `source` (provenance and permission reference for adaptations) |
| `stats` | Stat definitions keyed by id: `name`, `initial` (a number or `{ "dice": "1d6+6" }`), `min`, `max` (a number or `"initial"` = capped at the starting roll), `color`, `icon`, `display` |
| `rules` | `healthStat`, `onHealthDepleted` (the section to jump to when health hits its minimum), combat defaults (`attackStat`, `dice`, `damage`) |
| `items` | Catalogue: `name`, `description`, `icon` or pixel `sprite`, `stackable`, optional `use` (e.g. eat for +4 energy) |
| `startingInventory` | `["map"]` or `[{ "item": "gold", "quantity": 10 }]` |
| `flags` | Optional declarations or initial values for story flags |
| `sections` | Keyed by id (`"1"`, `"237"` or `"night_market"`). Each has `text` (a string or paragraphs; `{{name}}` is replaced with the player's name), optional `title` and `illustration`, `onEnter` effects, and at least one of `choices`, `test`, `combat` or `ending` |
| **choice** | `label`, `target`, optional `conditions`, `effects` (applied when chosen), `lockedHint`, `hideIfLocked`, `hideIf` |
| **condition** | `{hasItem, quantity}`, `{notHasItem}`, `{stat, op: eq/neq/gt/gte/lt/lte, value}`, `{flag, equals}`, `{visited}`, and `all` / `any` / `not` to combine them |
| **effect** | `{stat, add or set or restore}`, `{addItem, quantity}`, `{removeItem, quantity}`, `{setFlag, value}`, `{clearFlag}`, `{message}`, `{if, then, else}` |
| **test** | Dice test: `dice`. Either `againstStat` (succeed if the roll is ≤ the stat, like Test Your Luck) or `target` (+`addStat`) for roll ≥ target. Also `costEffects`, `success` / `failure` → `{target, text, effects}` |
| **combat** | `enemies [{name, attack, health, sprite}]`, `win` / `lose` outcomes, optional `flee`. Each round both sides roll dice + attack, and the lower total loses `damage` |
| **ending** | `{type: win, death, fail or neutral, title, stars 0-3}` |

### Small example

```json
{
  "schemaVersion": "1.0",
  "metadata": { "id": "cave", "title": "The Little Cave", "author": "You", "version": "1.0.0",
                "license": { "name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/" } },
  "start": "1",
  "rules": { "healthStat": "stamina", "onHealthDepleted": "dead" },
  "stats": {
    "stamina": { "name": "Stamina", "initial": { "dice": "2d6+12" }, "min": 0, "max": "initial" },
    "luck":    { "name": "Luck",    "initial": { "dice": "1d6+6" },  "min": 0, "max": "initial" }
  },
  "items": { "key": { "name": "Iron Key" }, "gold": { "name": "Gold", "stackable": true } },
  "startingInventory": [{ "item": "gold", "quantity": 5 }],
  "sections": {
    "1": { "text": "A cave mouth yawns before you, {{name}}. A key glints in the mud.",
           "choices": [
             { "label": "Pick up the key", "target": "2", "effects": [{ "addItem": "key" }] },
             { "label": "Walk straight in", "target": "3" } ] },
    "2": { "text": "The key is cold and heavy.", "choices": [{ "label": "Go in", "target": "3" }] },
    "3": { "text": "An iron door blocks the tunnel.",
           "choices": [
             { "label": "Unlock it", "target": "win", "conditions": { "hasItem": "key" }, "lockedHint": "Needs the Iron Key" },
             { "label": "Squeeze through the crack", "target": "4" } ] },
    "4": { "text": "Rocks shift above you!",
           "test": { "label": "Test your Luck", "dice": "2d6", "againstStat": "luck",
                     "costEffects": [{ "stat": "luck", "add": -1 }],
                     "success": { "target": "win" },
                     "failure": { "target": "3", "effects": [{ "stat": "stamina", "add": -4 }] } } },
    "win":  { "text": "Treasure!", "onEnter": [{ "addItem": "gold", "quantity": 50 }], "ending": { "type": "win", "title": "RICH!", "stars": 3 } },
    "dead": { "text": "You collapse.", "ending": { "type": "death", "title": "GAME OVER" } }
  }
}
```

To add your own book, save it in `public/data/`, run `npm run validate`, and change `BOOK_URL` at the
top of `public/js/app.js`.

## Tests

```bash
npm run validate      # ajv (draft 2020-12, strict) + integrity lint for every book in public/data
npm run test:engine   # node:test: rules, seeded dice, combat, item use, 3000 random playthroughs
npm run test:e2e      # Playwright + headless Chromium (first time: npx playwright install chromium)
npm test              # all of the above
```

`test:e2e` starts its own static server, plays through the app and saves screenshots to `screenshots/`.
It covers: the first-launch avatar modal, saving the name and avatar, choices, stats and inventory
changes, locked choices, a dice test, reload/resume, the win ending, editing the hero, restart, combat,
a second player, and mobile/iPad layouts.

## Free hosting

Nothing here has been pushed or deployed. These are the steps for when you want to. The site is
**`public/`**. All asset paths are relative, so it works at a domain root or in a sub-folder like
`https://<user>.github.io/<repo>/`.

> Only publish content that is public domain, openly licensed, or your own. The sample adventure is
> original. Don't add text from published gamebooks (see the copyright notes).

### Option A: GitHub Pages (free)

1. Create a free account at <https://github.com> if you don't have one.
2. Create a new **empty** repository (e.g. `neon-gamebook`). Private repos can use Pages only on paid
   plans, so pick **Public** on a free plan, and only if everything in the repo is fine to share.
3. Push this folder:
   ```bash
   git remote add origin https://github.com/<you>/neon-gamebook.git
   git branch -M main
   git push -u origin main
   ```
4. In the repo, go to **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
5. The workflow in `.github/workflows/pages.yml` runs on every push to `main`. It validates the book,
   runs the engine tests, and publishes `public/`. Watch it under the **Actions** tab.
6. The site appears at `https://<you>.github.io/neon-gamebook/` (the URL is shown in the workflow run).

### Option B: Vercel (free Hobby plan)

1. Create a free account at <https://vercel.com> (you can sign in with GitHub).
2. **Add New… → Project → Import** the GitHub repo from Option A, steps 1–3.
3. Vercel reads `vercel.json`: install `npm ci`, build `npm run build` (which runs schema
   validation), output directory `public`. Leave Framework Preset as **Other**, then click **Deploy**.
4. You get a URL like `https://neon-gamebook.vercel.app`. Each push to `main` redeploys.
5. To deploy without GitHub: `npm i -g vercel`, then run `vercel` in this folder, then
   `vercel --prod`.

### Adding it to the iPad home screen

Open the site in Safari, tap **Share → Add to Home Screen**. It opens full-screen and works offline after
the first load. Saves are per device and per browser. Clearing Safari website data deletes them.

## Credits and licences

- Story, pixel art, sprites and code: original work for this prototype.
- Fonts: **Press Start 2P** (CodeMan38) and **VT323** (Peter Hull), both under the SIL Open Font License.
  The licence texts are in `public/fonts/`.
- No third-party runtime libraries. Dev-only: ajv, ajv-formats, playwright.

## Known limitations

- Saves live only in the browser's `localStorage`. There is no cloud sync between devices.
- One book is loaded at a time (`BOOK_URL`). There's no library or book-picker screen yet.
- The schema covers the common gamebook mechanics. Very custom rules (e.g. multi-character parties,
  timed sections, maps) would need schema extensions.
- Sound effects are synthesized beeps. They need one tap first (browser autoplay rules) and there's a mute button.
