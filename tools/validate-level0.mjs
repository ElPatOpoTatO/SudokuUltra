#!/usr/bin/env node
// validate-level0.mjs — checks every Level 0 script in content/level0/*.json
// with validateScript() from src/level0-script.js, then checks that a set of
// deliberately broken scripts is rejected (the validator must catch them).
//
//   node tools/validate-level0.mjs [file.json …]
//
// Prints one line per script (errors and warnings below it). Exits 1 if a
// shipped script is invalid or a broken fixture is accepted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScript } from '../src/level0-script.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'content/level0');
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(DIR, f));

let failed = 0;
for (const f of files) {
  let script;
  try { script = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { console.log(`FAIL ${path.relative(ROOT, f)}: not valid JSON (${e.message})`); failed++; continue; }
  const r = validateScript(script);
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${path.relative(ROOT, f)}: ${r.steps ?? '?'} steps${r.complete ? ', board complete at the end' : ''}`);
  for (const e of r.errors) console.log(`  error: ${e}`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  if (!r.ok) failed++;
}

// Broken fixtures, each derived from the first script: every one must be rejected.
if (files.length) {
  const base = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  const clone = () => JSON.parse(JSON.stringify(base));
  const firstOf = (s, t) => s.steps.findIndex((st) => st.expect && t in st.expect);
  const broken = {
    'unknown top-level field': (s) => { s.colour = 'blue'; },
    'unknown step field': (s) => { s.steps[0].sound = 'ding'; },
    'unknown expect type': (s) => { s.steps[0].expect = { wiggle: true }; },
    'two expect types': (s) => { s.steps[0].expect = { continue: true, press: 'pencil' }; },
    'wrong digit in a placement': (s) => { const k = firstOf(s, 'place'); s.steps[k].expect.place.digit = s.steps[k].expect.place.digit % 9 + 1; },
    'placement in a filled cell': (s) => { const k = firstOf(s, 'place'); s.steps[k].expect.place.cell = s.board.indexOf('8'); },
    'note while Pencil is off': (s) => { const k = firstOf(s, 'press'); s.steps.splice(k, 1); },
    'erasing a note that is not there': (s) => { const k = firstOf(s, 'eliminate'); s.steps[k].expect.eliminate = [[0, 1]]; },
    'board with two solutions': (s) => { s.board = '0'.repeat(81); },
    'missing say': (s) => { delete s.steps[0].say; },
    'correct digit the solver cannot justify yet': (s) => { const k = firstOf(s, 'place'); const p = s.steps.find((st) => st.expect.place && st.expect.place.cell === 40).expect.place; s.steps[k].expect.place = { ...p }; },
    'press of an unknown key': (s) => { const k = firstOf(s, 'press'); s.steps[k].expect.press = 'redo'; },
    'focus row out of range': (s) => { const k = firstOf(s, 'place'); s.steps[k].focus = { row: 9 }; },
  };
  for (const [label, mutate] of Object.entries(broken)) {
    const s = clone(); mutate(s);
    const r = validateScript(s);
    console.log(`${r.ok ? 'FAIL (accepted)' : 'PASS (rejected)'} broken: ${label}${r.ok ? '' : ' -> ' + r.errors[0]}`);
    if (r.ok) failed++;
  }
}

if (failed) { console.log(`\n${failed} failure(s)`); process.exit(1); }
console.log('\nPASS');
