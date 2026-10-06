# Neon Dragon: a retro arcade gamebook reader

A static web app (HTML/CSS/vanilla JS, no build step, no server code) for playing choose-your-path
gamebooks. A **JSON Schema** describes each book, and a small engine runs it: sections, choices,
stats, inventory, flags, dice tests, light combat, riddles, collectables, a move timer, endings and a
score. It comes with an **original** sample adventure, *The Neon Dragon of Pixel Harbour*
(109 sections, 11 endings), set in a pixel-art Hong Kong and written for young readers (about 9 to 11).

Play it: **<https://benrhamen.github.io/neon-dragon/>**

- **Every game is a fresh start.** There are no profiles: each run begins at the arcade-style
  **Avatar & Name Creator** (6 preset heroes plus 9 skin colours including blue, green and grey, hair,
  hair colour, outfit, a hat/gear accessory and three optional add-ons, **beard**, **beanie** and
  **cape**, each switched on or off independently; drawn as 16×16 pixel sprites) and you must press **PRESS START**. A run in progress autosaves (reload-safe)
  and that save is wiped when the run ends.
- **BEST SCORES** are the only thing kept between games: a top 10 on this device, plus an optional
  shared **WORLD TOP 50** (Supabase). Players post a nickname, never a real name.
- **Reader**: section text with pixel-art scenes (with the hero and story characters drawn in),
  choice buttons (locked choices say what they need, risky ones are marked ⚠), stat bars, an
  inventory you can use items from, dice tests, round-by-round combat, multiple-choice riddles,
  a zodiac collection panel, and endings with stars, a score breakdown and rank.
- Works offline after the first visit (service worker) and can be added to an iPad/iPhone home screen.
  New versions are picked up quickly (versioned cache, no stale HTTP cache) with a "NEW VERSION! TAP TO
  RELOAD" prompt; the run is autosaved, so reloading loses nothing.
  Fonts are self-hosted.

> **Copyright:** the app contains **no text from any published gamebook**. The structure research used
> one book from archive.org (*Double Trouble*, Nintendo Adventure Books #1, 1991, © Nintendo), which is
> still in copyright. See [`docs/COPYRIGHT-FINDINGS.md`](docs/COPYRIGHT-FINDINGS.md) and
> [`docs/RESEARCH-NOTES.md`](docs/RESEARCH-NOTES.md).

## The sample adventure

The Moon Dragon has lost her Pearl of Light somewhere in Pixel Harbour, and the city's neon is going
dark. The hero travels through Causeway Bay, Times Square, Victoria Park, Happy Valley racecourse, the
MTR, ding-ding trams, the Star Ferry, Statue Square, Man Mo Temple, a cha chaan teng, a dim sum house, the Peak Tram
and Victoria Peak, meeting two riddle-masters, **Liv the Phoenix** and **Loulou the GOAT**, and a
Gremlin King along the way.

| Stat | Start | How it works |
|---|---|---|
| ⚡ **Energy** | 32 (max 32) | Small hits −1/−2, medium −3/−4, big hits **halve** it. Bubble tea and egg tarts give +3. At 0: **TRAPPED IN THE GAME FOREVER**. |
| ★ **Pixel Power** | 150, no cap | A **move timer**: −1 on every move, shown as a countdown ("N MOVES LEFT"). Food doesn't refill it; zodiac animals (+2 each), Man Mo Temple incense and a few lucky finds do. At 0: trapped. |
| ♣ **Luck** | 1d6+6 | Every luck test **uses 1 Luck, pass or fail**, some bad choices cost Luck, and dice gambles risk it. Only two rare regains (Man Mo incense +1, the Rooster +1, both capped at the starting value). At 0: **YOUR LUCK RAN OUT**, trapped (a ⚠ warning shows on any choice or roll that would do it). |
| 🪙 **Tokens** | 5 | Spent on rides and snacks and on wrong riddle answers. Riddles pay **no** tokens; you find them around the city instead (+3 once each in Central, Man Mo Temple, on the ding-ding tram and in Causeway Bay, plus a few story rewards). At 0: **OUT OF TOKENS** (game over). |

- **Halving and doubling** effects (`multiply`) hit hard and come with a glitch animation.
- **Riddles**: Liv and Loulou (and the Monkey and the Snake) ask multiple-choice riddles drawn at
  random from a pool of **200 original riddles** (`public/data/riddles.json`: wordplay, logic,
  nature, Hong Kong and Chinese culture, maths; 3-4 options, ages 9-11). **You pass when you get one
  right** (+2 Energy, no tokens). A wrong answer costs **2 tokens or half your Energy** (and shows the
  right answer; with fewer than 2 tokens, halving is the only option), and then the same character
  asks **another** random riddle (`RIDDLE 2 · ... · TRY AGAIN!`), again and again until you answer one
  correctly. Before every riddle you can still **head back for free** and take another path, so you
  are never stuck; the usual game overs still apply (Energy 0 or Tokens 0). A game never repeats a
  riddle, and the draws are saved with the run, so reloading the page can't re-roll them.
- **Bonus stars** ✦: every **won luck roll** (a passed luck test or a won dice gamble) earns a bonus
  star (and so does the Statue Square find), with a sparkly pixel star-burst in the stats panel. They are purely for fun: they don't count
  in the score, can't be spent and change no stat. The total shows on the ending screen and as a ✦
  STARS column in Best Scores.
- **Dice gambles**: every bet in the story (the claw machine, the Happy Valley horse race) uses one
  rule, and gambles only ever touch **Luck** (never Energy): roll two dice. **8 or more wins** the prize
  (42%), **exactly 7 loses HALF your Luck**, rounded down (17%), **6 or less loses 2 Luck** plus the
  stake (42%). The dice screen always shows the odds (`WIN 8+ (42%) · 7 = HALF LUCK (17%) · 6 OR LESS
  LOSE -2 LUCK (42%)`), because gambling usually doesn't pay. Luck tests (sneaking, balancing,
  grabbing) are not gambles: they use 1 Luck and pass on a roll at or under your Luck.
