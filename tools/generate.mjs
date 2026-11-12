#!/usr/bin/env node
// generate.mjs — offline puzzle pipeline for the sudoku learning game.
//
//   node tools/generate.mjs [--seed N] [--out data/puzzles.json] [--quick] [--budget SECONDS]
//
// Builds every puzzle pool the game ships with (campaign Spot it / Use it /
// Master per world, Free Mode Quick Play bands, the Daily list) plus a backlog
// of puzzles that need techniques beyond world 4. Deterministic for a given
// seed (except the generatedAt timestamp, and except if the time budget runs
// out, which is reported). Validates the result before exiting.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  solveLogically, countSolutions, computeCands, nextStep, applyStep, allSteps,
  gridToString, TECH_INFO, boxOf, rowOf,
} from '../src/solver.js';
import { makeRng, shuffle, randomFullGrid } from './puzzle-gen.mjs';
import {
  WORLDS, WORLD_TECHS, ALLOW, RULES, BANDS, BAND_CLUES, DAILY_COUNT, dailyBand,
  bandOfWorld, countSteps, encodeCands, canonical, targetUses,
} from './pipeline-common.mjs';
import { validate, runSolverTests, formatValidation } from './validate-puzzles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opt = { seed: 20261112, out: 'data/puzzles.json', quick: false, budget: 600 };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--seed') opt.seed = Number(argv[++k]);
    else if (a === '--out') opt.out = argv[++k];
    else if (a === '--quick') opt.quick = true;
    else if (a === '--budget') opt.budget = Number(argv[++k]);
    else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/generate.mjs [--seed N] [--out data/puzzles.json] [--quick] [--budget SECONDS]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isFinite(opt.seed)) throw new Error('--seed must be a number');
  return opt;
}

const opt = parseArgs(process.argv.slice(2));
const outPath = path.resolve(ROOT, opt.out);
const outDir = path.dirname(outPath);
const T = opt.quick
  ? { spot: 3, use: 3, master: 1, quick: 15, daily: 40, backlog: 30 }
  : { spot: 12, use: 12, master: 4, quick: 150, daily: DAILY_COUNT, backlog: 300 };
const BUDGET_MS = opt.budget * 1000;
const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const rng = makeRng(opt.seed);

// ---------------------------------------------------------------------------
// Candidate generation: symmetric clue removal with an optional early stop
// ---------------------------------------------------------------------------

const ORBITS = {
  central: (() => { const o = []; for (let i = 0; i <= 40; i++) o.push(i === 40 ? [40] : [i, 80 - i]); return o; })(),
  diagonal: (() => { const o = []; for (let r = 0; r < 9; r++) for (let c = r; c < 9; c++) o.push(r === c ? [r * 9 + c] : [r * 9 + c, c * 9 + r]); return o; })(),
  mirror: (() => { const o = []; for (let r = 0; r < 9; r++) for (let c = 0; c <= 4; c++) o.push(c === 4 ? [r * 9 + 4] : [r * 9 + c, r * 9 + 8 - c]); return o; })(),
  none: [...Array(81).keys()].map((i) => [i]),
};
const SYMS = ['central', 'central', 'diagonal', 'mirror', 'none'];

/**
 * Recipes say how far to carve. `stop` = [lo, hi]: pick a target clue count in
 * that range and stop removing once the puzzle has that many clues or fewer
 * (0 = go minimal). Removal only happens while the solution stays unique.
 */
const RECIPES = {
  nearfull: { stop: [56, 71] },
  c36_40: { stop: [36, 40] },
  c38_46: { stop: [38, 46] },
  c30_36: { stop: [30, 36] },
  c27_32: { stop: [27, 32] },
  minimal: { stop: [0, 0] },
};

function carve(solution, sym, stopAt) {
  const p = Int8Array.from(solution);
  let clues = 81;
  for (const orbit of shuffle(ORBITS[sym].slice(), rng)) {
    if (clues <= stopAt) break;
    for (const i of orbit) p[i] = 0;
    if (countSolutions(p, 2) === 1) clues -= orbit.length;
    else for (const i of orbit) p[i] = solution[i];
  }
  return { p, clues };
}

