// solver.js — human-style sudoku solver for the learning game.
//
// Pure ES module, zero dependencies, no DOM and no Node APIs, so it runs the
// same in Node 18+ and in browsers.
//
// What it does:
//   * finds the easiest human step on a board (8 techniques, easiest first)
//   * explains each step in plain English
//   * solves a puzzle with those steps and rates it by the hardest step used
//   * counts solutions with fast bitmask backtracking (uniqueness checks only)
//   * validity / conflict / dead-end checks
//   * "check my thinking": verifies a player's claim and explains why
//
// Data model:
//   values : array or Int8Array of 81 digits, 0 = empty. Cell i is row-major:
//            row = i/9|0, col = i%9, box = (row/3|0)*3 + (col/3|0).
//   cands  : Uint16Array(81) bitmasks. Bit (d-1) set = digit d still possible.
//            Filled cells have cands 0.
//
// Step format (plain, JSON-serializable object):
//   { tech, unit: {type:'row'|'col'|'box', index} | null, pattern: [cells],
//     digits: [digits], place: {cell, digit} | null, eliminate: [[cell, digit]],
//     text }

// ===========================================================================
// 1. Geometry: rows, columns, boxes, units, peers
// ===========================================================================

export const rowOf = (i) => (i / 9) | 0;
export const colOf = (i) => i % 9;
export const boxOf = (i) => ((((i / 9) | 0) / 3) | 0) * 3 + (((i % 9) / 3) | 0);

/** ROWS[r], COLS[c], BOXES[b]: the 9 cell indices of each unit, in reading order. */
export const ROWS = [];
export const COLS = [];
export const BOXES = [];
for (let k = 0; k < 9; k++) {
  ROWS.push([]);
  COLS.push([]);
  BOXES.push([]);
}
for (let i = 0; i < 81; i++) {
  ROWS[rowOf(i)].push(i);
  COLS[colOf(i)].push(i);
  BOXES[boxOf(i)].push(i);
}

/**
 * All 27 units in scan order: rows 0-8 (unit ids 0-8), columns (9-17),
 * boxes (18-26). This order is also the deterministic scan order of the solver.
 */
export const units = [...ROWS, ...COLS, ...BOXES];

const UNIT_TYPES = ['row', 'col', 'box'];
/** Unit id (0-26) -> {type, index} as used in steps. */
export const unitInfo = (u) => ({ type: UNIT_TYPES[(u / 9) | 0], index: u % 9 });

/** CELL_UNITS[i] = [rowUnitId, colUnitId, boxUnitId]. */
export const CELL_UNITS = [];
for (let i = 0; i < 81; i++) CELL_UNITS.push([rowOf(i), 9 + colOf(i), 18 + boxOf(i)]);

/** peers[i]: the 20 other cells that share a row, column or box with i (sorted). */
export const peers = [];
for (let i = 0; i < 81; i++) {
  const set = new Set();
  for (const u of CELL_UNITS[i]) for (const j of units[u]) if (j !== i) set.add(j);
  peers.push([...set].sort((a, b) => a - b));
}

// ===========================================================================
// 2. Bit helpers
// ===========================================================================

export const ALL = 0x1ff; // digits 1..9
export const bit = (d) => 1 << (d - 1);

/** POP[mask] = number of set bits, for 9-bit masks. */
const POP = new Uint8Array(512);
for (let m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);
export const popcount = (m) => POP[m & ALL];

/** Digits in a mask, ascending. */
export function digitsOf(mask) {
  const out = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
  return out;
}
/** Lowest digit in a mask (mask must be non-zero). */
const firstDigit = (mask) => 31 - Math.clz32(mask & -mask) + 1;

const maskOfDigits = (ds) => ds.reduce((m, d) => m | bit(d), 0);

// ===========================================================================
// 3. Text helpers (names are 1-based: r4c6, row 4, column 6, box 5)
// ===========================================================================

export const cellName = (i) => `r${rowOf(i) + 1}c${colOf(i) + 1}`;
const UNIT_WORDS = { row: 'row', col: 'column', box: 'box' };
export const unitName = (unit) => `${UNIT_WORDS[unit.type]} ${unit.index + 1}`;

/** ['a','b','c'] -> "a, b and c" (or "or"). */
function joinWords(items, word = 'and') {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;
}
const listCells = (cells, word = 'and') => joinWords(cells.map(cellName), word);
const setText = (ds) => `{${ds.join(',')}}`;
const allIn = (n) => (n === 2 ? 'both in' : 'all in');

/** "remove 5 from r1c4 and r1c5" style summary of an elimination list. */
function elimText(elims) {
  const byDigit = new Map();
  for (const [c, d] of elims) {
    if (!byDigit.has(d)) byDigit.set(d, []);
    byDigit.get(d).push(c);
  }
  return joinWords([...byDigit].map(([d, cs]) => `${d} from ${listCells(cs)}`));
}

// ===========================================================================
// 4. Grid utilities: parsing, candidates, conflicts, validity, dead ends
// ===========================================================================

