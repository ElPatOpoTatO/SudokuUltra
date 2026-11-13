#!/usr/bin/env node
// author-level0.mjs — teaching checks for the Level 0 scripts, on top of the
// validator (src/level0-script.js). The validator proves every move is legal
// and justified; this tool checks that each TEACHING step demonstrates the
// intended technique and that nothing simpler competes with it:
//
//   place  {tech}      the easiest technique that places this digit here is
//                      `tech` (nothing simpler would also do it), and nothing
//                      simpler competes inside the step's focus: with a digit
//                      loaded (number-first), no simpler placement of THAT
//                      digit; otherwise no full house (the one simpler move
//                      that is visible at a glance)
//   place  {payoff}    the placement is NOT possible on the plain candidates
//                      (before the eliminations the player made), only after
//   notes  {complete}  the digits are exactly the cell's candidates
//   tap    {blocker}   (World 1) the tapped given holds the digit of the next
//                      placement and shares a row or column with that box cell
//   eliminate {tech}   one `tech` step on the current candidates removes these
//                      notes; its pattern is the cells the previous tap step
//                      had the player tap (if any); no step from an earlier
//                      world would remove them too (so the new technique is
//                      needed);
//                      no full house / naked single sits inside the focus
//
//   node tools/author-level0.mjs            # every script with an intent table
//   node tools/author-level0.mjs w3         # one script
// Prints one line per checked step; exits 1 on any problem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScript, expectType, focusCells } from '../src/level0-script.js';
import { computeCands, allSteps, TECHNIQUES, TECH_INFO, peers, digitsOf, bit, popcount, cellName as nm } from '../src/solver.js';
import { ALLOW } from '../src/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RANK = Object.fromEntries(TECHNIQUES.map((t, k) => [t, k]));
const rowOf = (i) => (i / 9) | 0, colOf = (i) => i % 9;

/** Intent per script: step index -> what the step must demonstrate. */
const INTENT = {
  'w0-l0': { 2: { tech: 'full-house' }, 3: { tech: 'full-house' }, 4: { tech: 'full-house' } },
  'w1-l0': {
    1: { blocker: 49 }, 2: { blocker: 41 },
    4: { tech: 'hidden-single-box' }, 7: { tech: 'hidden-single-box' },
    9: { tech: 'hidden-single-line' },
  },
  'w2-l0': {
    3: { complete: true }, 4: { complete: true },
    6: { tech: 'naked-single' }, 7: { tech: 'naked-single' }, 9: { tech: 'naked-single' },
  },
  'w3-l0': {
    3: { tech: 'pointing' }, 6: { tech: 'claiming' }, 8: { tech: 'pointing' },
    10: { payoff: true }, 11: { payoff: true },
  },
  'w4-l0': {
    3: { tech: 'naked-pair' }, 6: { tech: 'hidden-pair' }, 8: { tech: 'naked-pair' },
    10: { payoff: true },
  },
};