- **Fail endings** (lost in the alleys, all at sea, shopping forever...) use the same TRAPPED IN THE
  GAME screen as running out of a stat: each one empties the stat it blames (Pixel Power, or Energy
  for the boss), so the stats panel shows 0 and the screen says e.g. **YOUR PIXEL POWER RAN OUT**.
- **Boss duel: Turbo Bolt-Bot** guards the Sky Tower and is **mandatory**: every winning path goes
  through a win against it (the tests check the story graph). Freeing the Snake in the Gremlin Vault
  gives you the Pearl, but the vault's stairs lead back up to the Peak, and only after beating the
  robot can you race up the tower to the Dragon. Bolt-Bot has **ATTACK 8, 10 HP, and its bops cost 3
  Energy**. Each round both roll two dice + attack (yours is your Luck); you bop it for 2, and you lose
  at Energy 2 or less. A well-prepared hero gets **boosts**, listed on the fight screen and lit up when
  active: 2+ zodiac friends **+1 attack**, 4+ another **+1**, Liv's Phoenix Feather **+1**, the duck
  Umbrella blocks **1 damage** per bop, and the three old shortcuts are now pre-fight advantages picked
  up at the Peak: the **Silver Whistle** makes the robot dizzy (**it starts with 4 less HP**), sharing an
  egg tart or bubble tea (**snack break**) gives **+4 Energy** before the fight, and **Loulou's climb**
  to the high ledge gives the **high ground, +1 attack**. **RUN AWAY! (back to the lookout, -3 Pixel
  Power)** is offered from round 0 until the duel is decided; it sends you back to the Peak, where the
  duel is still waiting.
- **Right path, wrong path**: wherever a zodiac animal or riddle character is met (all 11 animals
  and Liv), two paths lead there. One goes to the real animal (who asks its riddle as before); the
  other to a **Glitch Gremlin in disguise**, dressed as that animal. The costume comes off, it costs
  **2 Energy or 2 Pixel Power**, there's no riddle and no zodiac animal, and the only way on is back to
  the fork (one more move), where the unmasked gremlin's path has gone. It's never a guess: Siu Mai
  explains the rule at the start (gremlins slip up: glowing green eyes, a zip, the wrong noise, a whiff
  of engine oil; real animals do real animal things), every fork has its clue both in the story text
  and in the choice wording, the fork scenes draw the costume with green eyes and a zip, and the
  correct side changes from fork to fork. Clues, right path vs. gremlin: Rabbit (nose twitching over a
  carrot / glowing green eyes), Rat (squeaks / cable tail and engine oil), Ox (muddy hoofprints /
  "Oink... I mean, MOO!"), Pig (green tiles and milk tea / tail held on with a safety pin), Dog (wet
  paw prints from the water / "MEOW!"), Liv (warmth you can feel / cold flames that buzz), Tiger (soft
  paw prints / painted stripes running in the rain), Horse (clip-clop / "MOOOO"), Rooster (crows at the
  neon sunrise / rubber-glove comb), Monkey (peels its banana / drinking-straw tail), Snake (shed skin /
  a hiss like a bicycle pump), Loulou (lands with a clatter of hooves / sneakers on the wrong feet).
