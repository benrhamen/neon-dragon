# Neon Dragon: a retro arcade gamebook reader

A static web app (HTML/CSS/vanilla JS, no build step, no server code) for playing choose-your-path
gamebooks. A **JSON Schema** describes each book, and a small engine runs it: sections, choices,
stats, inventory, flags, dice tests, light combat, riddles, collectables, a move timer, endings and a
score. It comes with an **original** sample adventure, *The Neon Dragon of Pixel Harbour*
(92 sections, 11 endings), set in a pixel-art Hong Kong and written for young readers (about 9 to 11).

Play it: **<https://benrhamen.github.io/neon-dragon/>**

- **Every game is a fresh start.** There are no profiles: each run begins at the arcade-style
  **Avatar & Name Creator** (6 preset heroes plus skin, hair, hair colour, outfit and accessory, drawn
  as 16×16 pixel sprites) and you must press **PRESS START**. A run in progress autosaves (reload-safe)
  and that save is wiped when the run ends.
- **BEST SCORES** are the only thing kept between games: a top 10 on this device, plus an optional
  shared **WORLD TOP 50** (Supabase). Players post a nickname, never a real name.
- **Reader**: section text with pixel-art scenes (with the hero and story characters drawn in),
  choice buttons (locked choices say what they need, risky ones are marked ⚠), stat bars, an
  inventory you can use items from, dice tests, round-by-round combat, multiple-choice riddles,
  a zodiac collection panel, and endings with stars, a score breakdown and rank.
- Works offline after the first visit (service worker) and can be added to an iPad/iPhone home screen.
  Fonts are self-hosted.