// One full grid is reused for GRID_REUSE different hole patterns.
const GRID_REUSE = 6;
let gridUses = GRID_REUSE;
let grid = null;
let generated = 0;

function makeCandidate(recipeName) {
  if (gridUses >= GRID_REUSE) {
    grid = randomFullGrid(rng);
    gridUses = 0;
  }
  gridUses++;
  generated++;
  const [lo, hi] = RECIPES[recipeName].stop;
  const stopAt = lo + Math.floor(rng() * (hi - lo + 1));
  const sym = SYMS[Math.floor(rng() * SYMS.length)];
  const { p, clues } = carve(grid, sym, stopAt);
  return { p, clues, solution: grid, sym };
}

// ---------------------------------------------------------------------------
// Classification. Because ALLOW[w] is always a prefix of the solver's
// technique order and the solver always takes the easiest step, the ALLOW[w]
// solve is exactly the prefix of the full solve up to the first step from a
// world above w. So one full solve classifies a puzzle: it belongs to the
// world of its hardest step (if solved). The validator re-derives membership
// the slow way (two solves) as an independent check.
// ---------------------------------------------------------------------------

function analyze(p, clues) {
  const r = solveLogically(p);
  const { byWorld, byTech } = countSteps(r.steps);
  let world = null;
  if (r.solved) {
    world = 0;
    for (const s of r.steps) world = Math.max(world, TECH_INFO[s.tech].world);
  }
  return {
    solved: r.solved, world, solved1: r.solved && world <= 1,
    byWorld, byTech, steps: r.steps.length, clues, stepList: r.steps, endValues: r.values,
  };
}

// ---------------------------------------------------------------------------
// Pools (priority order = array order: campaign first, then quick, daily, backlog)
// ---------------------------------------------------------------------------

const pools = [];
function addPool(def) {
  pools.push({ items: [], offered: 0, filledAt: null, ...def });
}

const CAMPAIGN_RECIPE = {
  0: { use: 'nearfull', master: 'c36_40' },
  1: { use: 'c38_46', master: 'minimal' },
  2: { use: 'c27_32', master: 'minimal' },
  3: { use: 'minimal', master: 'minimal' },
  4: { use: 'minimal', master: 'minimal' },
};
for (const w of WORLDS) {
  // master before use: masters are rarer and a 3-use puzzle can satisfy both.
  for (const type of ['master', 'use']) {
    addPool({
      key: `w${w}-${type}`, kind: 'campaign', world: w, type,
      need: type === 'use' ? T.use : T.master,
      recipe: CAMPAIGN_RECIPE[w][type],
      accept: RULES[w][type],
    });
  }
}
const BAND_RECIPE = { gentle: 'c30_36', easy: 'minimal', medium: 'minimal', tricky: 'minimal' };
const bandAccept = (band) => (s) => bandOfWorld(s.world) === band && s.clues >= BAND_CLUES[band][0] && s.clues <= BAND_CLUES[band][1];
for (const band of BANDS) {
  addPool({ key: `quick-${band}`, kind: 'quick', band, need: T.quick, recipe: BAND_RECIPE[band], accept: bandAccept(band) });
}
const dailyNeed = Object.fromEntries(BANDS.map((b) => [b, 0]));
for (let i = 0; i < T.daily; i++) dailyNeed[dailyBand(i)]++;
for (const band of BANDS) {
  addPool({ key: `daily-${band}`, kind: 'daily', band, need: dailyNeed[band], recipe: BAND_RECIPE[band], accept: bandAccept(band) });
}
addPool({ key: 'backlog', kind: 'backlog', need: T.backlog, recipe: null, accept: (s) => !s.solved });

const seen = new Set(); // canonical forms of every accepted puzzle
const open = (pl) => pl.items.length < pl.need;

// ---------------------------------------------------------------------------
// Main generation loop
// ---------------------------------------------------------------------------

console.log(`sudoku pipeline: seed=${opt.seed} mode=${opt.quick ? 'quick' : 'full'} budget=${opt.budget}s`);
let budgetHit = false;
let rr = 0;
let lastLog = Date.now();
let dupes = 0;