- **Statue Square** (an optional detour from Central) belongs to the **PiGeons**. Arrive carrying an
  egg tart or a pineapple bun and they swarm you: they eat **all** of them and you lose 2 Pixel Power,
  2 Energy and 2 Luck (which can end the game like any other loss). Arrive without food and they
  ignore you, an old PiGeon drops a clue, and you find a cool pixel star: **+1 bonus star**, once per
  game, purely cosmetic.
- **Map**: explore the city first (the ding-ding tram reaches Causeway Bay from Central, Sheung Wan,
  the cafés and the dim sum house), then climb the Peak once for the finale. The Peak Tram is the
  only way to the top (the red minibus stops at the tram station), and the Gremlin Vault door in the
  tram tunnel can also be reached from the top, so the best route never climbs twice.
- **Zodiac**: all **12** animals count. Eleven are hidden around the city (each gives +2 Pixel Power,
  once); the twelfth, the Dragon, is busy with the moon and only joins at the winning finale if you
  met the other eleven. Exactly **one route** (up to the Bolt-Bot duel) gets 12/12: it earns the **ZODIAC MASTER** badge, a bonus
  paragraph, a big **LEGEND!** celebration with fireworks, and a **PLAY AGAIN VOUCHER**.
- **PLAY AGAIN VOUCHER**: a pixel ticket with the hero's nickname, the date and a unique code (e.g.
  `ND-7KQ2-AB9X`; print it or take a screenshot). Typing the code into the hero creator before the next
  game gives that game **+2 tokens**, once; used codes are remembered on the device. Codes are
  self-checking (`public/js/voucher.js`), so made-up codes are rejected. This is the only thing that
  carries over from one game to the next.
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
keeping the 40,000 most promising situations at each step (beam search). Every route it finds
(plus the routes stored from earlier runs) is then replayed on the current book at every starting
Luck, and the best winning replay sets the reference, so it is never below a known route. Only the numbers are
public (`scripts/score-reference.json`); the best routes themselves are written to the gitignored
`scripts/score-paths.local.json` so the 100% route isn't spoiled. The best path scores exactly **100%**, and the tests check that no random game
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
  data/riddles.json      ← the riddle pool (200 riddles)
  js/voucher.js          ← PLAY AGAIN voucher codes (no DOM)
  img/  fonts/  icons/  manifest.webmanifest  sw.js
schema/gamebook.schema.json   ← JSON Schema (draft 2020-12)
schema/riddles.schema.json    ← JSON Schema for riddle pools
supabase/schema.sql           ← table + security for the shared WORLD TOP 50 (paste into Supabase)
tests/validate.mjs            ← ajv schema validation + book lint (missing targets, dead ends…)
tests/engine.test.mjs         ← engine unit tests, random playthroughs, balance and score checks
tests/sim.mjs                 ← random-player simulator used by the tests
tests/e2e.mjs                 ← Playwright/Chromium end-to-end test, writes screenshots/
scripts/optimal.mjs           ← best-score search (beam + dominance; optional exact branch-and-bound)
scripts/score-reference.mjs   ← writes scripts/score-reference.json (numbers) + the book's scoring.reference;
                                the routes go to scripts/score-paths.local.json (gitignored)
