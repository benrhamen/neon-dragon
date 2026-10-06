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

const dataDir = path.join(root, 'public/data');
const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));
let failed = false;
for (const f of files) {
  const book = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
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

if (failed) { console.error('VALIDATION FAILED'); process.exit(1); }
console.log('ALL BOOKS VALID');