function logProgress(force = false) {
  if (!force && Date.now() - lastLog < 3000) return;
  lastLog = Date.now();
  const parts = pools.filter((pl) => pl.kind !== 'backlog')
    .map((pl) => `${pl.key} ${pl.items.length}/${pl.need}`);
  console.log(`  [${elapsed()}] candidates=${generated} | ${parts.join('  ')} | backlog ${pools.at(-1).items.length}`);
}

for (;;) {
  const active = pools.filter((pl) => pl.recipe && open(pl));
  if (!active.length) break;
  if (Date.now() - t0 > BUDGET_MS) { budgetHit = true; break; }
  const target = active[rr++ % active.length];
  const cand = makeCandidate(target.recipe);
  const info = analyze(cand.p, cand.clues);
  let canon = null;
  for (const pl of pools) {
    if (!open(pl)) continue;
    pl.offered++;
    if (!pl.accept(info)) continue;
    canon ??= canonical(cand.p);
    if (seen.has(canon)) { dupes++; break; }
    seen.add(canon);
    pl.items.push({ givens: gridToString(cand.p), solution: gridToString(cand.solution), info, sym: cand.sym });
    if (!open(pl)) {
      pl.filledAt = Date.now() - t0;
      console.log(`  [${elapsed()}] filled ${pl.key} ${pl.items.length}/${pl.need} after ${pl.offered} candidates offered`);
    }
    break;
  }
  logProgress();
}
logProgress(true);
const genMs = Date.now() - t0;
if (budgetHit) console.log(`  !! time budget of ${opt.budget}s reached; writing what we have`);

const pool = (key) => pools.find((pl) => pl.key === key);

// ---------------------------------------------------------------------------
// Build exported items
// ---------------------------------------------------------------------------

const pad = (n, w) => String(n).padStart(w, '0');

function campaignItem(w, type, it, k) {
  const s = it.info;
  return {
    id: `w${w}-${type}-${pad(k + 1, 2)}`,
    givens: it.givens,
    solution: it.solution,
    targetUses: targetUses(w, s),
    steps: s.steps,
    clues: s.clues,
    counts: s.byTech,
  };
}

function hardestOf(s) {
  let h = null;
  for (const st of s.stepList) if (h === null || TECH_ORDER[st.tech] > TECH_ORDER[h]) h = st.tech;
  return h;
}
const TECH_ORDER = Object.fromEntries(Object.keys(TECH_INFO).map((t, k) => [t, k]));

const worldsOut = WORLDS.map((w) => ({
  world: w,
  spotIt: [],
  useIt: pool(`w${w}-use`).items.map((it, k) => campaignItem(w, 'use', it, k)),
  master: pool(`w${w}-master`).items.map((it, k) => campaignItem(w, 'master', it, k)),
}));

const quickOut = {};
for (const band of BANDS) {
  quickOut[band] = pool(`quick-${band}`).items.map((it, k) => ({
    id: `q-${band}-${pad(k + 1, 3)}`,
    givens: it.givens,
    solution: it.solution,
    hardest: hardestOf(it.info),
    steps: it.info.steps,
    clues: it.info.clues,
  }));
}

// Daily: walk the weekly rhythm, taking the next puzzle of the day's band.
const dailyOut = [];
{
  const cursor = Object.fromEntries(BANDS.map((b) => [b, 0]));
  for (let i = 0; i < T.daily; i++) {
    const band = dailyBand(i);
    const it = pool(`daily-${band}`).items[cursor[band]++];
    if (!it) continue; // shortfall: reported below
    dailyOut.push({ id: `d-${pad(i, 4)}`, givens: it.givens, solution: it.solution, band });
  }
}

const backlogOut = pool('backlog').items.map((it, k) => {
  const s = it.info;
  const v = Int8Array.from(s.endValues);
  const c = computeCandsAfter(it.givens, s.stepList);
  const last = s.stepList.at(-1);
  return {
    id: `b-${pad(k + 1, 3)}`,
    givens: it.givens,
    solution: it.solution,
    clues: s.clues,
    stuck: {
      values: gridToString(v),
      cands: encodeCands(c),
      filled: v.reduce((n, d) => n + (d ? 1 : 0), 0),
      stepsBeforeStuck: s.steps,
      lastTech: last ? last.tech : null,
      hardestUsed: hardestOf(s),
    },
  };
});