/** "53..7...." / "530070000" (81 chars, '.' or '0' = empty) -> Int8Array(81). */
export function parseGrid(str) {
  const clean = String(str).replace(/\s+/g, '');
  if (clean.length !== 81) throw new Error(`grid string must have 81 cells, got ${clean.length}`);
  const v = new Int8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = clean[i];
    v[i] = ch >= '1' && ch <= '9' ? ch.charCodeAt(0) - 48 : 0;
  }
  return v;
}

/** values -> 81-char string with '0' for empty cells. */
export const gridToString = (values) => Array.from(values, (d) => (d ? String(d) : '0')).join('');

/** Mask of digits already placed among the peers of cell i. */
function seenMask(values, i) {
  let m = 0;
  for (const j of peers[i]) if (values[j]) m |= bit(values[j]);
  return m;
}

/** True if some peer of cell i holds digit d. */
function sees(values, i, d) {
  for (const j of peers[i]) if (values[j] === d) return true;
  return false;
}

/** Candidates from scratch: each empty cell gets every digit not seen by a peer. */
export function computeCands(values) {
  const cands = new Uint16Array(81);
  for (let i = 0; i < 81; i++) if (!values[i]) cands[i] = ALL & ~seenMask(values, i);
  return cands;
}

/** Sorted list of cells whose digit also appears in one of their peers. */
export function findConflicts(values) {
  const bad = new Set();
  for (const unit of units) {
    const where = new Array(10);
    for (const i of unit) {
      const d = values[i];
      if (!d) continue;
      if (where[d] === undefined) where[d] = i;
      else {
        bad.add(where[d]);
        bad.add(i);
      }
    }
  }
  return [...bad].sort((a, b) => a - b);
}

/** 81 integer entries in 0..9 and no two equal digits among peers. */
export function isValidGrid(values) {
  if (!values || values.length !== 81) return false;
  for (let i = 0; i < 81; i++) {
    const d = values[i];
    if (!Number.isInteger(d) || d < 0 || d > 9) return false;
  }
  return findConflicts(values).length === 0;
}

/**
 * True if the board (values only) can no longer be completed by the basic
 * rules: a conflict, an empty cell with no candidate, or a unit where some
 * missing digit has no possible cell. Uses computeCands, not player notes.
 */
export function isDeadEnd(values) {
  if (findConflicts(values).length) return true;
  const cands = computeCands(values);
  for (let i = 0; i < 81; i++) if (!values[i] && !cands[i]) return true;
  for (const unit of units) {
    let placed = 0;
    let possible = 0;
    for (const i of unit) {
      if (values[i]) placed |= bit(values[i]);
      else possible |= cands[i];
    }
    if ((placed | possible) !== ALL) return true;
  }
  return false;
}

// ===========================================================================
// 5. Techniques
//
// Each technique is a generator that yields every step it can find, in a
// fixed scan order (units: rows, then columns, then boxes; digits 1..9;
// cells in reading order). nextStep() takes the first step of the easiest
// technique that has one, so results are reproducible.
// Generators only read values/cands; they never mutate them.
// ===========================================================================

export const TECHNIQUES = [
  'full-house',
  'hidden-single-box',
  'hidden-single-line',
  'naked-single',
  'pointing',
  'claiming',
  'naked-pair',
  'hidden-pair',
];

export const TECH_INFO = {
  'full-house': { name: 'Full House', world: 0 },
  'hidden-single-box': { name: 'Hidden Single (box)', world: 1 },
  'hidden-single-line': { name: 'Hidden Single (row/column)', world: 1 },
  'naked-single': { name: 'Naked Single', world: 2 },
  pointing: { name: 'Pointing', world: 3 },
  claiming: { name: 'Claiming', world: 3 },
  'naked-pair': { name: 'Naked Pair', world: 4 },
  'hidden-pair': { name: 'Hidden Pair', world: 4 },
};

const TECH_RANK = Object.fromEntries(TECHNIQUES.map((t, k) => [t, k]));

function makeStep(tech, u, pattern, digits, place, eliminate, text) {
  return {
    tech,
    unit: u === null ? null : unitInfo(u),
    pattern,
    digits,
    place,
    eliminate,
    text,
  };
}

