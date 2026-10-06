// Computes the SCORE reference (the best raw score found) for every possible starting value of the
// rolled stat (Luck: 1d6+6 = 7..12), saves it to scripts/score-reference.json and writes it into
// the book's scoring.reference. Run after changing the story:
//   node scripts/score-reference.mjs            (all starting values, wide beam search, a few minutes)
//   node scripts/score-reference.mjs 12         (just one value)
//   node scripts/score-reference.mjs --exact    (full branch-and-bound proof; currently too big
//                                                for this book: >7M states without finishing)
// BEAM=20000 sets the beam width (default 10000).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimalSearch } from './optimal.mjs';
import { parseDice } from '../public/js/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bookPath = path.join(here, '..', 'public', 'data', 'neon-dragon.json');
const outPath = path.join(here, 'score-reference.json');
const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
const stat = book.scoring?.reference?.byStartStat || 'luck';
const init = book.stats[stat].initial;
const { count, sides, mod } = parseDice(init.dice);
const all = Array.from({ length: count * sides - count + 1 }, (_, i) => count + mod + i);
const exact = process.argv.includes('--exact');
const beamWidth = +(process.env.BEAM || 10000);
const only = process.argv.slice(2).map(Number).filter(Boolean);
const starts = only.length ? only : all;

const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
const out = { byStartStat: stat, method: exact ? 'exact' : `beam search, width ${beamWidth}`, values: { ...(prev.values || {}) }, paths: { ...(prev.paths || {}) } };
for (const v of starts) {
  const t = Date.now();
  const r = optimalSearch(book, { startStat: stat, startValue: v, beamWidth, beamOnly: !exact, onProgress: (n, p) => process.stdout.write(`\r  ${stat} ${v}: ${n} states, ${p} pruned...`) });
  console.log(`\n${stat} ${v}: best raw score ${r.raw} (${r.states} states, ${r.pruned} pruned, ${((Date.now() - t) / 1000).toFixed(0)}s, ${r.final?.moves} moves)`);
  if (!(r.raw > (prev.values?.[String(v)] ?? -Infinity)) && prev.paths?.[String(v)] && !exact) { console.log(`  kept the previous, higher ${prev.values[String(v)]}`); continue; }
  out.values[String(v)] = r.raw;
  out.paths[String(v)] = r.path;
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
book.scoring.reference = { byStartStat: stat, values: out.values };
fs.writeFileSync(bookPath, JSON.stringify(book, null, 1) + '\n');
console.log('wrote', path.relative(process.cwd(), outPath), 'and scoring.reference in the book:', JSON.stringify(out.values));
