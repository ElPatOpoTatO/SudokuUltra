#!/usr/bin/env node
// validate-puzzles.mjs — independent re-check of data/puzzles.json (+ backlog.json).
//
//   node tools/validate-puzzles.mjs [path/to/puzzles.json]
//
// Re-derives everything from scratch with the solver: uniqueness, solutions,
// world membership (two solves: ALLOW[w] must solve, ALLOW[w-1] must not),
// targetUses, the Use it / Master bars, every Spot it snapshot, Free Mode band
// tags, the daily rhythm, and cross-pool duplicates by canonical form. Then
// runs tools/test-solver.mjs. Exits 1 on any failure.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  solveLogically, countSolutions, findSolution, computeCands, nextStep, parseGrid,
  gridToString, rate, bit, TECH_INFO,
} from '../src/solver.js';
import {
  WORLDS, ALLOW, RULES, BANDS, dailyBand, countSteps, decodeCands, canonical, clueCount, targetUses,
} from './pipeline-common.mjs';

const sameElims = (a, b) => {
  const k = (e) => e.map(([c, d]) => c * 10 + d).sort((x, y) => x - y).join(',');
  return k(a || []) === k(b || []);
};
const samePlace = (a, b) => (!a && !b) || (a && b && a.cell === b.cell && a.digit === b.digit);