> **Copyright:** the app contains **no text from any published gamebook**. The structure research used
> one book from archive.org (*Double Trouble*, Nintendo Adventure Books #1, 1991, © Nintendo), which is
> still in copyright. See [`docs/COPYRIGHT-FINDINGS.md`](docs/COPYRIGHT-FINDINGS.md) and
> [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md).

## The sample adventure

The Moon Dragon has lost her Pearl of Light somewhere in Pixel Harbour, and the city's neon is going
dark. The hero travels through Causeway Bay, Times Square, Victoria Park, Happy Valley racecourse, the
MTR, ding-ding trams, the Star Ferry, Man Mo Temple, a cha chaan teng, a dim sum house, the Peak Tram
and Victoria Peak, meeting two riddle-masters, **Liv the Phoenix** and **Loulou the GOAT**, and a
Gremlin King along the way.

| Stat | Start | How it works |
|---|---|---|
| ⚡ **Energy** | 12 (max 12) | Small hits −1/−2, medium −3/−4, big hits **halve** it. Bubble tea and egg tarts give +3. At 0: **TRAPPED IN THE GAME FOREVER**. |
| ★ **Pixel Power** | 40, no cap | A **move timer**: −1 on every move, shown as a countdown ("N MOVES LEFT"). Food doesn't refill it; zodiac animals (+2 each), Man Mo Temple incense and a few lucky finds do. At 0: trapped. |
| ♣ **Luck** | 1d6+6 | Every luck test **uses 1 Luck, pass or fail**, and some bad choices cost Luck. Only two rare regains (Man Mo incense +1, the Rooster +1, both capped at the starting value). At Luck 0 every luck test fails; it is not a death. |
| 🪙 **Tokens** | 6 | Spent on rides and snacks and on wrong riddle answers. At 0: **OUT OF TOKENS** (game over). |

- **Halving and doubling** effects (`multiply`) hit hard and come with a glitch animation.
- **Riddles**: Liv and Loulou (and the Monkey and the Snake) ask multiple-choice riddles. Before answering you can
  always **retreat for free**. A wrong answer costs **2 tokens or half your Energy**; with fewer than
  2 tokens, halving is the only option.
- **Zodiac**: eleven animals (the Dragon is busy looking for the moon) are hidden around the city.
  Each gives +2 Pixel Power, once. Exactly **one route** finds all 11, which earns the
  **ZODIAC MASTER** badge and a bonus paragraph at the win.
- **Balance**: a random-but-careful player wins about 1 game in 6 (see Tests). The traps are fair and
  signposted (⚠ warnings, hints in the text).

### Score

Winning endings show a **SCORE** out of 100% with a retro breakdown and a rank. The book's
`scoring` block defines it; for the sample adventure:

| Component | Points |
|---|---|
| Energy left | 10 per point |
| Pixel Power left | 5 per point |
| Luck left | 10 per point |
| Zodiac animals found | 30 each |
| Different items found | 10 each |
| Different items used (eaten, drunk or given away) | 10 each |

`raw = sum of the above`, and `SCORE = floor(100 × raw / reference)`, capped at 0–100. The
**reference** is the best raw score found for the book by `scripts/optimal.mjs`, separately for
every possible starting Luck (7–12), because Luck is rolled. The search explores every choice, both
outcomes of every dice test, fights and riddles from every situation, with exact dominance pruning,
keeping the 10,000 most promising situations at each step (beam search). The stored best path
(`scripts/score-reference.json`) scores exactly **100%**, and the tests check that no random game
scores above it. A fully exhaustive proof (`--exact`, branch-and-bound) exists but is too large for
this book (it passed 7 million states without finishing), so in theory a cleverer route could exist;
it would simply show 100% too. Ranks: 100% **PIXEL LEGEND**, 90%+ NEON HERO, 75%+ HARBOUR CHAMPION,
50%+ DING-DING DASHER, 25%+ DIM SUM ROOKIE, otherwise NEW PLAYER. Losing endings don't score.

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
  js/leaderboard.js (best scores, Supabase)  js/config.js (Supabase URL + publishable key)
  data/neon-dragon.json  ← the sample book
  img/  fonts/  icons/  manifest.webmanifest  sw.js
schema/gamebook.schema.json   ← JSON Schema (draft 2020-12)
supabase/schema.sql           ← table + security for the shared WORLD TOP 50 (paste into Supabase)
tests/validate.mjs            ← ajv schema validation + book lint (missing targets, dead ends…)
tests/engine.test.mjs         ← engine unit tests, random playthroughs, balance and score checks
tests/sim.mjs                 ← random-player simulator used by the tests
tests/e2e.mjs                 ← Playwright/Chromium end-to-end test, writes screenshots/
scripts/optimal.mjs           ← best-score search (beam + dominance; optional exact branch-and-bound)
scripts/score-reference.mjs   ← writes scripts/score-reference.json + the book's scoring.reference
scripts/make-art.py           ← regenerates the pixel-art SVG scenes
docs/                         ← copyright findings, research notes, archive.org metadata
.github/workflows/pages.yml   ← GitHub Pages deploy
vercel.json
```

## The gamebook JSON Schema

File: [`schema/gamebook.schema.json`](schema/gamebook.schema.json) (JSON Schema draft 2020-12).

| Part | What it holds |
|---|---|
| `metadata` | `title`, `author`, `version`, `license {name, url, holder, notes}`, plus optional `id` (used as the save key), `original`, `ageRange`, `source` (provenance and permission reference for adaptations) |
| `stats` | Stat definitions keyed by id: `name`, `description`, `initial` (a number or `{ "dice": "1d6+6" }`), `min`, `max` (a number, `"initial"` = capped at the starting roll, or none = no cap), `color`, `icon`, `display`: `bar`, `number` or `timer` (a countdown bar against the starting value that flashes when low) |
| `rules` | `healthStat`; `depletion`: a list of `{stat, target, atOrBelow}` checked after **every** change (the first stat at or below its limit sends the player to `target`, usually an ending: this is how Energy, Pixel Power and Tokens each have their own game over); `perMoveEffects`: effects applied on every move (`[{"stat":"power","add":-1}]` makes a move timer); combat defaults (`attackStat`, `dice`, `damage`); the older `onHealthDepleted` still works |
| `items` | Catalogue: `name`, `description`, `icon` or pixel `sprite`, `stackable`, optional `use` (e.g. eat for +3 Energy) |
| `startingInventory` | `["map"]` or `[{ "item": "gold", "quantity": 10 }]` |
| `flags` | Optional declarations or initial values for story flags |
| `characters` | NPCs keyed by id: `name`, `description`, pixel `sprite`. Drawn on illustrations and in riddles |
| `trackers` | Collections such as the Zodiac: `{id, label, completeBadge, entries: [{id, name, flag, character}]}`. An entry counts once its flag is set. Shown in the side panel and on the ending card |
| `scoring` | `components` (each `{id, label, points}` plus one of `stat`, `tracker`, or `items: "found" / "used"`), `reference` (the best raw score: a number, or `{byStartStat, values: {"7": …, "12": …}}` when it depends on a rolled stat) and `ranks` (`[{min, title}]`). See *Score* above |
| `sections` | Keyed by id (`"1"`, `"237"` or `"night_market"`). Each has `text`, optional `title` and `illustration`, `onEnter` effects, and at least one of `choices`, `test`, `combat`, `riddle` or `ending` |
| **text** | A string or a list of paragraphs. A paragraph can be `{ "text": …, "if": condition }` to show it only sometimes. `{{name}}` is replaced with the player's name |
| **illustration** | `src` (or a pixel `sprite`), `alt`, and `characters: [{id, x, y, scale, flip}]` to draw NPC sprites on the scene (x/y on a 96×54 grid by default) |
| **choice** | `label`, `target`, optional `conditions`, `effects` (applied when chosen), `lockedHint`, `hideIfLocked`, `hideIf`. The reader adds a ⚠ warning automatically when a choice's effects (plus the next section's `onEnter`) would end the game |
| **condition** | `{hasItem, quantity}`, `{notHasItem}`, `{stat, op: eq/neq/gt/gte/lt/lte, value}`, `{flag, equals}`, `{visited}`, and `all` / `any` / `not` to combine them |
| **effect** | `{stat, add / set / restore / multiply / halve, round}` (`halve: true` halves rounding down, so 9 → 4 and 1 → 0; `multiply: 2` doubles; `round` for multiply is `down` (default), `up` or `nearest`; the result is clamped to the stat's min/max), `{addItem, quantity}`, `{removeItem, quantity}`, `{setFlag, value}`, `{clearFlag}`, `{message}`, `{if, then, else}` |
| **test** | Dice test: `dice`. Either `againstStat` (succeed if the roll is ≤ the stat, like Test Your Luck) or `target` (+`addStat`) for roll ≥ target. Also `costEffects` (paid before rolling, pass or fail: the sample book uses `[{"stat":"luck","add":-1}]`), `success` / `failure` → `{target, text, effects}`. A stat at 0 always fails an `againstStat` test |
| **combat** | `enemies [{name, attack, health, sprite}]`, `win` / `lose` outcomes, optional `flee`. Each round both sides roll dice + attack, and the lower total loses `damage` |
| **riddle** | `character`, `questions [{question, options (2-5), answer (index), correctText, wrongText}]`, `onCorrect`, `wrong {text, options [{label, effects, conditions, lockedHint}]}` (the player picks a penalty, e.g. pay 2 tokens or halve Energy), `retreat {label, target, effects}` (offered before every answer) and `success {target, text, effects}` |
| **ending** | `{type: win, death, fail or neutral, title, stars 0-3, style}`. `style: "trapped"` shows the arcade GAME OVER screen (hero behind bars, CONTINUE? countdown) |

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
                     "failure": { "target": "3", "effects": [{ "stat": "stamina", "halve": true }] } } },
    "win":  { "text": "Treasure!", "onEnter": [{ "addItem": "gold", "quantity": 50 }], "ending": { "type": "win", "title": "RICH!", "stars": 3 } },
    "dead": { "text": "You collapse.", "ending": { "type": "death", "title": "GAME OVER", "style": "trapped" } }
  }
}
```

To add your own book, save it in `public/data/`, run `npm run validate`, and change `BOOK_URL` at the
top of `public/js/app.js`. If it has a `scoring` block, run `npm run score:ref` to compute its
reference (the best possible score) so that a perfect game shows 100%.

## Best scores and the WORLD TOP 50 (Supabase)

Nothing about a player is stored except their **best scores**. Each winning game is added to a
**top 10 on this device** (`localStorage`: nickname, avatar thumbnail, score %, rank, date, zodiac
count). The 🏆 button (title bar, creator and end screen) opens **BEST SCORES** with two tabs:
**WORLD TOP 50** and **MY DEVICE**.

The world board is optional and uses a free [Supabase](https://supabase.com) project through its REST
API (plain `fetch`, no library). If `public/js/config.js` is empty, or Supabase can't be reached, or the
table doesn't exist yet, the game quietly uses the device scores only.

Nicknames are at most 12 characters (A–Z, 0–9, space and `_ . ! -`), stored in capitals, and checked
against a small rude-word filter (also catching l33t spellings). The creator reminds players to
**use a nickname, not their real name**. Posting to the world board is a separate button on the score
screen, so nothing is sent unless the player chooses to.

**Setup (once):**

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql)
   and click **Run**. It is safe to run again: it creates the `scores` table if needed, (re)applies
   the CHECK constraints, turns on Row Level Security with **read and insert only** for the public
   (no update or delete), and adds an anti-spam trigger (at most 5 posts per nickname per minute and
   60 per minute overall; the server sets the time and capitalises the nickname).
3. In **Project Settings → API Keys**, copy the project URL and the **publishable** key
   (`sb_publishable_…`; a legacy `anon` key also works) into `public/js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://<project>.supabase.co';
   export const SUPABASE_ANON_KEY = 'sb_publishable_...';
   ```
   The publishable key is designed to be public: what it can do is limited by the RLS policies
   above. The app sends it only in the `apikey` header (publishable keys are not JWTs, so there's no
   `Authorization: Bearer` header; a legacy `eyJ…` anon key gets both). **Never** put the `secret` /
   `service_role` key in the site.
4. Check it: `curl "$SUPABASE_URL/rest/v1/scores?select=*&limit=1" -H "apikey: $SUPABASE_ANON_KEY"`
   should return `[]`. Before step 2 it returns a 404 `PGRST205` error ("Could not find the table"),
   and the game falls back to device scores.

To moderate, use the Supabase dashboard (Table Editor) to delete rows.

## Tests

```bash
npm run validate      # ajv (draft 2020-12, strict) + integrity lint for every book in public/data
npm run test:engine   # node:test: rules, deaths, riddles, zodiac, luck, balance, score (about 1 min)
npm run test:e2e      # Playwright + headless Chromium (first time: npx playwright install chromium)
npm test              # all of the above
npm run score:ref     # re-run the best-score search after changing the story (a few minutes)
```

`test:engine` covers halving, the per-move timer, the Energy / Pixel Power / Tokens game overs
(including in combat and in riddles), the Luck drain (Luck 0 always fails), riddles (right, wrong +
pay, wrong + halve, the under-2-tokens rule, retreat), zodiac (+2 once each, exactly one route finds
all 11), every ending being reachable, and the **balance**: thousands of random playthroughs must win
15–25% of the time. The random player picks uniformly among the choices but avoids ⚠-marked ones
when it has a safe option, uses an item 10% of the time, retreats from 15% of riddles (otherwise
guesses) and flees 10% of fight rounds. Latest figures: BAL_SUMMARY

The score tests replay the stored optimal path (it must score exactly 100%, find all 11 animals and
earn ZODIAC MASTER), check that the reference still matches `scripts/score-reference.json`,
and check that no random win ever scores above it.

`test:e2e` starts its own static server, plays through the app with the network to Supabase mocked
(working board, and missing table), and saves screenshots to `screenshots/`. It covers: the creator
(always blank, can't be skipped, nickname rules), PRESS START, choices, stats and the move timer,
⚠ warnings, halving, riddles with both penalties and retreat, OUT OF TOKENS, the trapped GAME OVER,
reload/resume, a fresh creator after every ending, the score screen, BEST SCORES (both tabs,
offline fallback, posting), ZODIAC MASTER, and mobile/iPad layouts.

## Free hosting

The site is **`public/`**. All asset paths are relative, so it works at a domain root or in a
sub-folder like `https://<user>.github.io/<repo>/`. This repo is deployed to GitHub Pages by
`.github/workflows/pages.yml` on every push to `main` (it validates the book, runs the engine tests
and publishes `public/`).

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
5. The workflow runs on every push to `main`. Watch it under the **Actions** tab.
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
the first load (the WORLD TOP 50 needs a connection). Device best scores are per device and per
browser. Clearing Safari website data deletes them.

## Credits and licences

- Story, pixel art, sprites and code: original work for this prototype.
- Fonts: **Press Start 2P** (CodeMan38) and **VT323** (Peter Hull), both under the SIL Open Font License.
  The licence texts are in `public/fonts/`.
- No third-party runtime libraries. Dev-only: ajv, ajv-formats, playwright. The optional leaderboard
  uses Supabase's REST API.

## Known limitations

- One book is loaded at a time (`BOOK_URL`). There's no library or book-picker screen yet.
- The world board trusts the browser: someone determined could post a fake score with the public
  key (RLS, CHECK limits and the rate-limit trigger keep it tidy, and rows can be deleted in the
  dashboard).
- The best-score search assumes the book follows a few rules (food only restores Energy, no
  condition reads Energy, stat effects are monotone). It checks them and refuses to run otherwise.
- Sound effects are synthesized beeps. They need one tap first (browser autoplay rules) and there's a mute button.
