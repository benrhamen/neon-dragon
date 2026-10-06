// Validates every book in public/data against the JSON Schema (ajv, draft 2020-12)
// and runs the engine's integrity lint (missing targets, unknown items, dead ends, reachability).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { lintBook } from '../public/js/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(path.join(root, 'schema/gamebook.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const validatePool = ajv.compile(JSON.parse(readFileSync(path.join(root, 'schema/riddles.schema.json'), 'utf8')));

// Riddle pools: schema + every answer index points at an option, ids and questions are unique.
function checkPool(f, pool) {
  let bad = false;
  if (!validatePool(pool)) { bad = true; console.error(`✗ ${f}: riddle pool schema errors`); for (const e of validatePool.errors) console.error(`   ${e.instancePath || '/'} ${e.message}`); }
  const ids = new Set(); const qs = new Set();
  for (const r of pool.riddles || []) {
    if (ids.has(r.id)) { bad = true; console.error(`  ✗ duplicate riddle id ${r.id}`); }
    ids.add(r.id);
    const key = r.question + '|' + r.options[r.answer];
    if (qs.has(key)) { bad = true; console.error(`  ✗ duplicate riddle ${r.id}`); }
    qs.add(key);
    if (!(r.answer >= 0 && r.answer < r.options.length)) { bad = true; console.error(`  ✗ ${r.id}: answer index out of range`); }
  }
  if (!bad) console.log(`✓ ${f}: riddle pool valid (${pool.riddles.length} riddles)`);
  return bad;
}

const dataDir = path.join(root, 'public/data');
const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));
let failed = false;
for (const f of files) {
  const book = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
  if (Array.isArray(book.riddles) && !book.sections) { if (checkPool(f, book)) failed = true; continue; }
  if (book.riddlePool) {
    const pool = JSON.parse(readFileSync(path.join(dataDir, book.riddlePool), 'utf8'));
    const draws = Object.values(book.sections).reduce((a, s) => a + (s.riddle?.draw || 0), 0);
    if (pool.riddles.length < draws) { failed = true; console.error(`✗ ${f}: riddle pool too small (${pool.riddles.length} < ${draws} draws)`); }
    else console.log(`✓ ${f}: riddle pool ${book.riddlePool} has ${pool.riddles.length} riddles for ${draws} drawn riddle(s) per full playthrough`);
  }
  const ok = validate(book);
  if (!ok) {
    failed = true;
    console.error(`✗ ${f}: schema errors`);
    for (const e of validate.errors) console.error(`   ${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`);
  } else console.log(`✓ ${f}: valid against gamebook.schema.json`);
  const lint = lintBook(book);
  for (const w of lint.warnings) console.warn(`  ⚠ ${w}`);
  for (const e of lint.errors) console.error(`  ✗ ${e}`);
  if (lint.errors.length) failed = true;
  console.log(`  sections: ${lint.total} (reachable ${lint.reachable}); endings: ${lint.endings.map((e) => `${e.id}[${e.type}]`).join(', ')}`);
}
// The example in README.md must stay valid too.
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const m = readme.match(/### Small example\s+```json\n([\s\S]*?)```/);
if (!m) { failed = true; console.error('✗ README example not found'); }
else {
  const ex = JSON.parse(m[1]);
  const okEx = validate(ex);
  const lintEx = lintBook(ex);
  if (!okEx || lintEx.errors.length) { failed = true; console.error('✗ README example invalid', validate.errors, lintEx.errors); }
  else console.log(`✓ README example: valid (${lintEx.total} sections)`);
}
// Negative check: a broken book must be rejected by the schema.
const broken = { schemaVersion: '1.0', metadata: { title: 'x', author: 'y', version: '1.0', license: { name: 'z' } }, start: '1', sections: { 1: { text: 'no way out', choices: [{ label: 'go' }] } } };
if (validate(broken)) { failed = true; console.error('✗ schema accepted a broken book (choice without target)'); }
else console.log('✓ schema rejects a broken book (choice without target)');
// A dice gamble has its own fixed rule: it can't also be a luck test.
const meta = { schemaVersion: '1.0', metadata: { title: 'x', author: 'y', version: '1.0', license: { name: 'z' } }, start: '1' };
const gambleBook = (extra) => ({ ...meta, sections: { 1: { text: 'bet?', test: { type: 'gamble', dice: '2d6', success: { target: '2' }, failure: { target: '2' }, seven: { text: 'ouch' }, ...extra } }, 2: { text: 'end', ending: { type: 'neutral', title: 'The End' } } } });
if (!validate(gambleBook({}))) { failed = true; console.error('✗ schema rejected a valid dice gamble', validate.errors); }
else if (validate(gambleBook({ againstStat: 'luck' }))) { failed = true; console.error('✗ schema accepted a gamble that is also a luck test'); }
else console.log('✓ schema accepts a dice gamble and rejects a gamble mixed with a luck test');

if (failed) { console.error('VALIDATION FAILED'); process.exit(1); }
console.log('ALL BOOKS VALID');
