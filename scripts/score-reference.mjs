// Computes the SCORE reference (the best raw score found) for every possible starting value of the
// rolled stat (Luck: 1d6+6 = 7..12), saves it to scripts/score-reference.json and writes it into
// the book's scoring.reference. Run after changing the story:
//   node scripts/score-reference.mjs            (all starting values, wide beam search, ~15 minutes)
//   node scripts/score-reference.mjs 12         (just one value)
//   node scripts/score-reference.mjs --exact    (full branch-and-bound proof; currently too big
//                                                for this book: >7M states without finishing)
// BEAM=80000 sets the beam width (default 40000). Every found route is replayed at every start value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimalSearch, followPath } from './optimal.mjs';
import { parseDice, scoreRaw } from '../public/js/engine.js';
import { loadBook } from './load-book.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bookPath = path.join(here, '..', 'public', 'data', 'neon-dragon.json');
const outPath = path.join(here, 'score-reference.json');
const book = loadBook(bookPath);
const pathsOut = path.join(here, 'score-paths.local.json'); // gitignored: the 100% routes are a spoiler
const stat = book.scoring?.reference?.byStartStat || 'luck';
const init = book.stats[stat].initial;
const { count, sides, mod } = parseDice(init.dice);
const all = Array.from({ length: count * sides - count + 1 }, (_, i) => count + mod + i);
const exact = process.argv.includes('--exact');
const beamWidth = +(process.env.BEAM || 40000);
const only = process.argv.slice(2).map(Number).filter(Boolean);
const starts = only.length ? only : all;

const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
if (fs.existsSync(pathsOut)) prev.paths = JSON.parse(fs.readFileSync(pathsOut, 'utf8')).paths;
const found = [];
const out = { byStartStat: stat, method: exact ? 'exact' : `beam search, width ${beamWidth}`, values: { ...(prev.values || {}) }, paths: { ...(prev.paths || {}) } };
for (const v of starts) {
  const t = Date.now();
  const r = optimalSearch(book, { startStat: stat, startValue: v, beamWidth, beamOnly: !exact, onProgress: (n, p) => process.stdout.write(`\r  ${stat} ${v}: ${n} states, ${p} pruned...`) });
  console.log(`\n${stat} ${v}: best raw score ${r.raw} (${r.states} states, ${r.pruned} pruned, ${((Date.now() - t) / 1000).toFixed(0)}s, ${r.final?.moves} moves)`);
  found.push(r.path);
}
// The beam can miss a route at one starting value that it finds at another, and a stored route from an
// earlier run may be better (or no longer valid). Replay every candidate route on the CURRENT book at
// every starting value and keep the best winning one, so the reference is never below a known route.
const candidates = [...found, ...Object.values(prev.paths || {})];
const replay = (route, v) => { try { const st = followPath(book, route, { startStat: stat, startValue: v }); return st.ended?.type === 'win' ? scoreRaw(book, st).raw : null; } catch { return null; } };
for (const v of all) {
  let best = null, bestPath = null;
  for (const route of candidates) { const raw = replay(route, v); if (raw !== null && (best === null || raw > best)) { best = raw; bestPath = route; } }
  if (best === null) continue;
  if (best !== out.values[String(v)]) console.log(`${stat} ${v}: reference ${best} (best replayed route)`);
  out.values[String(v)] = best;
  out.paths[String(v)] = bestPath;
}
fs.writeFileSync(outPath, JSON.stringify({ byStartStat: out.byStartStat, method: out.method, values: out.values }, null, 1) + '\n');
fs.writeFileSync(pathsOut, JSON.stringify({ note: 'Local only (gitignored): the best routes found. Spoilers!', paths: Object.fromEntries(all.filter((v) => out.paths[String(v)]).map((v) => [String(v), out.paths[String(v)]])) }, null, 1) + '\n');
book.scoring.reference = { byStartStat: stat, values: out.values };
fs.writeFileSync(bookPath, JSON.stringify(book, null, 1) + '\n');
console.log('wrote', path.relative(process.cwd(), outPath), '(values only),', path.relative(process.cwd(), pathsOut), '(routes, gitignored) and scoring.reference in the book:', JSON.stringify(out.values));