/** Replay a step list from the givens and return the candidate state at the end. */
function computeCandsAfter(givens, steps) {
  const v = Int8Array.from(givens, (ch) => ch.charCodeAt(0) - 48);
  const c = computeCands(v);
  for (const st of steps) applyStep(v, c, st);
  return c;
}

// ---------------------------------------------------------------------------
// Spot it: snapshots right before a world-w step in the ALLOW[w] replay.
// Because the solver takes the easiest step, every world-w step it picks in
// the ALLOW[w] replay is a moment where no earlier-world step exists, and
// nextStep(values, cands, ALLOW[w]) returns exactly that step.
// Sources: Quick Play and Daily puzzles of the matching band (not campaign
// puzzles, so a Spot it never spoils a Use it / Master puzzle).
// ---------------------------------------------------------------------------

const quickDailySources = [...BANDS.flatMap((b) => quickOut[b].map((q) => ({ id: q.id, givens: q.givens, band: b }))),
  ...dailyOut.map((d) => ({ id: d.id, givens: d.givens, band: d.band }))];
const SPOT_BANDS = { 0: ['gentle'], 1: ['gentle'], 2: ['easy'], 3: ['medium', 'tricky'], 4: ['tricky'] };

/** Fine-grained flavour of a step, used to balance the selection. */
function flavour(step) {
  switch (step.tech) {
    case 'pointing': {
      const p = step.pattern;
      return `pointing-${p.every((i) => rowOf(i) === rowOf(p[0])) ? 'row' : 'col'}`;
    }
    case 'naked-single': return 'naked-single';
    default: return `${step.tech}-${step.unit.type}`;
  }
}

function collectSnapshots(w) {
  const bands = SPOT_BANDS[w];
  const out = [];
  // W0 snapshots come from the ALLOW[1] replay (a full-house-only replay of a
  // real puzzle stalls at once); nextStep(..., ALLOW[0]) still returns them.
  const replaySet = ALLOW[w === 0 ? 1 : w];
  const targetSet = new Set(WORLD_TECHS[w]);
  for (const src of quickDailySources) {
    if (!bands.includes(src.band)) continue;
    const v = Int8Array.from(src.givens, (ch) => ch.charCodeAt(0) - 48);
    const c = computeCands(v);
    for (let guard = 0; guard < 810; guard++) {
      const step = nextStep(v, c, replaySet);
      if (!step) break;
      if (targetSet.has(step.tech)) {
        const empties = v.reduce((n, d) => n + (d ? 0 : 1), 0);
        let alts = 0;
        for (const _ of allSteps(v, c, WORLD_TECHS[w])) if (++alts > 5) break;
        out.push({ source: src.id, values: gridToString(v), cands: w >= 3 ? encodeCands(c) : undefined, step, empties, alts });
      }
      applyStep(v, c, step);
    }
  }
  return out;
}