const sortElims = (elims) => elims.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// --- 5.1 Full house -------------------------------------------------------
// A unit with exactly one empty cell: it gets the one digit the unit is missing.
function* fullHouse(values, cands) {
  for (let u = 0; u < 27; u++) {
    let empty = -1;
    let count = 0;
    let placed = 0;
    for (const i of units[u]) {
      if (values[i]) placed |= bit(values[i]);
      else {
        empty = i;
        count++;
      }
    }
    if (count !== 1) continue;
    const missing = ALL & ~placed;
    if (popcount(missing) !== 1) continue; // unit has a duplicate: broken board
    const d = firstDigit(missing);
    if (!(cands[empty] & bit(d))) continue; // contradiction in cands: not a safe step
    const name = unitName(unitInfo(u));
    yield makeStep('full-house', u, [empty], [d], { cell: empty, digit: d }, [],
      `${cap(name)} has only one empty cell left, ${cellName(empty)}, and the only digit it is missing is ${d}.`);
  }
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// --- 5.2/5.3 Hidden singles ----------------------------------------------
// Within one unit, digit d has exactly one cell left where it can go.
function* hiddenSingles(values, cands, uFrom, uTo, tech) {
  for (let u = uFrom; u < uTo; u++) {
    const cells = units[u];
    let placed = 0;
    for (const i of cells) if (values[i]) placed |= bit(values[i]);
    for (let d = 1; d <= 9; d++) {
      if (placed & bit(d)) continue;
      const b = bit(d);
      let spot = -1;
      let count = 0;
      for (const i of cells) {
        if (!values[i] && cands[i] & b) {
          spot = i;
          if (++count > 1) break;
        }
      }
      if (count !== 1) continue;
      const info = unitInfo(u);
      const name = unitName(info);
      // Explain why the other cells are out: do they all simply see a d?
      const others = cells.filter((i) => !values[i] && i !== spot);
      const allSee = others.every((i) => sees(values, i, d));
      const where = info.type === 'box' ? 'row or column' : info.type === 'row' ? 'column or box' : 'row or box';
      let why;
      if (others.length === 0) why = '';
      else if (allSee) why = ` Every other empty cell in ${name} already sees a ${d} in its ${where}.`;
      else why = ` Every other empty cell in ${name} has been ruled out for ${d}.`;
      yield makeStep(tech, u, [spot], [d], { cell: spot, digit: d }, [],
        `In ${name}, ${cellName(spot)} is the only place left for a ${d}.${why}`);
    }
  }
}

// --- 5.4 Naked single ------------------------------------------------------
// A cell with exactly one candidate.
function* nakedSingle(values, cands) {
  for (let i = 0; i < 81; i++) {
    if (values[i] || popcount(cands[i]) !== 1) continue;
    const d = firstDigit(cands[i]);
    const fromValues = (ALL & ~seenMask(values, i)) === cands[i];
    const why = fromValues
      ? `every other digit already appears in its row, column or box`
      : `all its other candidates have been ruled out`;
    yield makeStep('naked-single', null, [i], [d], { cell: i, digit: d }, [],
      `${cellName(i)} can only be ${d}: ${why}.`);
  }
}

// --- 5.5 Pointing ----------------------------------------------------------
// In a box, every candidate for d lies in one row (or column). The box's d
// must be in that line, so no other cell of the line (outside the box) can be d.
function* pointing(values, cands) {
  for (let b = 0; b < 9; b++) {
    const cells = BOXES[b];
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      const pos = cells.filter((i) => !values[i] && cands[i] & m);
      if (pos.length < 2) continue; // 1 = hidden single, 0 = contradiction
      if (cells.some((i) => values[i] === d)) continue;
      for (const lineType of ['row', 'col']) {
        const key = lineType === 'row' ? rowOf : colOf;
        const k = key(pos[0]);
        if (!pos.every((i) => key(i) === k)) continue;
        const line = lineType === 'row' ? ROWS[k] : COLS[k];
        const elims = line.filter((i) => boxOf(i) !== b && !values[i] && cands[i] & m).map((i) => [i, d]);
        if (!elims.length) continue;
        const lineName = unitName({ type: lineType, index: k });
        yield makeStep('pointing', 18 + b, pos, [d], null, elims,
          `In box ${b + 1}, ${d} can only go in ${listCells(pos, 'or')}, ${allIn(pos.length)} ${lineName}. ` +
          `So the ${d} for ${lineName} must be inside box ${b + 1}: remove ${elimText(elims)}.`);
      }
    }
  }
}

// --- 5.6 Claiming (box-line reduction) ------------------------------------
// In a row/column, every candidate for d lies in one box. The line's d must
// be in that box, so no other cell of the box (off the line) can be d.
function* claiming(values, cands) {
  for (let u = 0; u < 18; u++) {
    const cells = units[u];
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      const pos = cells.filter((i) => !values[i] && cands[i] & m);
      if (pos.length < 2) continue;
      if (cells.some((i) => values[i] === d)) continue;
      const b = boxOf(pos[0]);
      if (!pos.every((i) => boxOf(i) === b)) continue;
      const inLine = new Set(cells);
      const elims = BOXES[b].filter((i) => !inLine.has(i) && !values[i] && cands[i] & m).map((i) => [i, d]);
      if (!elims.length) continue;
      const lineName = unitName(unitInfo(u));
      yield makeStep('claiming', u, pos, [d], null, elims,
        `In ${lineName}, ${d} can only go in ${listCells(pos, 'or')}, ${allIn(pos.length)} box ${b + 1}. ` +
        `So the ${d} for box ${b + 1} must be in ${lineName}: remove ${elimText(elims)}.`);
    }
  }
}

