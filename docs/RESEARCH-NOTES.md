# Structure notes: *Double Trouble* (Nintendo Adventure Books #1, 1991)

The source is the OCR text layer of `NintendoAdventureBooks01-DoubleTrouble1991.pdf` from archive.org
item `RetroGamingBooksFiction`, plus the [gamebooks.org](https://gamebooks.org/index.php/Item/1811/Show)
listing. Counts come from the OCR. The scan is two pages per sheet in columns, so counts are
approximate. **This is a description of mechanics only. No text from the book is reproduced.**

| Mechanic | What the book does | How the schema models it |
|---|---|---|
| Sections | A chapter ends with an instruction to turn to a specific **page number**. That page is the next "section". About 72 "turn to page N" instructions appear in the OCR. gamebooks.org lists 121 pages, 59 sections and 4 endings. | `sections` keyed by id (ids may be numbers-as-strings like `"96"`), `choices[].target` |
| Branching choices | 2–3 options of the form "if you think the hero should X, turn to page N". | `choices[]` with `label` + `target` |
| Items | A boxed notice tells the reader the hero now has an item, e.g. a magnifying glass or a power-up. The reader keeps track of items on a scorecard page at the back. | `items` catalogue, `onEnter: [{addItem}]` |
| Conditional choices | Some branches only apply if the hero has a particular item, e.g. "if he has the X, turn to page N". | `choices[].conditions: {hasItem}` and `lockedHint` |
| Coins / score | Boxed notices add coins (8 coin-collect boxes in the OCR). Later branches compare the coin total against thresholds, e.g. 20 or more vs fewer than 20. The final score is coins × 10, rated on a chart. | Stackable item or stat; `conditions: {stat, op, value}` or `{hasItem, quantity}` |
| Puzzles that set a number | A maze or counting puzzle gives a number. An item can lower it ("subtract 3 if you have the power-up"). The total picks one of three pages. | `effects: [{if, then, else}]`, stat comparisons |
| Randomness | **Flip a coin**: heads goes to one page, tails to another. | `test` with `dice: "1d2"` and `target: 2` (heads = success) |
| Endings | Four failure endings marked **GAME OVER** that send you back to try again, plus a successful finish followed by the score chart. | `ending: {type: "death" or "fail" or "win", stars}` |
| Looping | "Go back to the page you just read and try again" and occasional loops back to earlier pages. | Choices may target any earlier section; `visited` condition and `hideIf` stop exploits |

## What the schema adds beyond this book

The reader app also supports classic **dice-and-stat** gamebook systems: stats rolled at the start
(`initial: {dice: "1d6+6"}`, `max: "initial"`), Test-Your-Luck style tests (`againstStat` + `costEffects`),
round-by-round combat (`combat` with enemy attack/health), provisions you can use from the
inventory (`items.*.use`), and story flags. These aren't in *Double Trouble*, but they are standard in
the genre. The original sample adventure uses them so every feature gets exercised.