function pickVariety(cands, n, w) {
  const chosen = [];
  const usedSrc = new Set();
  const cnt = (key) => chosen.filter(key).length;
  const flavours = [...new Set(cands.map((s) => flavour(s.step)))];
  const techs = WORLD_TECHS[w];
  // Empty-cell sweet spot: enough empties that the move is not obvious.
  const idealEmpty = w === 0 ? 20 : 40;
  while (chosen.length < n) {
    let best = null;
    let bestScore = -Infinity;
    for (const s of cands) {
      if (usedSrc.has(s.source)) continue;
      const st = s.step;
      const cell = st.place ? st.place.cell : st.pattern[0];
      let score = 0;
      score -= 12 * (Math.min(s.alts, 5) - 1); // prefer one clear answer
      score -= Math.abs(s.empties - idealEmpty) / 4;
      // Balance techniques (pointing vs claiming, naked vs hidden pair...).
      const techShare = cnt((c) => c.step.tech === st.tech) - chosen.length / techs.length;
      score -= 25 * Math.max(0, techShare + 0.5);
      if (flavours.length > 1) score -= 6 * cnt((c) => flavour(c.step) === flavour(st));
      score -= 5 * cnt((c) => c.step.digits[0] === st.digits[0]);
      score -= 4 * cnt((c) => {
        const cc = c.step.place ? c.step.place.cell : c.step.pattern[0];
        return boxOf(cc) === boxOf(cell);
      });
      if (st.unit) score -= 3 * cnt((c) => c.step.unit && c.step.unit.type === st.unit.type && c.step.unit.index === st.unit.index);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (!best) break;
    chosen.push(best);
    usedSrc.add(best.source);
  }
  return chosen;
}

const spotStats = {};
for (const w of WORLDS) {
  const snaps = collectSnapshots(w);
  const picked = pickVariety(snaps, T.spot, w);
  spotStats[w] = { snapshots: snaps.length, picked: picked.length };
  worldsOut[w].spotIt = picked.map((s, k) => {
    const item = { id: `w${w}-spot-${pad(k + 1, 2)}`, values: s.values };
    if (s.cands) item.cands = s.cands;
    item.step = s.step;
    item.source = s.source;
    item.alts = Math.min(s.alts, 5);
    return item;
  });
}

// ---------------------------------------------------------------------------
// Assemble, size check, write
// ---------------------------------------------------------------------------

const data = {
  version: 1,
  seed: opt.seed,
  generatedAt: new Date().toISOString(),
  worlds: worldsOut,
  quick: quickOut,
  daily: dailyOut,
};
let json = JSON.stringify(data);
const SIZE_LIMIT = 400 * 1024;
if (Buffer.byteLength(json) > SIZE_LIMIT) {
  for (const band of BANDS) for (const q of data.quick[band]) delete q.solution;
  for (const d of data.daily) delete d.solution;
  data.solutionsOmitted = ['quick', 'daily'];
  json = JSON.stringify(data);
  console.log('  puzzles.json was over 400 KB: dropped `solution` from quick and daily (game uses findSolution)');
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, json);
const backlogPath = path.join(outDir, 'backlog.json');
fs.writeFileSync(backlogPath, JSON.stringify({ version: 1, seed: opt.seed, puzzles: backlogOut }));
const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
const backlogKB = (fs.statSync(backlogPath).size / 1024).toFixed(1);

// ---------------------------------------------------------------------------
// Validate (same checks as tools/validate-puzzles.mjs)
// ---------------------------------------------------------------------------

console.log(`\nvalidating...`);
const tv = Date.now();
const vres = validate(data, { backlog: backlogOut });
const tests = runSolverTests(ROOT);
const valMs = Date.now() - tv;
console.log(formatValidation(vres));
console.log(`solver tests: ${tests.ok ? 'PASS' : 'FAIL'}`);

// ---------------------------------------------------------------------------
// Stats summary + report
// ---------------------------------------------------------------------------

const totalMs = Date.now() - t0;
const rows = [];
for (const w of WORLDS) {
  rows.push({ pool: `W${w} Spot it`, found: worldsOut[w].spotIt.length, need: T.spot, offered: spotStats[w].snapshots, note: 'snapshots considered' });
  for (const type of ['use', 'master']) {
    const pl = pool(`w${w}-${type}`);
    rows.push({ pool: `W${w} ${type === 'use' ? 'Use it' : 'Master'}`, found: pl.items.length, need: pl.need, offered: pl.offered, clues: pl.items.map((x) => x.info.clues) });
  }
}
for (const band of BANDS) {
  const pl = pool(`quick-${band}`);
  rows.push({ pool: `Quick ${band}`, found: pl.items.length, need: pl.need, offered: pl.offered, clues: pl.items.map((x) => x.info.clues) });
}
for (const band of BANDS) {
  const pl = pool(`daily-${band}`);
  rows.push({ pool: `Daily ${band}`, found: pl.items.length, need: pl.need, offered: pl.offered, clues: pl.items.map((x) => x.info.clues) });
}
{
  const pl = pool('backlog');
  rows.push({ pool: 'Backlog (> W4)', found: pl.items.length, need: pl.need, offered: pl.offered, clues: pl.items.map((x) => x.info.clues), note: 'cap, not a target' });
}

const range = (a) => (a && a.length ? `${Math.min(...a)}-${Math.max(...a)}` : '-');
const perAccepted = (r) => (r.clues && r.found ? (r.offered / r.found).toFixed(1) : '-');
const shortfalls = rows.filter((r) => r.found < r.need && !r.pool.startsWith('Backlog'));

console.log('\n=== stock ===');
console.log('pool                 found/need   offered  per-accepted  clues');
for (const r of rows) {
  console.log(`${r.pool.padEnd(20)} ${`${r.found}/${r.need}`.padStart(9)}  ${String(r.offered).padStart(8)}  ${perAccepted(r).padStart(12)}  ${r.clues ? range(r.clues) : r.note}`);
}
console.log(`\ncandidates generated: ${generated}, duplicates rejected: ${dupes}`);
console.log(`generation ${(genMs / 1000).toFixed(1)}s, validation ${(valMs / 1000).toFixed(1)}s, total ${(totalMs / 1000).toFixed(1)}s`);
console.log(`${path.relative(ROOT, outPath)}: ${sizeKB} KB; backlog.json: ${backlogKB} KB`);
if (shortfalls.length) console.log(`SHORTFALLS: ${shortfalls.map((r) => `${r.pool} ${r.found}/${r.need}`).join(', ')}`);

const md = [];
md.push('# Puzzle pipeline report', '');
md.push(`- Seed: \`${opt.seed}\`  mode: ${opt.quick ? 'quick' : 'full'}`);
md.push(`- Generated: ${data.generatedAt}`);
md.push(`- Candidates generated: ${generated} (duplicates rejected by canonical form: ${dupes})`);
md.push(`- Time: generation ${(genMs / 1000).toFixed(1)} s, validation ${(valMs / 1000).toFixed(1)} s, total ${(totalMs / 1000).toFixed(1)} s${budgetHit ? ' — **time budget reached**' : ''}`);
md.push(`- Output: \`${path.relative(ROOT, outPath)}\` ${sizeKB} KB${data.solutionsOmitted ? ' (solutions omitted from quick/daily)' : ''}; \`data/backlog.json\` ${backlogKB} KB`);
md.push(`- Validation: ${vres.errors.length ? `**${vres.errors.length} errors**` : 'all checks passed'} (${vres.checked} items); solver tests ${tests.ok ? 'pass' : '**fail**'}`);
md.push('');
md.push('## Stock', '');
md.push('"Offered" = candidates evaluated against the pool while it was still open (every candidate is offered to all open pools in priority order: campaign, quick, daily, backlog). "Per accepted" = offered / found.', '');
md.push('| Pool | Found / needed | Offered | Per accepted | Clues |');
md.push('|---|---|---|---|---|');
for (const r of rows) md.push(`| ${r.pool} | ${r.found} / ${r.need} | ${r.offered} | ${perAccepted(r)} | ${r.clues ? range(r.clues) : r.note} |`);
md.push('');
md.push('## Rules used', '');
for (const w of WORLDS) md.push(`- W${w} Use it: ${RULES[w].useText}. Master: ${RULES[w].masterText}.`);
md.push(`- Quick/Daily bands: gentle = belongs to W0/W1 (${BAND_CLUES.gentle.join('-')} clues), easy = W2, medium = W3, tricky = W4.`);
md.push(`- Daily rhythm (day 0 = Monday): Mon gentle, Tue-Wed easy, Thu-Fri medium, Sat-Sun tricky.`);
md.push('');
md.push('## Spot it', '');
for (const w of WORLDS) {
  const fl = {};
  for (const s of worldsOut[w].spotIt) fl[flavour(s.step)] = (fl[flavour(s.step)] || 0) + 1;
  md.push(`- W${w}: ${worldsOut[w].spotIt.length}/${T.spot} from ${spotStats[w].snapshots} snapshots — ${Object.entries(fl).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
md.push('');
md.push('## Shortfalls', '');
md.push(shortfalls.length ? shortfalls.map((r) => `- ${r.pool}: ${r.found}/${r.need}`).join('\n') : 'None.');
if (vres.errors.length) {
  md.push('', '## Validation errors', '');
  for (const e of vres.errors.slice(0, 50)) md.push(`- ${e}`);
}
md.push('');
fs.writeFileSync(path.join(outDir, 'pipeline-report.md'), md.join('\n'));
console.log(`report: ${path.relative(ROOT, path.join(outDir, 'pipeline-report.md'))}`);

if (vres.errors.length || !tests.ok) process.exit(1);