// --- 5.7 Naked pair --------------------------------------------------------
// Two cells in a unit with the same two candidates {a,b}: those two cells take
// a and b between them, so every other cell in every unit they share loses a, b.
function sharedUnits(i, j) {
  return CELL_UNITS[i].filter((u) => CELL_UNITS[j].includes(u));
}

/** Eliminations of a naked pair, grouped by shared unit (only units with any). */
function nakedPairElims(values, cands, i, j, mask) {
  const perUnit = [];
  const seen = new Set();
  const elims = [];
  for (const u of sharedUnits(i, j)) {
    let any = false;
    for (const k of units[u]) {
      if (k === i || k === j || values[k] || !(cands[k] & mask)) continue;
      any = true;
      for (const d of digitsOf(cands[k] & mask)) {
        const key = k * 10 + d;
        if (!seen.has(key)) {
          seen.add(key);
          elims.push([k, d]);
        }
      }
    }
    if (any) perUnit.push(u);
  }
  return { perUnit, elims: sortElims(elims) };
}

function* nakedPair(values, cands) {
  const done = new Set();
  for (let u = 0; u < 27; u++) {
    const cells = units[u].filter((i) => !values[i] && popcount(cands[i]) === 2);
    for (let x = 0; x < cells.length; x++) {
      for (let y = x + 1; y < cells.length; y++) {
        const i = cells[x];
        const j = cells[y];
        if (cands[i] !== cands[j]) continue;
        const key = i * 81 + j;
        if (done.has(key)) continue;
        done.add(key);
        const mask = cands[i];
        const { perUnit, elims } = nakedPairElims(values, cands, i, j, mask);
        if (!elims.length) continue;
        const ds = digitsOf(mask);
        const names = perUnit.map((v) => unitName(unitInfo(v)));
        yield makeStep('naked-pair', perUnit[0], [i, j], ds, null, elims,
          `${cellName(i)} and ${cellName(j)} can only be ${ds[0]} or ${ds[1]}, ` +
          `so no other cell in ${joinWords(names, 'or')} can be ${ds[0]} or ${ds[1]}.`);
      }
    }
  }
}

// --- 5.8 Hidden pair -------------------------------------------------------
// In a unit, digits a and b each fit in only the same two cells. Those cells
// must hold a and b, so all their other candidates go.
function* hiddenPair(values, cands) {
  for (let u = 0; u < 27; u++) {
    const cells = units[u];
    let placed = 0;
    for (const i of cells) if (values[i]) placed |= bit(values[i]);
    // pos[d] = cells of this unit where d is a candidate (only for 2-spot digits)
    const two = [];
    const pos = new Array(10);
    for (let d = 1; d <= 9; d++) {
      if (placed & bit(d)) continue;
      const p = cells.filter((i) => !values[i] && cands[i] & bit(d));
      if (p.length === 2) {
        pos[d] = p;
        two.push(d);
      }
    }
    for (let x = 0; x < two.length; x++) {
      for (let y = x + 1; y < two.length; y++) {
        const a = two[x];
        const b = two[y];
        if (pos[a][0] !== pos[b][0] || pos[a][1] !== pos[b][1]) continue;
        const pair = pos[a];
        const keep = bit(a) | bit(b);
        const elims = [];
        for (const i of pair) for (const d of digitsOf(cands[i] & ~keep)) elims.push([i, d]);
        if (!elims.length) continue;
        const name = unitName(unitInfo(u));
        const extra = pair
          .filter((i) => cands[i] & ~keep)
          .map((i) => `${cellName(i)} loses ${joinWords(digitsOf(cands[i] & ~keep))}`);
        yield makeStep('hidden-pair', u, [...pair], [a, b], null, sortElims(elims),
          `In ${name}, ${a} and ${b} can only go in ${cellName(pair[0])} and ${cellName(pair[1])}, ` +
          `so those two cells must be ${a} and ${b}. Their other candidates go: ${joinWords(extra)}.`);
      }
    }
  }
}

const GENERATORS = {
  'full-house': fullHouse,
  'hidden-single-box': (v, c) => hiddenSingles(v, c, 18, 27, 'hidden-single-box'),
  'hidden-single-line': (v, c) => hiddenSingles(v, c, 0, 18, 'hidden-single-line'),
  'naked-single': nakedSingle,
  pointing,
  claiming,
  'naked-pair': nakedPair,
  'hidden-pair': hiddenPair,
};

// ===========================================================================
// 6. Step API: nextStep, allSteps, applyStep
// ===========================================================================

function toSet(allowed) {
  if (allowed instanceof Set) return allowed;
  return new Set(allowed ?? TECHNIQUES);
}

/**
 * Easiest available step among `allowed` techniques (array or Set of ids),
 * or null if none applies. Does not mutate values or cands.
 */
export function nextStep(values, cands, allowed = TECHNIQUES) {
  const set = toSet(allowed);
  for (const tech of TECHNIQUES) {
    if (!set.has(tech)) continue;
    const r = GENERATORS[tech](values, cands).next();
    if (!r.done) return r.value;
  }
  return null;
}

