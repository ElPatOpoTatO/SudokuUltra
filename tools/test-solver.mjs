// test-solver.mjs — tests for src/solver.js.
// Run from /home/claude/sudoku/game:   node tools/test-solver.mjs
// Prints PASS/FAIL per test, a summary, design stats; exits 1 on any failure.

import {
  ROWS, COLS, BOXES, units, peers, TECHNIQUES, TECH_INFO,
  computeCands, nextStep, allSteps, applyStep, solveLogically, rate,
  countSolutions, findSolution, isValidGrid, findConflicts, isDeadEnd,
  checkClaim, parseGrid, gridToString, bit,
} from '../src/solver.js';
import { generatePuzzle, makeRng } from './puzzle-gen.mjs';

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${e && e.message}`);
  }
}
function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

// ---------------------------------------------------------------------------
// Position builders
// ---------------------------------------------------------------------------

/** Empty board where every cell still has all 9 candidates. */
function blank() {
  return { values: new Int8Array(81), cands: new Uint16Array(81).fill(0x1ff) };
}
/** Remove digits from cells' candidates. */
function clear(cands, cells, digits) {
  for (const c of cells) for (const d of digits) cands[c] &= ~bit(d);
}
/** Keep only `digits` as candidates in cells. */
function only(cands, cells, digits) {
  const m = digits.reduce((a, d) => a | bit(d), 0);
  for (const c of cells) cands[c] = m;
}
/** Board from values with computed candidates. */
function fromValues(values) {
  const v = Int8Array.from(values);
  return { values: v, cands: computeCands(v) };
}
const except = (cells, ...skip) => cells.filter((c) => !skip.includes(c));
const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);

/** Run nextStep and assert it does not mutate inputs. */
function step(pos, allowed) {
  const v0 = Array.from(pos.values);
  const c0 = Array.from(pos.cands);
  const s = nextStep(pos.values, pos.cands, allowed);
  eq(Array.from(pos.values), v0, 'nextStep mutated values:');
  eq(Array.from(pos.cands), c0, 'nextStep mutated cands:');
  if (s) eq(JSON.parse(JSON.stringify(s)), s, 'step not JSON-serializable:');
  return s;
}

// A known valid solution grid (solution of the classic easy puzzle).
const EASY = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const EASY_SOL = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const SOL = parseGrid(EASY_SOL);

// ===========================================================================
// Geometry
// ===========================================================================

test('geometry: 27 units of 9, 20 peers each', () => {
  eq(units.length, 27);
  assert(units.every((u) => u.length === 9));
  assert(peers.every((p) => p.length === 20));
  eq(ROWS[3], [27, 28, 29, 30, 31, 32, 33, 34, 35]);
  eq(COLS[2], [2, 11, 20, 29, 38, 47, 56, 65, 74]);
  eq(BOXES[4], [30, 31, 32, 39, 40, 41, 48, 49, 50]);
  eq(TECHNIQUES.length, 8);
  eq(TECHNIQUES.map((t) => TECH_INFO[t].world), [0, 1, 1, 2, 3, 3, 4, 4]);
});

test('computeCands: basic peer elimination', () => {
  const v = parseGrid(EASY);
  const c = computeCands(v);
  eq(c[0], 0, 'filled cell');
  // r1c3: row 1 has 5,3,7; col 3 has 8; box 1 has 5,3,6,9,8 -> {1,2,4}
  eq(c[2], bit(1) | bit(2) | bit(4));
});

// ===========================================================================
// 1. Full house
// ===========================================================================

test('full-house fires: last empty cell of a row', () => {
  const v = Int8Array.from(SOL);
  v[0] = 0;
  const s = step(fromValues(v));
  eq(s.tech, 'full-house');
  eq(s.unit, { type: 'row', index: 0 });
  eq(s.place, { cell: 0, digit: SOL[0] });
});

test('full-house fires: last empty cell of a box (rows/cols have 2 empties)', () => {
  const v = Int8Array.from(SOL);
  for (const c of [0, 3, 27, 30]) v[c] = 0; // r1c1, r1c4, r4c1, r4c4
  const s = step(fromValues(v));
  eq(s.tech, 'full-house');
  eq(s.unit, { type: 'box', index: 0 });
  eq(s.place, { cell: 0, digit: SOL[0] });
});

test('full-house does NOT fire: every unit has 0 or 2+ empties', () => {
  const v = Int8Array.from(SOL);
  for (const c of [0, 1, 9, 10]) v[c] = 0;
  eq(step(fromValues(v), ['full-house']), null);
  // ...but other techniques still find something
  assert(step(fromValues(v)) !== null);
});

// ===========================================================================
// 2. Hidden single in a box
// ===========================================================================

test('hidden-single-box fires: candidates set directly', () => {
  const p = blank();
  clear(p.cands, except(BOXES[4], 40), [3]);
  const s = step(p);
  eq(s.tech, 'hidden-single-box');
  eq(s.unit, { type: 'box', index: 4 });
  eq(s.place, { cell: 40, digit: 3 });
});

test('hidden-single-box fires: cross-hatching from placed 7s', () => {
  const v = new Int8Array(81);
  v[3] = 7; // r1c4 blocks row 1
  v[16] = 7; // r2c7 blocks row 2
  v[28] = 7; // r4c2 blocks column 2
  v[56] = 7; // r7c3 blocks column 3
  const s = step(fromValues(v));
  eq(s.tech, 'hidden-single-box');
  eq(s.place, { cell: 18, digit: 7 }); // r3c1
  assert(s.text.includes('already sees a 7'), s.text);
});

test('hidden-single-box does NOT fire when the single is only in a row', () => {
  const p = blank();
  clear(p.cands, except(ROWS[4], 40), [3]); // 3 only at r5c5 within row 5
  eq(step(p, ['hidden-single-box']), null);
});

// ===========================================================================
// 3. Hidden single in a row / column
// ===========================================================================

test('hidden-single-line fires: row', () => {
  const p = blank();
  clear(p.cands, except(ROWS[4], 40), [3]);
  const s = step(p);
  eq(s.tech, 'hidden-single-line');
  eq(s.unit, { type: 'row', index: 4 });
  eq(s.place, { cell: 40, digit: 3 });
});

test('hidden-single-line fires: column', () => {
  const p = blank();
  clear(p.cands, except(COLS[2], 65), [6]); // 6 only at r8c3 within column 3
  const s = step(p);
  eq(s.tech, 'hidden-single-line');
  eq(s.unit, { type: 'col', index: 2 });
  eq(s.place, { cell: 65, digit: 6 });
});

test('hidden-single-line does NOT fire when the single is only in a box', () => {
  const p = blank();
  clear(p.cands, except(BOXES[4], 40), [3]);
  eq(step(p, ['hidden-single-line']), null);
});

// ===========================================================================
// 4. Naked single
// ===========================================================================

test('naked-single fires: candidates set directly', () => {
  const p = blank();
  only(p.cands, [10], [5]);
  const s = step(p);
  eq(s.tech, 'naked-single');
  eq(s.place, { cell: 10, digit: 5 });
  eq(s.unit, null);
});

test('naked-single fires: peers use up 8 digits', () => {
  const v = new Int8Array(81);
  v[36] = 1; v[37] = 2; v[38] = 3; // row 5: 1 2 3
  v[4] = 4; v[13] = 5; v[22] = 6; // column 5: 4 5 6
  v[30] = 7; v[50] = 8; // box 5: 7 8
  const s = step(fromValues(v));
  eq(s.tech, 'naked-single');
  eq(s.place, { cell: 40, digit: 9 });
  assert(s.text.includes('already appears'), s.text);
});

test('naked-single does NOT fire on a fresh board', () => {
  eq(step(blank(), ['naked-single']), null);
});

// ===========================================================================
// 5. Pointing
// ===========================================================================

test('pointing fires: box 1, digit 5 locked in row 1', () => {
  const p = blank();
  clear(p.cands, except(BOXES[0], 0, 1), [5]);
  const s = step(p);
  eq(s.tech, 'pointing');
  eq(s.unit, { type: 'box', index: 0 });
  eq(s.pattern, [0, 1]);
  eq(s.digits, [5]);
  eq(s.place, null);
  eq(s.eliminate, range(3, 9).map((c) => [c, 5]));
});

test('pointing fires: box 9, digit 2 locked in column 9', () => {
  const p = blank();
  clear(p.cands, except(BOXES[8], 62, 80), [2]);
  const s = step(p);
  eq(s.tech, 'pointing');
  eq(s.unit, { type: 'box', index: 8 });
  eq(s.eliminate, [8, 17, 26, 35, 44, 53].map((c) => [c, 2]));
});

test('pointing does NOT fire when nothing is left to eliminate', () => {
  const p = blank();
  clear(p.cands, except(BOXES[0], 0, 1), [5]);
  clear(p.cands, range(3, 9), [5]);
  eq(step(p, ['pointing']), null);
  eq(step(p), null);
});

// ===========================================================================
// 6. Claiming
// ===========================================================================

test('claiming fires: row 1, digit 5 locked in box 1', () => {
  const p = blank();
  clear(p.cands, range(3, 9), [5]);
  const s = step(p);
  eq(s.tech, 'claiming');
  eq(s.unit, { type: 'row', index: 0 });
  eq(s.pattern, [0, 1, 2]);
  eq(s.eliminate, [9, 10, 11, 18, 19, 20].map((c) => [c, 5]));
});

test('claiming fires: column 5, digit 8 locked in box 5', () => {
  const p = blank();
  clear(p.cands, except(COLS[4], 31, 49), [8]);
  const s = step(p);
  eq(s.tech, 'claiming');
  eq(s.unit, { type: 'col', index: 4 });
  eq(s.pattern, [31, 49]);
  eq(s.eliminate, [30, 32, 39, 41, 48, 50].map((c) => [c, 8]));
});

test('claiming does NOT fire when the box is already clean', () => {
  const p = blank();
  clear(p.cands, range(3, 9), [5]);
  clear(p.cands, [9, 10, 11, 18, 19, 20], [5]);
  eq(step(p, ['claiming']), null);
  eq(step(p), null);
});

// ===========================================================================
// 7. Naked pair
// ===========================================================================

test('naked-pair fires: r4c4 + r4c8 on {2,7} in row 4', () => {
  const p = blank();
  only(p.cands, [30, 34], [2, 7]);
  const s = step(p);
  eq(s.tech, 'naked-pair');
  eq(s.unit, { type: 'row', index: 3 });
  eq(s.pattern, [30, 34]);
  eq(s.digits, [2, 7]);
  eq(s.eliminate, [27, 28, 29, 31, 32, 33, 35].flatMap((c) => [[c, 2], [c, 7]]));
  eq(s.text, 'r4c4 and r4c8 can only be 2 or 7, so no other cell in row 4 can be 2 or 7.');
});

test('naked-pair fires: pair shares row AND box -> eliminates in both', () => {
  const p = blank();
  only(p.cands, [0, 1], [4, 9]);
  const s = step(p);
  eq(s.tech, 'naked-pair');
  eq(s.unit, { type: 'row', index: 0 });
  const cells = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20];
  eq(s.eliminate, cells.flatMap((c) => [[c, 4], [c, 9]]));
  assert(s.text.includes('row 1 or box 1'), s.text);
});

test('naked-pair does NOT fire when the unit is already clean', () => {
  const p = blank();
  only(p.cands, [30, 34], [2, 7]);
  clear(p.cands, [27, 28, 29, 31, 32, 33, 35], [2, 7]);
  eq(step(p, ['naked-pair']), null);
  eq(step(p), null);
});

// ===========================================================================
// 8. Hidden pair
// ===========================================================================

test('hidden-pair fires: row 3, digits 4 and 8 only in r3c2, r3c8', () => {
  const p = blank();
  clear(p.cands, except(ROWS[2], 19, 25), [4, 8]);
  const s = step(p);
  eq(s.tech, 'hidden-pair');
  eq(s.unit, { type: 'row', index: 2 });
  eq(s.pattern, [19, 25]);
  eq(s.digits, [4, 8]);
  const others = [1, 2, 3, 5, 6, 7, 9];
  eq(s.eliminate, [19, 25].flatMap((c) => others.map((d) => [c, d])));
});

test('hidden-pair fires: box 5, digits 1 and 6 in diagonal cells', () => {
  const p = blank();
  clear(p.cands, except(BOXES[4], 30, 50), [1, 6]);
  const s = step(p);
  eq(s.tech, 'hidden-pair');
  eq(s.unit, { type: 'box', index: 4 });
  eq(s.pattern, [30, 50]);
  eq(s.eliminate.length, 14);
});

test('hidden-pair does NOT fire when the cells hold only the pair', () => {
  const p = blank();
  clear(p.cands, except(ROWS[2], 19, 25), [4, 8]);
  only(p.cands, [19, 25], [4, 8]);
  eq(step(p, ['hidden-pair']), null);
  eq(step(p), null);
});

// ===========================================================================
// Easiest-first ordering and singles after eliminations
// ===========================================================================

test('order: hidden single (box) beats naked single', () => {
  const p = blank();
  only(p.cands, [10], [5]);
  clear(p.cands, except(BOXES[4], 40), [3]);
  eq(step(p).tech, 'hidden-single-box');
});

test('order: naked single beats naked pair', () => {
  const p = blank();
  only(p.cands, [30, 34], [2, 7]);
  only(p.cands, [70], [9]);
  eq(step(p).tech, 'naked-single');
});

test('order: pointing beats naked pair; allowed set filters', () => {
  const p = blank();
  only(p.cands, [30, 34], [2, 7]);
  clear(p.cands, except(BOXES[8], 62, 80), [2]);
  eq(step(p).tech, 'pointing');
  eq(step(p, ['naked-pair']).tech, 'naked-pair');
  eq(step(p, new Set(['claiming'])), null);
});

test('order: full house beats hidden single', () => {
  const v = parseGrid(EASY);
  const sol = parseGrid(EASY_SOL);
  for (let i = 0; i < 81; i++) if (i % 9 !== 8) v[i] = sol[i]; // only column 9 left (rows each 1 empty)
  eq(step(fromValues(v)).tech, 'full-house');
});

test('naked single appears after a pair elimination', () => {
  const p = blank();
  only(p.cands, [30, 34], [2, 7]);
  only(p.cands, [27], [2, 5, 7]);
  const s1 = step(p);
  eq(s1.tech, 'naked-pair');
  applyStep(p.values, p.cands, s1);
  eq(p.cands[27], bit(5));
  const s2 = step(p);
  eq(s2.tech, 'naked-single');
  eq(s2.place, { cell: 27, digit: 5 });
  assert(s2.text.includes('ruled out'), s2.text);
});

test('applyStep placement removes digit from peers', () => {
  const p = blank();
  applyStep(p.values, p.cands, { place: { cell: 40, digit: 3 }, eliminate: [] });
  eq(p.values[40], 3);
  eq(p.cands[40], 0);
  assert(peers[40].every((j) => !(p.cands[j] & bit(3))));
  assert(!peers[40].includes(0) && p.cands[0] & bit(3));
});

test('allSteps lists several steps easiest first', () => {
  const p = blank();
  only(p.cands, [30, 34], [2, 7]);
  only(p.cands, [70], [9]);
  const techs = [...allSteps(p.values, p.cands)].map((s) => s.tech);
  eq(techs[0], 'naked-single');
  assert(techs.includes('naked-pair'));
});

// ===========================================================================
// Full puzzles
// ===========================================================================

// Found with tools/puzzle-gen.mjs (seed 12345), verified unique.
const PUZZLES = [
  { name: 'easy (classic)', p: EASY, hardest: null /* any single */ },
  { name: 'pointing', p: '030600000001009000460001090204900010073000650010007209090300068000500300000006070', hardest: 'pointing' },
  { name: 'claiming', p: '900001456008009170000030800700003000005247600000500007007050000053800700894300005', hardest: 'claiming' },
  { name: 'naked pair', p: '007006009000908050000350000819200004000000000500001386000039000040702000600500900', hardest: 'naked-pair' },
  { name: 'hidden pair', p: '032000000780400300001000209028709000006050400000806920603000100005001093000000640', hardest: 'hidden-pair' },
];

for (const { name, p, hardest } of PUZZLES) {
  test(`full puzzle solves: ${name}`, () => {
    const v = parseGrid(p);
    eq(countSolutions(v), 1, 'unique:');
    const sol = findSolution(v);
    const r = solveLogically(v);
    assert(r.solved, 'not solved');
    assert(isValidGrid(r.values), 'invalid result');
    eq(r.values, sol, 'matches backtracking solution:');
    eq(gridToString(v), p, 'input not mutated:');
    const rt = rate(v);
    if (hardest) eq(rt.hardest, hardest, 'hardest:');
    else assert(TECH_INFO[rt.hardest].world <= 2, `easy puzzle needs ${rt.hardest}`);
  });
}

test('easy puzzle: solution equals the known answer', () => {
  eq(gridToString(solveLogically(parseGrid(EASY)).values), EASY_SOL);
});

// ===========================================================================
// countSolutions, validity, conflicts, dead ends
// ===========================================================================

test('countSolutions: 0 / 1 / 2', () => {
  const bad = parseGrid(EASY);
  bad[2] = 5; // second 5 in row 1
  eq(countSolutions(bad), 0, 'conflicting grid');
  // contradiction without a direct duplicate: r1c3 has no candidate
  const c = parseGrid(EASY);
  c[11] = 1; c[29] = 2; c[38] = 4; // column 3 now has 1,2,4 so r1c3 is empty-handed
  eq(countSolutions(c), 0, 'contradiction');
  eq(countSolutions(parseGrid(EASY)), 1, 'unique');
  eq(countSolutions(new Int8Array(81)), 2, 'empty grid');
  eq(countSolutions(new Int8Array(81), 5), 5, 'limit respected');
  eq(countSolutions(SOL), 1, 'full grid');
  // Remove clues from a unique puzzle until ambiguous -> 2
  const amb = parseGrid(PUZZLES[1].p);
  let k = 0;
  while (countSolutions(amb) === 1) { while (!amb[k]) k++; amb[k] = 0; }
  eq(countSolutions(amb), 2, 'ambiguous after removing clues');
});

test('findConflicts / isValidGrid', () => {
  eq(findConflicts(parseGrid(EASY)), []);
  assert(isValidGrid(parseGrid(EASY)));
  const bad = parseGrid(EASY);
  bad[2] = 5; // clashes with r1c1 (row/box)
  eq(findConflicts(bad), [0, 2]);
  assert(!isValidGrid(bad));
  assert(!isValidGrid(new Int8Array(80)));
  assert(!isValidGrid(Array(81).fill(10)));
});

test('isDeadEnd: true / false cases', () => {
  assert(!isDeadEnd(parseGrid(EASY)), 'start position');
  assert(!isDeadEnd(new Int8Array(81)), 'empty grid');
  assert(!isDeadEnd(SOL), 'solved grid');
  const c = parseGrid(EASY);
  c[11] = 1; c[29] = 2; c[38] = 4;
  assert(isDeadEnd(c), 'cell with no candidate');
  // unit where a digit has no place: no empty cell of row 1 can hold a 9
  const w = new Int8Array(81);
  w[2] = 1; // r1c3 filled with something else
  w[16] = 9; // r2c8 blocks r1c7-c9 (box 3)
  w[22] = 9; // r3c5 blocks r1c4-c6 (box 2)
  w[27] = 9; // r4c1 blocks r1c1 (column 1)
  w[55] = 9; // r7c2 blocks r1c2 (column 2)
  eq(findConflicts(w), [], 'setup has no conflicts');
  assert(computeCands(w).every((m, i) => w[i] || m), 'every empty cell still has candidates');
  assert(isDeadEnd(w), 'digit with no place in row 1');
  const dup = parseGrid(EASY); dup[2] = 5;
  assert(isDeadEnd(dup), 'conflict counts as dead end');
});

// ===========================================================================
// checkClaim
// ===========================================================================

test('checkClaim: naked pair correct and incorrect', () => {
  const p = blank();
  only(p.cands, [30, 34], [2, 7]);
  let r = checkClaim(p.values, p.cands, { type: 'pattern', tech: 'naked-pair', cells: [30, 34], digits: [2, 7] });
  assert(r.ok, r.text);
  assert(r.text.startsWith('Yes — r4c4 and r4c8 form a naked pair on {2,7} in row 4.'), r.text);
  only(p.cands, [34], [2, 7, 9]);
  r = checkClaim(p.values, p.cands, { type: 'pattern', tech: 'naked-pair', cells: [30, 34], digits: [2, 7] });
  assert(!r.ok);
  eq(r.text, 'Not a pair: r4c8 can also be 9.');
  r = checkClaim(p.values, p.cands, { type: 'pattern', tech: 'naked-pair', cells: [30, 34] });
  assert(!r.ok && r.text.includes('r4c8'), r.text);
  r = checkClaim(p.values, p.cands, { type: 'pattern', tech: 'naked-pair', cells: [0, 40] });
  assert(!r.ok && r.text.includes("don't share"), r.text);
});

test('checkClaim: hidden pair, pointing, claiming, singles', () => {
  const p = blank();
  clear(p.cands, except(ROWS[2], 19, 25), [4, 8]);
  let r = checkClaim(p.values, p.cands, { type: 'pattern', tech: 'hidden-pair', cells: [19, 25], digits: [4, 8] });
  assert(r.ok, r.text);
  r = checkClaim(p.values, p.cands, { type: 'pattern', tech: 'hidden-pair', cells: [19, 25] });
  assert(r.ok, r.text);
  r = checkClaim(p.values, p.cands, { type: 'pattern', tech: 'hidden-pair', cells: [19, 25], digits: [4, 5] });
  assert(!r.ok && r.text.includes('5 can also go'), r.text);

  const q = blank();
  clear(q.cands, except(BOXES[0], 0, 1), [5]);
  r = checkClaim(q.values, q.cands, { type: 'pattern', tech: 'pointing', cells: [0, 1], digits: [5] });
  assert(r.ok && r.text.includes('r1c4'), r.text);
  r = checkClaim(q.values, q.cands, { type: 'pattern', tech: 'pointing', cells: [0, 1], digits: [6] });
  assert(!r.ok && r.text.includes('6 can also go'), r.text);
  r = checkClaim(q.values, q.cands, { type: 'pattern', tech: 'claiming', cells: [0, 1], digits: [5] });
  assert(!r.ok, r.text); // row 1 has 5s elsewhere

  const w = blank();
  clear(w.cands, range(3, 9), [5]);
  r = checkClaim(w.values, w.cands, { type: 'pattern', tech: 'claiming', cells: [0, 1, 2], digits: [5] });
  assert(r.ok && r.text.includes('r2c1'), r.text);

  const s = blank();
  only(s.cands, [10], [5]);
  assert(checkClaim(s.values, s.cands, { type: 'pattern', tech: 'naked-single', cells: [10] }).ok);
  r = checkClaim(s.values, s.cands, { type: 'pattern', tech: 'naked-single', cells: [11] });
  assert(!r.ok && r.text.includes('can still be'), r.text);
  clear(s.cands, except(BOXES[4], 40), [3]);
  assert(checkClaim(s.values, s.cands, { type: 'pattern', tech: 'hidden-single', cells: [40], digits: [3] }).ok);
  r = checkClaim(s.values, s.cands, { type: 'pattern', tech: 'hidden-single', cells: [41], digits: [3] });
  assert(!r.ok, r.text);
  r = checkClaim(s.values, s.cands, { type: 'pattern', tech: 'hidden-single', cells: [50], digits: [7] });
  assert(!r.ok && r.text.includes('also go'), r.text);
});

test('checkClaim: place / eliminate against the solution', () => {
  const v = parseGrid(EASY);
  const c = computeCands(v);
  const sol = parseGrid(EASY_SOL);
  // r1c3 is 4
  let r = checkClaim(v, c, { type: 'place', cell: 2, digit: 4 }, sol);
  assert(r.ok, r.text);
  r = checkClaim(v, c, { type: 'place', cell: 2, digit: 1 }, sol);
  assert(!r.ok && r.text.includes('still a candidate'), r.text);
  r = checkClaim(v, c, { type: 'place', cell: 2, digit: 5 }, sol);
  assert(!r.ok && r.text.includes('r1c1'), r.text); // 5 already in row 1
  r = checkClaim(v, c, { type: 'place', cell: 0, digit: 5 }, sol);
  assert(!r.ok && r.text.includes('already filled'), r.text);
  // without a solution argument it computes the unique one
  assert(checkClaim(v, c, { type: 'place', cell: 2, digit: 4 }).ok);
  r = checkClaim(v, c, { type: 'eliminate', cell: 2, digit: 1 }, sol);
  assert(r.ok, r.text);
  r = checkClaim(v, c, { type: 'eliminate', cell: 2, digit: 4 }, sol);
  assert(!r.ok && r.text.includes('actually is 4'), r.text);
  r = checkClaim(v, c, { type: 'eliminate', cell: 2, digit: 5 }, sol);
  assert(r.ok && r.text.includes('already ruled out'), r.text);
  // player wrongly removed the real digit from their notes
  const c2 = Uint16Array.from(c);
  c2[2] &= ~bit(4);
  r = checkClaim(v, c2, { type: 'eliminate', cell: 2, digit: 4 }, sol);
  assert(!r.ok && r.text.startsWith('Careful'), r.text);
});

test('checkClaim: elimination proven by a pattern on the board', () => {
  const p = blank();
  clear(p.cands, except(BOXES[0], 0, 1), [5]);
  const r = checkClaim(p.values, p.cands, { type: 'eliminate', cell: 5, digit: 5 }, SOL.map((d) => (d === 5 ? 1 : d)));
  assert(r.ok && r.text.includes('pointing'), r.text);
});

// ===========================================================================
// Invariants over random generated puzzles
// ===========================================================================

const N = 300;
const rng = makeRng(20261112);
const corpus = [];
let genMs = 0;
{
  const t0 = performance.now();
  for (let k = 0; k < N; k++) corpus.push(generatePuzzle(rng));
  genMs = performance.now() - t0;
}

const stats = { hardest: {}, solved: 0, stepCount: 0, techCount: {} };

test(`invariants over ${N} random unique puzzles`, () => {
  for (let k = 0; k < N; k++) {
    const { puzzle, solution } = corpus[k];
    assert(countSolutions(puzzle) === 1, `puzzle ${k} not unique`);
    const v = Int8Array.from(puzzle);
    const c = computeCands(v);
    const steps = [];
    for (let guard = 0; guard < 810; guard++) {
      const s = nextStep(v, c);
      if (!s) break;
      assert(s.text && s.text.length > 10, 'missing text');
      if (s.place) {
        assert(solution[s.place.cell] === s.place.digit,
          `puzzle ${k}: ${s.tech} placed ${s.place.digit} at ${s.place.cell}, solution ${solution[s.place.cell]}`);
      }
      for (const [cell, d] of s.eliminate) {
        assert(solution[cell] !== d, `puzzle ${k}: ${s.tech} removed true digit ${d} from ${cell}`);
        assert(c[cell] & bit(d), `puzzle ${k}: ${s.tech} eliminates a digit that was not a candidate`);
      }
      if (!s.place) assert(s.eliminate.length > 0, 'elimination step with nothing to remove');
      applyStep(v, c, s);
      steps.push(s);
      if (s.place) assert(findConflicts(v).length === 0, `puzzle ${k}: conflict after ${s.tech}`);
    }
    // every remaining candidate set still contains the true digit
    for (let i = 0; i < 81; i++) if (!v[i]) assert(c[i] & bit(solution[i]), `puzzle ${k}: lost true candidate at ${i}`);
    const solved = v.every((d) => d);
    if (solved) eq(Array.from(v), Array.from(solution), `puzzle ${k} wrong solution`);
    // rate() and solveLogically() agree with the manual run
    const r = rate(puzzle);
    const sl = solveLogically(puzzle);
    eq(r.solved, solved, `puzzle ${k} rate.solved`);
    eq(sl.solved, solved, `puzzle ${k} solveLogically.solved`);
    eq(sl.steps.length, steps.length, `puzzle ${k} step count`);
    eq(r.steps, steps.length);
    eq(Object.values(r.counts).reduce((a, b) => a + b, 0), r.steps);
    const hardest = steps.reduce((h, s) => (h === null || TECHNIQUES.indexOf(s.tech) > TECHNIQUES.indexOf(h) ? s.tech : h), null);
    eq(r.hardest, hardest, `puzzle ${k} hardest`);
    eq(isDeadEnd(puzzle), false, `puzzle ${k} dead end at start`);

    const key = solved ? r.hardest : `UNSOLVED (stuck after ${r.hardest})`;
    stats.hardest[key] = (stats.hardest[key] || 0) + 1;
    if (solved) stats.solved++;
    stats.stepCount += r.steps;
    for (const [t, n] of Object.entries(r.counts)) stats.techCount[t] = (stats.techCount[t] || 0) + n;
  }
});

// Timing of rate() alone
let rateMs = 0;
{
  const t0 = performance.now();
  for (const { puzzle } of corpus) rate(puzzle);
  rateMs = (performance.now() - t0) / N;
}

// ===========================================================================
// Report
// ===========================================================================

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('\n--- Summary ---');
console.log(`${passed}/${results.length} tests passed${failed ? `, ${failed} FAILED` : ''}`);

console.log(`\n--- Hardest technique needed, ${N} random minimal symmetric puzzles (seed 20261112) ---`);
const order = (k) => {
  const i = TECHNIQUES.indexOf(k);
  return i >= 0 ? i : 100 + TECHNIQUES.indexOf(k.replace(/^UNSOLVED \(stuck after (.*)\)$/, '$1'));
};
for (const [k, n] of Object.entries(stats.hardest).sort((a, b) => order(a[0]) - order(b[0]))) {
  console.log(`  ${k.padEnd(40)} ${String(n).padStart(4)}  (${((100 * n) / N).toFixed(1)}%)`);
}
console.log(`  Solved by these 8 techniques: ${stats.solved}/${N} (${((100 * stats.solved) / N).toFixed(1)}%)`);
console.log('\n--- Total steps per technique across corpus ---');
for (const t of TECHNIQUES) console.log(`  ${t.padEnd(20)} ${stats.techCount[t] || 0}`);
console.log(`\n--- Timing ---`);
console.log(`  avg rate(): ${rateMs.toFixed(2)} ms/puzzle   (generation: ${(genMs / N).toFixed(1)} ms/puzzle)`);

process.exit(failed ? 1 : 0);