/** Validate a parsed puzzles.json object. Returns { errors, warnings, checked }. */
export function validate(data, { backlog = [] } = {}) {
  const errors = [];
  const warnings = [];
  let checked = 0;
  const err = (id, msg) => errors.push(`${id}: ${msg}`);
  const ids = new Set();
  const canon = new Map(); // canonical -> id
  const solutionOf = new Map(); // id -> solution string (for Spot it sources)

  function checkId(id) {
    if (typeof id !== 'string' || !id) return err('?', 'missing id');
    if (ids.has(id)) err(id, 'duplicate id');
    ids.add(id);
  }

  /** Uniqueness + solution; returns the solution string or null. */
  function checkPuzzle(id, givens, solution) {
    checked++;
    if (typeof givens !== 'string' || !/^[0-9]{81}$/.test(givens)) { err(id, 'givens must be 81 digits'); return null; }
    const v = parseGrid(givens);
    const n = countSolutions(v, 2);
    if (n !== 1) { err(id, `has ${n} solutions (need exactly 1)`); return null; }
    const sol = gridToString(findSolution(v));
    if (solution !== undefined && solution !== sol) err(id, 'stored solution does not match findSolution');
    const c = canonical(givens);
    if (canon.has(c)) err(id, `duplicate of ${canon.get(c)} (same canonical form)`);
    else canon.set(c, id);
    return sol;
  }

  /** Stats for world w from the ALLOW[w] solve, plus membership. */
  function worldStats(givens, w) {
    const v = parseGrid(givens);
    const clues = clueCount(givens);
    if (w === 0) {
      const r1 = solveLogically(v, ALLOW[1]);
      const { byWorld, byTech } = countSteps(r1.steps);
      return { member: r1.solved, s: { solved1: r1.solved, world: null, byWorld, byTech, steps: r1.steps.length, clues } };
    }
    const rA = solveLogically(v, ALLOW[w]);
    const rB = solveLogically(v, ALLOW[w - 1]);
    const member = rA.solved && !rB.solved;
    const { byWorld, byTech } = countSteps(rA.steps);
    return { member, s: { solved1: w === 1 && rA.solved, world: member ? w : -1, byWorld, byTech, steps: rA.steps.length, clues } };
  }

  /** Band re-derived with the two-solve rule. */
  function bandOf(givens) {
    const v = parseGrid(givens);
    if (solveLogically(v, ALLOW[1]).solved) return 'gentle';
    for (let w = 2; w <= 4; w++) if (solveLogically(v, ALLOW[w]).solved) return BANDS[w - 1];
    return null;
  }

  if (data.version !== 1) err('file', 'version must be 1');
  if (!Array.isArray(data.worlds) || data.worlds.length !== 5) err('file', 'worlds must have 5 entries');

  // --- Free Mode first (Spot it sources live here) ---------------------------
  for (const band of BANDS) {
    for (const q of data.quick?.[band] ?? []) {
      checkId(q.id);
      const sol = checkPuzzle(q.id, q.givens, q.solution);
      if (!sol) continue;
      solutionOf.set(q.id, { givens: q.givens, solution: sol });
      const b = bandOf(q.givens);
      if (b !== band) err(q.id, `tagged ${band} but re-derived band is ${b}`);
      const r = rate(parseGrid(q.givens));
      if (r.hardest !== q.hardest) err(q.id, `hardest ${q.hardest} != re-derived ${r.hardest}`);
      if (r.steps !== q.steps) err(q.id, `steps ${q.steps} != re-derived ${r.steps}`);
      if (clueCount(q.givens) !== q.clues) err(q.id, 'clue count mismatch');
    }
  }
  (data.daily ?? []).forEach((d, i) => {
    checkId(d.id);
    if (d.id !== `d-${String(i).padStart(4, '0')}`) err(d.id, `daily id does not match its index ${i}`);
    if (d.band !== dailyBand(i)) err(d.id, `band ${d.band} breaks the weekly rhythm (day ${i} should be ${dailyBand(i)})`);
    const sol = checkPuzzle(d.id, d.givens, d.solution);
    if (!sol) return;
    solutionOf.set(d.id, { givens: d.givens, solution: sol });
    const b = bandOf(d.givens);
    if (b !== d.band) err(d.id, `tagged ${d.band} but re-derived band is ${b}`);
  });

  // --- Campaign ---------------------------------------------------------------
  for (const W of data.worlds ?? []) {
    const w = W.world;
    for (const type of ['useIt', 'master']) {
      const rule = RULES[w][type === 'useIt' ? 'use' : 'master'];
      for (const p of W[type] ?? []) {
        checkId(p.id);
        const sol = checkPuzzle(p.id, p.givens, p.solution);
        if (!sol) continue;
        const { member, s } = worldStats(p.givens, w);
        if (!member) err(p.id, w === 0 ? 'not solvable with W0+W1 techniques' : `does not belong to W${w} (needs ALLOW[${w}] and must fail ALLOW[${w - 1}])`);
        const tu = targetUses(w, s);
        if (tu !== p.targetUses) err(p.id, `targetUses ${p.targetUses} != re-derived ${tu}`);
        if (s.steps !== p.steps) err(p.id, `steps ${p.steps} != re-derived ${s.steps}`);
        if (s.clues !== p.clues) err(p.id, 'clue count mismatch');
        if (member && !rule(s)) err(p.id, `fails the ${type} bar`);
      }
    }

    // --- Spot it --------------------------------------------------------------
    for (const sp of W.spotIt ?? []) {
      checkId(sp.id);
      checked++;
      const id = sp.id;
      if (typeof sp.values !== 'string' || !/^[0-9]{81}$/.test(sp.values)) { err(id, 'values must be 81 digits'); continue; }
      const v = parseGrid(sp.values);
      if (w >= 3 && !sp.cands) err(id, 'W3/W4 snapshots must store cands');
      let c;
      try { c = sp.cands ? decodeCands(sp.cands) : computeCands(v); } catch (e) { err(id, e.message); continue; }
      const base = computeCands(v);
      const src = solutionOf.get(sp.source);
      if (!src) { err(id, `source ${sp.source} not found among quick/daily puzzles`); continue; }
      const sol = src.solution;
      if (countSolutions(v, 2) !== 1) err(id, 'snapshot does not have a unique solution');
      for (let i = 0; i < 81; i++) {
        const g = src.givens.charCodeAt(i) - 48;
        const sd = sol.charCodeAt(i) - 48;
        if (g && v[i] !== g) { err(id, `source given at cell ${i} missing`); break; }
        if (v[i] && v[i] !== sd) { err(id, `value at cell ${i} disagrees with source solution`); break; }
        if (!v[i] && (c[i] & ~base[i])) { err(id, `cands at cell ${i} are not a subset of the basic candidates`); break; }
        if (!v[i] && !(c[i] & bit(sd))) { err(id, `cands at cell ${i} lost the solution digit`); break; }
      }
      const st = sp.step;
      if (!st || TECH_INFO[st.tech]?.world !== w) { err(id, `step tech ${st?.tech} is not a W${w} technique`); continue; }
      const got = nextStep(v, c, ALLOW[w]);
      if (!got || got.tech !== st.tech || !samePlace(got.place, st.place) || !sameElims(got.eliminate, st.eliminate)) {
        err(id, `nextStep(ALLOW[${w}]) returns ${got ? got.tech : 'null'}, not the stored step`);
      }
      if (w >= 1) {
        const easier = nextStep(v, c, ALLOW[w - 1]);
        if (easier) err(id, `an easier step (${easier.tech}) is available`);
      }
      if (st.place && sol.charCodeAt(st.place.cell) - 48 !== st.place.digit) err(id, 'placement disagrees with the solution');
      for (const [cell, d] of st.eliminate || []) {
        if (sol.charCodeAt(cell) - 48 === d) err(id, `elimination of ${d} at cell ${cell} removes the solution digit`);
      }
    }
  }

  // --- Backlog ----------------------------------------------------------------
  for (const b of backlog) {
    checkId(b.id);
    const sol = checkPuzzle(b.id, b.givens, b.solution);
    if (!sol) continue;
    if (solveLogically(parseGrid(b.givens)).solved) err(b.id, 'backlog puzzle is solvable with the 8 techniques');
  }

  if (data.solutionsOmitted) warnings.push(`solutions omitted from: ${data.solutionsOmitted.join(', ')}`);
  return { errors, warnings, checked };
}