/**
 * Every available step, easiest technique first, in scan order within each
 * technique. Useful for hints ("show me all pointing moves") and for checking
 * claims. Lazy: stop iterating whenever you like.
 */
export function* allSteps(values, cands, allowed = TECHNIQUES) {
  const set = toSet(allowed);
  for (const tech of TECHNIQUES) if (set.has(tech)) yield* GENERATORS[tech](values, cands);
}

/**
 * Apply a step in place. Placement: set the value, clear its cands, and
 * remove the digit from every peer. Elimination: clear the listed bits.
 */
export function applyStep(values, cands, step) {
  if (step.place) {
    const { cell, digit } = step.place;
    values[cell] = digit;
    cands[cell] = 0;
    const m = ~bit(digit);
    for (const j of peers[cell]) cands[j] &= m;
  }
  for (const [cell, digit] of step.eliminate || []) cands[cell] &= ~bit(digit);
}

// ===========================================================================
// 7. Logical solving and rating
// ===========================================================================

/**
 * Solve with human techniques only. Works on copies.
 * Returns { solved, steps, values } where values is a plain array.
 * A board with conflicts returns immediately with no steps.
 */
export function solveLogically(values, allowed = TECHNIQUES) {
  const v = Int8Array.from(values);
  const set = toSet(allowed);
  const steps = [];
  if (findConflicts(v).length) return { solved: false, steps, values: Array.from(v) };
  const c = computeCands(v);
  // Each step places a digit or removes at least one candidate, so 81 + 729
  // steps is a hard upper bound; the guard only protects against bugs.
  for (let guard = 0; guard < 810; guard++) {
    const step = nextStep(v, c, set);
    if (!step) break;
    applyStep(v, c, step);
    steps.push(step);
  }
  const solved = v.every((d) => d !== 0) && findConflicts(v).length === 0;
  return { solved, steps, values: Array.from(v) };
}

/**
 * Rate a puzzle with all techniques.
 * hardest = hardest technique used (even if unsolved; check `solved`), or
 * null if no step was needed/possible. counts = steps per technique.
 */
export function rate(values) {
  const { solved, steps } = solveLogically(values);
  const counts = {};
  let hardest = null;
  for (const s of steps) {
    counts[s.tech] = (counts[s.tech] || 0) + 1;
    if (hardest === null || TECH_RANK[s.tech] > TECH_RANK[hardest]) hardest = s.tech;
  }
  return { solved, hardest, counts, steps: steps.length };
}

// ===========================================================================
// 8. Backtracking (uniqueness only — never used for teaching)
// ===========================================================================

/**
 * Core bitmask backtracker with MRV (most constrained cell first).
 * Returns {count, solution} where solution is the first one found.
 */
function backtrack(values, limit) {
  const grid = Int8Array.from(values);
  const rowM = new Uint16Array(9);
  const colM = new Uint16Array(9);
  const boxM = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const d = grid[i];
    if (!d) continue;
    if (d < 1 || d > 9) return { count: 0, solution: null };
    const m = bit(d);
    const r = rowOf(i), c = colOf(i), b = boxOf(i);
    if ((rowM[r] | colM[c] | boxM[b]) & m) return { count: 0, solution: null }; // duplicate
    rowM[r] |= m;
    colM[c] |= m;
    boxM[b] |= m;
  }
  const empties = [];
  for (let i = 0; i < 81; i++) if (!grid[i]) empties.push(i);
  const ER = empties.map(rowOf), EC = empties.map(colOf), EB = empties.map(boxOf);
  let count = 0;
  let solution = null;
  const n = empties.length;

  // empties[0..k-1] are filled; pick the best remaining cell and swap it to k.
  function search(k) {
    if (k === n) {
      count++;
      if (!solution) solution = Array.from(grid);
      return count >= limit;
    }
    let best = -1, bestFree = 0, bestPop = 10;
    for (let t = k; t < n; t++) {
      const free = ALL & ~(rowM[ER[t]] | colM[EC[t]] | boxM[EB[t]]);
      const p = POP[free];
      if (p < bestPop) {
        bestPop = p; best = t; bestFree = free;
        if (p <= 1) break;
      }
    }
    if (bestPop === 0) return false;
    swap(k, best);
    const cell = empties[k], r = ER[k], c = EC[k], b = EB[k];
    let free = bestFree;
    while (free) {
      const m = free & -free;
      free ^= m;
      rowM[r] |= m; colM[c] |= m; boxM[b] |= m;
      grid[cell] = 31 - Math.clz32(m) + 1;
      const stop = search(k + 1);
      rowM[r] ^= m; colM[c] ^= m; boxM[b] ^= m;
      grid[cell] = 0;
      if (stop) { swap(k, best); return true; }
    }
    swap(k, best);
    return false;
  }
  function swap(a, b) {
    if (a === b) return;
    [empties[a], empties[b]] = [empties[b], empties[a]];
    [ER[a], ER[b]] = [ER[b], ER[a]];
    [EC[a], EC[b]] = [EC[b], EC[a]];
    [EB[a], EB[b]] = [EB[b], EB[a]];
  }
  search(0);
  return { count, solution };
}