function checkScript(script) {
  const intent = INTENT[script.id] || {};
  const allow = ALLOW[script.world];
  const lines = [], problems = [];
  let prev = null;
  const v = validateScript(script, {
    onStep(k, st, ctx) {
      const it = intent[k], t = expectType(st), e = st.expect;
      const { values, logic } = ctx;
      const say = (ok, msg) => { lines.push(`  ${ok ? 'ok  ' : 'FAIL'} steps[${k}] ${msg}`); if (!ok) problems.push(`steps[${k}]: ${msg}`); };
      const all = [...allSteps(values, logic, allow)];
      const focus = new Set(focusCells(st));
      if (it && it.tech && t === 'place') {
        const { cell, digit } = e.place;
        const by = all.filter((s) => s.place && s.place.cell === cell && s.place.digit === digit).map((s) => s.tech);
        const easiest = by.sort((a, b) => RANK[a] - RANK[b])[0];
        say(easiest === it.tech, `${digit} in ${nm(cell)}: easiest justification ${easiest}, intended ${it.tech}`);
        const loaded = ctx.loaded === digit;
        const distract = all.filter((s) => RANK[s.tech] < RANK[it.tech] && s.place && s.place.cell !== cell && focus.has(s.place.cell)
          && (loaded ? s.place.digit === digit : s.tech === 'full-house'));
        say(!distract.length, `no simpler ${loaded ? digit + ' placement' : 'full house'} inside the focus${distract.length ? ': ' + distract.map((s) => `${s.tech} ${nm(s.place.cell)}`).join(', ') : ''}`);
      }
      if (it && it.payoff && t === 'place') {
        const { cell, digit } = e.place;
        const plain = [...allSteps(values, computeCands(values), allow)].some((s) => s.place && s.place.cell === cell && s.place.digit === digit);
        say(!plain, `${digit} in ${nm(cell)} needs the eliminations (${plain ? 'already possible without them' : 'only possible after them'})`);
      }
      if (it && it.complete && t === 'notes') {
        const want = digitsOf(computeCands(values)[e.notes.cell]).join(',');
        say(want === e.notes.digits.slice().sort().join(','), `notes in ${nm(e.notes.cell)} = all candidates {${want}}`);
      }
      if (it && it.blocker != null && t === 'tap') {
        const g = e.tap[0], next = script.steps.slice(k + 1).find((s) => s.expect.place);
        const d = next.expect.place.digit, b = it.blocker;
        say(values[g] === d && (rowOf(g) === rowOf(b) || colOf(g) === colOf(b)), `tapped ${nm(g)} is the ${d} that blocks ${nm(b)}`);
      }
      if (it && it.tech && t === 'eliminate') {
        const want = new Set(e.eliminate.map(([c, d]) => c * 10 + d));
        const pattern = prev && expectType(prev) === 'tap' && prev.expect.mode === 'all' ? prev.expect.tap.slice().sort((a, b) => a - b).join(',') : null;
        const s = all.find((x) => x.tech === it.tech && !x.place && [...want].every((w) => x.eliminate.some(([c, d]) => c * 10 + d === w))
          && (!pattern || x.pattern.slice().sort((a, b) => a - b).join(',') === pattern));
        say(!!s, `${it.tech} removes ${e.eliminate.map(([c, d]) => `${d}@${nm(c)}`).join(' ')}${pattern ? ` with the tapped pattern ${pattern}` : ''}${s ? ' (' + s.text + ')' : ''}`);
        const earlier = all.filter((x) => TECH_INFO[x.tech].world < TECH_INFO[it.tech].world && (x.place
          ? e.eliminate.some(([c, d]) => x.place.digit === d && peers[c].includes(x.place.cell))
          : x.eliminate.some(([c, d]) => want.has(c * 10 + d))));
        say(!earlier.length, `needs ${it.tech}${earlier.length ? ': also done by ' + earlier.map((x) => x.tech + (x.place ? ' ' + nm(x.place.cell) : '')).join(', ') : ''}`);
        const loud = [...focus].filter((c) => !values[c] && popcount(logic[c]) === 1);
        const fh = all.filter((x) => x.tech === 'full-house' && focus.has(x.place.cell));
        say(!loud.length && !fh.length, `no single-note cell or full house inside the focus${loud.length || fh.length ? ': ' + [...loud, ...fh.map((x) => x.place.cell)].map(nm).join(', ') : ''}`);
      }
      prev = st;
    },
  });
  if (!v.ok) problems.push(...v.errors);
  if (v.warnings.length) problems.push(...v.warnings.map((w) => 'warning: ' + w));
  return { lines, problems };
}

const only = process.argv.slice(2);
const DIR = path.join(ROOT, 'content/level0');
let failed = 0;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const script = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (only.length && !only.some((o) => script.id.startsWith(o))) continue;
  if (!INTENT[script.id]) { console.log(`skip ${f}: no intent table`); continue; }
  const { lines, problems } = checkScript(script);
  console.log(`${problems.length ? 'FAIL' : 'PASS'} ${f}`);
  lines.forEach((l) => console.log(l));
  problems.filter((p) => !lines.some((l) => l.includes(p))).forEach((p) => console.log('  ' + p));
  if (problems.length) failed++;
}
if (failed) { console.log(`\n${failed} script(s) with problems`); process.exit(1); }
console.log('\nPASS');