export function formatValidation(res) {
  const lines = [`validation: ${res.checked} items checked, ${res.errors.length} errors`];
  for (const e of res.errors.slice(0, 40)) lines.push(`  FAIL ${e}`);
  if (res.errors.length > 40) lines.push(`  ... and ${res.errors.length - 40} more`);
  for (const wn of res.warnings) lines.push(`  note: ${wn}`);
  return lines.join('\n');
}

/** Run tools/test-solver.mjs in a child process. */
export function runSolverTests(root) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'test-solver.mjs')], { encoding: 'utf8' });
  return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') };
}

// --- CLI ----------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.resolve(root, process.argv[2] || 'data/puzzles.json');
  const t = Date.now();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const backlogFile = path.join(path.dirname(file), 'backlog.json');
  const backlog = fs.existsSync(backlogFile) ? JSON.parse(fs.readFileSync(backlogFile, 'utf8')).puzzles : [];
  const res = validate(data, { backlog });
  console.log(formatValidation(res));
  // Stock summary (informational; shortfalls are not validation errors).
  const counts = data.worlds.map((W) => `W${W.world} spot ${W.spotIt.length} use ${W.useIt.length} master ${W.master.length}`);
  console.log(`stock: ${counts.join(' | ')}`);
  console.log(`       quick ${BANDS.map((b) => `${b} ${data.quick[b].length}`).join(', ')}; daily ${data.daily.length}; backlog ${backlog.length}`);
  const tests = runSolverTests(root);
  console.log(`solver tests (tools/test-solver.mjs): ${tests.ok ? 'PASS' : 'FAIL'}`);
  if (!tests.ok) console.log(tests.output.split('\n').filter((l) => /FAIL/.test(l)).join('\n'));
  console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  process.exit(res.errors.length || !tests.ok ? 1 : 0);
}