/** Number of solutions, capped at `limit` (0, 1, ... limit). */
export function countSolutions(values, limit = 2) {
  return backtrack(values, Math.max(1, limit)).count;
}

/** First solution found by backtracking (plain array), or null. */
export function findSolution(values) {
  return backtrack(values, 1).solution;
}

/** The solution if it is unique, else null. */
export function uniqueSolution(values) {
  const r = backtrack(values, 2);
  return r.count === 1 ? r.solution : null;
}

// ===========================================================================
// 9. "Check my thinking"
// ===========================================================================

const yes = (text) => ({ ok: true, text });
const no = (text) => ({ ok: false, text });

/** Positions of digit d (as candidates in empty cells) within unit u. */
const positionsIn = (values, cands, u, d) => units[u].filter((i) => !values[i] && cands[i] & bit(d));
const unitHas = (values, u, d) => units[u].some((i) => values[i] === d);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Check a player's claim against the current board.
 *   {type:'pattern', tech, cells, digits?}  tech: naked-pair | hidden-pair |
 *       pointing | claiming | naked-single | hidden-single
 *   {type:'place', cell, digit}
 *   {type:'eliminate', cell, digit}
 * `solution` (81 digits) is optional; if missing it is computed when the
 * board has a unique solution. Returns {ok, text}.
 */
export function checkClaim(values, cands, claim, solution) {
  if (!claim || typeof claim !== 'object') return no('I could not understand that claim.');
  if (claim.type === 'pattern') return checkPattern(values, cands, claim);
  if (claim.type === 'place' || claim.type === 'eliminate') {
    const { cell, digit } = claim;
    if (!(cell >= 0 && cell < 81) || !(digit >= 1 && digit <= 9)) return no('That cell or digit is out of range.');
    if (values[cell]) return no(`${cellName(cell)} is already filled (${values[cell]}).`);
    const sol = solution ?? uniqueSolution(values);
    return claim.type === 'place'
      ? checkPlace(values, cands, cell, digit, sol)
      : checkEliminate(values, cands, cell, digit, sol);
  }
  return no('I could not understand that claim.');
}

/** Why d is not a candidate in cell i: a peer holds it, or it was ruled out. */
function whyNot(values, i, d) {
  for (const j of peers[i]) {
    if (values[j] !== d) continue;
    const u = CELL_UNITS[i].find((v) => CELL_UNITS[j].includes(v));
    return `${cellName(j)} in the same ${UNIT_WORDS[unitInfo(u).type]} is already ${d}`;
  }
  return `${d} has already been ruled out there`;
}

/** If the board forces d into cell i with a single, say how; else null. */
function forcedBy(values, cands, i, d) {
  if (cands[i] === bit(d)) return `it is the only candidate left in ${cellName(i)}`;
  for (const u of [CELL_UNITS[i][2], CELL_UNITS[i][0], CELL_UNITS[i][1]]) {
    const p = positionsIn(values, cands, u, d);
    if (p.length === 1 && p[0] === i) return `it is the only place for a ${d} in ${unitName(unitInfo(u))}`;
  }
  return null;
}

function checkPlace(values, cands, cell, d, sol) {
  const name = cellName(cell);
  const isCand = !!(cands[cell] & bit(d));
  if (sol) {
    if (sol[cell] === d) {
      const why = forcedBy(values, cands, cell, d);
      if (why) return yes(`Yes, ${name} is ${d}, and the board already proves it: ${why}.`);
      return yes(`Yes, ${name} is ${d}. But nothing on the board forces it with a single yet, so look for what pins it down.`);
    }
    if (!isCand) return no(`No, ${name} can't be ${d}: ${whyNot(values, cell, d)}.`);
    return no(`No, ${name} is not ${d}. It is still a candidate, but it leads to a contradiction later.`);
  }
  // No unique solution available: judge by the current candidates only.
  if (!isCand) return no(`No, ${name} can't be ${d}: ${whyNot(values, cell, d)}.`);
  const why = forcedBy(values, cands, cell, d);
  if (why) return yes(`Yes, ${name} must be ${d}: ${why}.`);
  return no(`${d} is still possible in ${name}, but I can't confirm it: the board has no unique solution to check against and nothing forces it yet.`);
}

/** First elimination step (pointing, claiming, pairs) that removes d from cell. */
function provingStep(values, cands, cell, d) {
  for (const s of allSteps(values, cands, ['pointing', 'claiming', 'naked-pair', 'hidden-pair'])) {
    if (s.eliminate.some(([c, x]) => c === cell && x === d)) return s;
  }
  return null;
}