scripts/load-book.mjs         ← loads a book and attaches its riddle pool (for Node scripts/tests)
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
| `rules` | `healthStat`; `depletion`: a list of `{stat, target, atOrBelow}` checked after **every** change (the first stat at or below its limit sends the player to `target`, usually an ending: this is how Energy, Pixel Power and Tokens each have their own game over); `perMoveEffects`: effects applied on every move (`[{"stat":"power","add":-1}]` makes a move timer); combat defaults (`attackStat`, `dice`, `damage`); the older `onHealthDepleted` still works; `bonusStars: true` turns on cosmetic bonus stars (+1 per passed `againstStat` test or won gamble, kept in `state.bonusStars`, never scored) |
| `items` | Catalogue: `name`, `description`, `icon` or pixel `sprite`, `stackable`, optional `use` (e.g. eat for +3 Energy) |
| `startingInventory` | `["map"]` or `[{ "item": "gold", "quantity": 10 }]` |
| `flags` | Optional declarations or initial values for story flags |
| `characters` | NPCs keyed by id: `name`, `description`, pixel `sprite`. Drawn on illustrations and in riddles |
| `trackers` | Collections such as the Zodiac: `{id, label, completeBadge, entries: [{id, name, flag, character}]}`. An entry counts once its flag is set (the sample book's 12th entry, the Dragon, is set by the victory section's `onEnter` only when the other 11 are set). A win with a complete `zodiac` tracker shows LEGEND! and a PLAY AGAIN VOUCHER. Shown in the side panel and on the ending card |
| `scoring` | `components` (each `{id, label, points}` plus one of `stat`, `tracker`, or `items: "found" / "used"`), `reference` (the best raw score: a number, or `{byStartStat, values: {"7": …, "12": …}}` when it depends on a rolled stat) and `ranks` (`[{min, title}]`). See *Score* above |
| `riddlePool` | Optional file name (relative to the book) of a riddle pool, validated by `schema/riddles.schema.json`: `{riddles: [{id, category, question, options (3-4), answer (index), explain}]}` |
| `sections` | Keyed by id (`"1"`, `"237"` or `"night_market"`). Each has `text`, optional `title` and `illustration`, `onEnter` effects, and at least one of `choices`, `test`, `combat`, `riddle` or `ending` |
| **text** | A string or a list of paragraphs. A paragraph can be `{ "text": …, "if": condition }` to show it only sometimes. `{{name}}` is replaced with the player's name |
| **illustration** | `src` (or a pixel `sprite`), `alt`, and `characters: [{id, x, y, scale, flip}]` to draw NPC sprites on the scene (x/y on a 96×54 grid by default) |
| **choice** | `label`, `target`, optional `conditions`, `effects` (applied when chosen), `lockedHint`, `hideIfLocked`, `hideIf`. The reader adds a ⚠ warning automatically when a choice's effects (plus the next section's `onEnter`) would end the game |
| **condition** | `{hasItem, quantity}`, `{notHasItem}`, `{stat, op: eq/neq/gt/gte/lt/lte, value}`, `{flag, equals}`, `{visited}`, and `all` / `any` / `not` to combine them |
| **effect** | `{stat, add / set / restore / multiply / halve, round}` (`halve: true` halves rounding down, so 9 → 4 and 1 → 0; `multiply: 2` doubles; `round` for multiply is `down` (default), `up` or `nearest`; the result is clamped to the stat's min/max), `{addItem, quantity}`, `{removeItem, quantity, lost}` (`lost: true` = taken away, not counted as used for the score), `{setFlag, value}`, `{clearFlag}`, `{bonusStar: n}` (cosmetic bonus stars, with the star-burst), `{message}`, `{if, then, else}` |
| **test** | Dice test: `dice`. Either `againstStat` (succeed if the roll is ≤ the stat, like Test Your Luck) or `target` (+`addStat`) for roll ≥ target. Also `costEffects` (paid before rolling, pass or fail: the sample book uses `[{"stat":"luck","add":-1}]`), `success` / `failure` → `{target, text, effects}`. A stat at 0 always fails an `againstStat` test. **Dice gamble**: `"type": "gamble"` (no `againstStat`/`target`; `dice` defaults to 2d6): roll ≥ `winAt` (default 8) → `success`; exactly `halfOn` (default 7) → `halfStat` (default `luck`) is halved, rounding down, and the optional `seven {target, text, effects}` outcome is used (missing target/text come from `failure`, its effects don't); lower → `failure`. The reader shows the exact odds on the dice screen |
| **combat** | `enemies [{name, attack, health, damage, sprite}]`, `win` / `lose` outcomes, optional `flee {label, target, effects}` (offered every round until the duel is decided). Each round both sides roll dice + attack, and the lower total loses health: the player's bop does the combat `damage`, an enemy's bop does its own `damage` (default: the combat `damage`). Optional `boosts [{label, conditions, tracker, min, attack, armor, stun, note}]`: each active boost (its conditions hold and, with `tracker`, at least `min` entries are met) adds `attack` to the player's roll total, `armor` (enemy bops do that much less, minimum 1), and/or `stun` (the enemy starts the fight with that much less health, minimum 1); `note` is a short text for an advantage that was already applied (e.g. "+4 Energy before the fight"). The fight screen lists them and lights up the active ones |
| **riddle** | `character`, either `questions [{question, options (2-5), answer (index), correctText, wrongText}]` or `draw: N` (ask N random riddles from the book's `riddlePool`, never repeating one within a game; seeded by the saved `riddleSeed`), `onCorrect`, `wrong {text, options [{label, effects, conditions, lockedHint}]}` (the player picks a penalty, e.g. pay 2 tokens or halve Energy), `retreat {label, target, effects}` (offered before every answer) and `success {target, text, effects}`. `untilCorrect: true` (with `draw`): after a wrong answer and its penalty the same character asks another random pool riddle, repeating until one is answered right; the retreat stays available before each new riddle and every draw is saved with the run |
| **ending** | `{type: win, death, fail or neutral, title, stars 0-3, style, cause}`. `style: "trapped"` shows the arcade GAME OVER screen (hero behind bars, CONTINUE? countdown). `cause` (a stat id) empties that stat on arrival so the stats panel matches, and the trapped screen says YOUR <STAT> RAN OUT |

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
count). Avatars are stored as a small JSON object (`skin`, `hairStyle`, `hairColor`, `outfit`,
`accessory`, plus `beard` / `beanie` / `cape: true` only when switched on), about 120 characters at
most, well inside the database's 512-byte limit; older avatars without the add-on fields still load
and draw without them. The 🏆 button (title bar, creator and end screen) opens **BEST SCORES** with two tabs:
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

`zodiac_count` allows 0-12 (the Dragon is the 12th animal), and `bonus_stars` (0-999) stores the
cosmetic bonus stars. The script is idempotent: re-run it to update an older table (0-11 zodiac
limit, no `bonus_stars` column). Until then the game still works with the old table: a 12/12 post is
retried as 11, scores are posted and read without stars, and the STARS column shows `-` for them.

## Tests

```bash
npm run validate      # ajv (draft 2020-12, strict) + integrity lint for every book in public/data
npm run test:engine   # node:test: rules, deaths, riddles, gambles, stars, boss, zodiac, luck, balance, score (about 1 min)
npm run test:e2e      # Playwright + headless Chromium (first time: npx playwright install chromium)
npm test              # all of the above
npm run score:ref     # re-run the best-score search after changing the story (~15 min;
                      # `node scripts/score-reference.mjs 10` searches one Luck value, ~3 min)
```

`test:engine` covers halving, the per-move timer, the Energy / Pixel Power / Tokens game overs
(including in combat and in riddles), the Luck rules (every test uses 1 Luck, Luck 0 = trapped, ⚠ on choices into a test at Luck 1), the
dice-gamble rule (odds, 8+ prize / 7 half Luck / 6- minus 2 Luck, never Energy, Luck 0 traps you),
fail endings emptying the stat they blame (Shopping Forever → Pixel Power 0), the 12th zodiac animal
(the Dragon joins only at the finale after all 11), PLAY AGAIN voucher codes (valid, unique,
typo-tolerant, tampering rejected, +2 tokens), the riddle pool (200 valid, unique riddles, one at a
time per riddle character, no repeats in a game, reload keeps the drawn riddle, different games get
different riddles), the riddle loop (right = pass with +2 Energy and no tokens; wrong, pay 2 tokens, a
different second and third riddle, then a correct answer passes; wrong, halve Energy, then head back
for free before the next one; reload mid-loop keeps riddle 2; the under-2-tokens rule; halving at
Energy 1 = trapped), bonus stars (+1 per passed luck test or won gamble, none for a loss or a 7,
saved with the run, never in the score or the stats), the boss (Turbo Bolt-Bot's numbers, each boost,
3-damage bops and the umbrella, and duel odds: unprepared under 75% at Luck 8, fully prepared 98%+),
the **forks** (12 gremlins, one per animal and Liv; every meeting point is only reached through its
fork's right path; each fork shows a clue in the text and the labels, the right side varies; the right
path meets the animal and asks the riddle; the wrong path costs 2 Energy or 2 Pixel Power with a
costume reveal, no riddle, no zodiac, then retreat to the fork for a move, with the gremlin gone; a
wrong path can still be the normal game over; no dead ends and every fork and gremlin can still reach
the victory), the **mandatory boss audit** (a graph search proves the victory and the Dragon are unreachable
without the duel, only a duel win enters `bot_beaten`, and every winning route from the route
enumerator contains the duel), the vault → Peak → duel → Dragon path, the old shortcuts as boosts
(whistle −4 HP, snack +4 Energy, high ground +1 attack), RUN AWAY to the Peak (−3 Pixel Power), the
5-token start and the one-time token finds, Statue Square (the PiGeons eat every tart and bun for
−2/−2/−2; without food a once-per-game cosmetic star and a clue; game over if a stat runs out; the
PiGeons spelling everywhere), the `bonusStar` effect, zodiac (+2 once each, exactly one route finds
all 12), every ending being reachable, and the **balance**: thousands of random playthroughs must win
15–25% of the time. The random player picks uniformly among the choices but avoids ⚠-marked ones
when it has a safe option, uses an item 10% of the time, retreats from 15% of riddles (otherwise
guesses and pays a random allowed penalty, again until it gets one right) and flees 10% of fight
rounds. It picks gremlin paths as often as right ones (it can't read the clues). Latest figures (v2.3.0,
20,000 games): **16.8% wins**. The boss 16.9% (59% of random players reach the now-mandatory duel),
Energy running out 15.8%, Pixel Power running out while wandering 13.4%, the six story fail endings
28.6%, tokens 2.5%, Luck 0.2%, and 5.9% go home. A prepared player on the 100% route (45 steps, 48
moves, every right path, all 11 animals) reaches the duel with full Energy and +3 attack and wins it
99.9% of the time at Luck 7 (100% at Luck 8+).

The score tests replay the locally stored optimal path (skipped when `scripts/score-paths.local.json` is absent) (it must score exactly 100%, find all 12 animals and
earn ZODIAC MASTER), check that the reference still matches `scripts/score-reference.json`,
and check that no random win ever scores above it.

`test:e2e` starts its own static server, plays through the app with the network to Supabase mocked
(working board, and missing table), and saves screenshots to `screenshots/`. It covers: the creator
(always blank, can't be skipped, nickname rules), PRESS START, choices, stats and the move timer,
⚠ warnings, halving, random riddles (different in a second game, same after a reload) with both
penalties and retreat, the riddle loop (wrong + pay → "RIDDLE 2 · TRY AGAIN!" with a different riddle,
same after a reload → correct answer passes; wrong + halve → head back for free), bonus stars (counter,
star-burst and toast on a won luck roll, none on a loss, on the win and trapped endings, posted, in
the ✦ STARS column, and an older online table without the column), the boss fight (HP 10, 3-damage
bops, all 7 boosts listed and lit for a prepared hero, a fork at Happy Valley (clue in the text and
choices, wrong path → gremlin reveal → retreat → the real Horse), whistle / snack / high ground picked up at the
Peak, no way into the tower without the duel), Statue Square (PiGeons swarm with food; star burst
without; game over), the creator's new skins and add-ons (independent toggles, combos with hats,
saved and posted under 512 characters, drawn in the creator, in-game, in the fight, on the GAME OVER
screen and in both Best Scores tabs, old avatars still load), the dice-gamble odds and result (Luck only; Luck 0 = YOUR LUCK RAN OUT),
Shopping Forever (YOUR PIXEL POWER RAN OUT, Pixel Power shows 0), the 12/12 LEGEND! finale and its
voucher (same code after a reload, printable), redeeming it in the creator (+2 tokens, made-up codes
rejected, only once), RUN AWAY from Bolt-Bot (back to the Peak) on round 0, after 1
and 2 rounds and on mobile, no toast pop-ups over the ending buttons, OUT OF TOKENS, the trapped GAME OVER,
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