function checkEliminate(values, cands, cell, d, sol) {
  const name = cellName(cell);
  const isCand = !!(cands[cell] & bit(d));
  if (sol && sol[cell] === d) {
    return no(isCand
      ? `No, keep it: ${name} actually is ${d}.`
      : `Careful: ${name} actually is ${d}, so ${d} should not have been removed there.`);
  }
  if (!isCand) return yes(`Yes, ${d} is already ruled out in ${name}.`);
  const proof = provingStep(values, cands, cell, d);
  if (proof) return yes(`Yes, ${name} can't be ${d}. The board proves it with a ${TECH_INFO[proof.tech].name.toLowerCase()}: ${proof.text}`);
  if (sol) return yes(`Yes, ${name} is not ${d}. No simple pattern proves it yet, though.`);
  return no(`I can't confirm that: no simple pattern removes ${d} from ${name} right now.`);
}

// --- pattern claims ---------------------------------------------------------

function checkPattern(values, cands, claim) {
  const cells = [...new Set(claim.cells || [])].sort((a, b) => a - b);
  if (!cells.length || cells.some((i) => !(i >= 0 && i < 81))) return no('Pick the cells that make the pattern.');
  const filled = cells.find((i) => values[i]);
  if (filled !== undefined) return no(`${cellName(filled)} is already filled (${values[filled]}).`);
  const digits = claim.digits && claim.digits.length ? [...new Set(claim.digits)].sort((a, b) => a - b) : null;
  switch (claim.tech) {
    case 'naked-single': return claimNakedSingle(values, cands, cells, digits);
    case 'hidden-single': return claimHiddenSingle(values, cands, cells, digits);
    case 'naked-pair': return claimNakedPair(values, cands, cells, digits);
    case 'hidden-pair': return claimHiddenPair(values, cands, cells, digits);
    case 'pointing': return claimLocked(values, cands, cells, digits, 'pointing');
    case 'claiming': return claimLocked(values, cands, cells, digits, 'claiming');
    default: return no(`I don't know the pattern "${claim.tech}".`);
  }
}

function claimNakedSingle(values, cands, cells, digits) {
  if (cells.length !== 1) return no('A naked single is one cell.');
  const i = cells[0];
  const ds = digitsOf(cands[i]);
  if (ds.length === 1) {
    if (digits && digits[0] !== ds[0]) return no(`Close: ${cellName(i)} is a naked single, but its digit is ${ds[0]}, not ${digits[0]}.`);
    return yes(`Yes, ${cellName(i)} can only be ${ds[0]}.`);
  }
  if (!ds.length) return no(`${cellName(i)} has no candidates left, so something earlier went wrong.`);
  return no(`No, ${cellName(i)} can still be ${joinWords(ds, 'or')}.`);
}

function claimHiddenSingle(values, cands, cells, digits) {
  if (cells.length !== 1) return no('A hidden single is one cell.');
  const i = cells[0];
  const order = [CELL_UNITS[i][2], CELL_UNITS[i][0], CELL_UNITS[i][1]]; // box, row, column
  const tryDigits = digits ? digits : digitsOf(cands[i]);
  for (const d of tryDigits) {
    if (!(cands[i] & bit(d))) continue;
    for (const u of order) {
      const p = positionsIn(values, cands, u, d);
      if (p.length === 1) return yes(`Yes, ${cellName(i)} is the only place for a ${d} in ${unitName(unitInfo(u))}.`);
    }
  }
  if (!digits) return no(`No, every candidate of ${cellName(i)} still has another spot in its row, column and box.`);
  const d = digits[0];
  if (!(cands[i] & bit(d))) return no(`No, ${cellName(i)} can't be ${d}: ${whyNot(values, i, d)}.`);
  // One alternative spot per unit; group units that share the same spot.
  const alt = new Map();
  for (const u of order) {
    const other = positionsIn(values, cands, u, d).find((j) => j !== i);
    if (!alt.has(other)) alt.set(other, []);
    alt.get(other).push(unitName(unitInfo(u)));
  }
  const alts = [...alt].map(([j, names]) => `${cellName(j)} (${joinWords(names)})`);
  return no(`No, ${d} can also go in ${joinWords(alts)}.`);
}

function claimNakedPair(values, cands, cells, digits) {
  if (cells.length !== 2) return no('A naked pair is exactly two cells.');
  const [i, j] = cells;
  const shared = sharedUnits(i, j);
  if (!shared.length) return no(`${cellName(i)} and ${cellName(j)} don't share a row, column or box.`);
  let mask;
  if (digits) {
    if (digits.length !== 2) return no('A naked pair uses exactly two digits.');
    mask = maskOfDigits(digits);
  } else {
    mask = cands[i] | cands[j];
  }
  for (const k of [i, j]) {
    const extra = cands[k] & ~mask;
    if (extra) return no(`Not a pair: ${cellName(k)} can also be ${joinWords(digitsOf(extra), 'or')}.`);
  }
  if (popcount(mask) !== 2) {
    return no(`Not a pair: together ${cellName(i)} and ${cellName(j)} have ${popcount(mask)} candidates ${setText(digitsOf(mask))}, not 2.`);
  }
  for (const k of [i, j]) {
    if (cands[k] !== mask) {
      return no(`Not a pair: ${cellName(k)} can only be ${joinWords(digitsOf(cands[k]), 'or')}, so it's a single, not half of a pair.`);
    }
  }
  const ds = digitsOf(mask);
  const { elims } = nakedPairElims(values, cands, i, j, mask);
  const where = joinWords(shared.map((u) => unitName(unitInfo(u))));
  const effect = elims.length ? ` It removes ${elimText(elims)}.` : ` It doesn't remove anything right now.`;
  return yes(`Yes — ${cellName(i)} and ${cellName(j)} form a naked pair on ${setText(ds)} in ${where}.${effect}`);
}

function claimHiddenPair(values, cands, cells, digits) {
  if (cells.length !== 2) return no('A hidden pair is exactly two cells.');
  const [i, j] = cells;
  const shared = sharedUnits(i, j);
  if (!shared.length) return no(`${cellName(i)} and ${cellName(j)} don't share a row, column or box.`);
  if (digits && digits.length !== 2) return no('A hidden pair uses exactly two digits.');
  const fits = (u, d) => !unitHas(values, u, d) && sameSet(positionsIn(values, cands, u, d), cells);
  const report = (u, a, b) => {
    const keep = bit(a) | bit(b);
    const elims = [];
    for (const k of cells) for (const d of digitsOf(cands[k] & ~keep)) elims.push([k, d]);
    const effect = elims.length ? ` It removes ${elimText(elims)}.` : ` It doesn't remove anything right now.`;
    return yes(`Yes — in ${unitName(unitInfo(u))}, ${a} and ${b} only fit in ${cellName(i)} and ${cellName(j)}: a hidden pair.${effect}`);
  };
  if (!digits) {
    for (const u of shared) {
      const ok = [];
      for (let d = 1; d <= 9; d++) if (fits(u, d)) ok.push(d);
      if (ok.length >= 2) return report(u, ok[0], ok[1]);
    }
    return no(`No two digits are limited to just ${cellName(i)} and ${cellName(j)} in a unit they share.`);
  }
  const [a, b] = digits;
  for (const u of shared) if (fits(u, a) && fits(u, b)) return report(u, a, b);
  // Explain the first problem, using the first shared unit.
  for (const d of digits) for (const k of cells) {
    if (!(cands[k] & bit(d))) return no(`Not a hidden pair: ${cellName(k)} can't be ${d}.`);
  }
  const u = shared[0];
  for (const d of digits) {
    const other = positionsIn(values, cands, u, d).filter((k) => !cells.includes(k));
    if (other.length) return no(`Not a hidden pair: in ${unitName(unitInfo(u))}, ${d} can also go in ${listCells(other, 'or')}.`);
  }
  return no('Not a hidden pair.');
}

/** Pointing (cells = all d-spots of a box, in one line) or claiming (all d-spots of a line, in one box). */
function claimLocked(values, cands, cells, digits, tech) {
  if (cells.length < 2) return no(`A ${tech} pattern needs at least two cells (one cell would be a single).`);
  const sameRow = cells.every((k) => rowOf(k) === rowOf(cells[0]));
  const sameCol = cells.every((k) => colOf(k) === colOf(cells[0]));
  const sameBox = cells.every((k) => boxOf(k) === boxOf(cells[0]));
  if (!sameBox) return no('Those cells are not all in one box.');
  if (!sameRow && !sameCol) return no('Those cells are not all in one row or column.');
  const boxU = 18 + boxOf(cells[0]);
  const lineU = sameRow ? rowOf(cells[0]) : 9 + colOf(cells[0]);
  // pointing: the box is the "source" unit and the line is the target; claiming is the reverse.
  const [srcU, dstU] = tech === 'pointing' ? [boxU, lineU] : [lineU, boxU];
  let common = ALL;
  for (const k of cells) common &= cands[k];
  const tryDigits = digits ?? digitsOf(common);
  if (!tryDigits.length) return no('Those cells have no candidate in common.');
  const src = unitName(unitInfo(srcU));
  const dst = unitName(unitInfo(dstU));
  let firstFail = null;
  for (const d of tryDigits) {
    let fail = null;
    const lacking = cells.find((k) => !(cands[k] & bit(d)));
    if (lacking !== undefined) fail = `${cellName(lacking)} can't be ${d}.`;
    else {
      const other = positionsIn(values, cands, srcU, d).filter((k) => !cells.includes(k));
      if (other.length) fail = `in ${src}, ${d} can also go in ${listCells(other, 'or')}.`;
    }
    if (!fail) {
      const srcSet = new Set(units[srcU]);
      const elims = positionsIn(values, cands, dstU, d).filter((k) => !srcSet.has(k)).map((k) => [k, d]);
      const effect = elims.length ? ` It removes ${elimText(elims)}.` : ` It doesn't remove anything right now.`;
      return yes(`Yes — in ${src}, every ${d} is in ${dst}, so ${d} can go nowhere else in ${dst}.${effect}`);
    }
    firstFail ??= fail;
  }
  return no(`Not ${tech === 'pointing' ? 'a pointing pattern' : 'a claiming pattern'}: ${firstFail}`);
}
