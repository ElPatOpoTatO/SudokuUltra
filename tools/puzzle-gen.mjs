// puzzle-gen.mjs — tiny seeded puzzle generator used by the tests.
// Random full grid by backtracking, then remove clues in 180°-symmetric pairs
// while the puzzle stays unique. Deterministic for a given seed.

import { countSolutions, peers } from '../src/solver.js';

/** mulberry32: small, fast, seeded PRNG returning floats in [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Random complete valid grid (Int8Array(81)). */
export function randomFullGrid(rng) {
  const g = new Int8Array(81);
  const ok = (i, d) => peers[i].every((j) => g[j] !== d);
  const fill = (i) => {
    if (i === 81) return true;
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
      if (!ok(i, d)) continue;
      g[i] = d;
      if (fill(i + 1)) return true;
    }
    g[i] = 0;
    return false;
  };
  fill(0);
  return g;
}

/** { puzzle, solution } — symmetric, unique, minimal w.r.t. symmetric pair removal. */
export function generatePuzzle(rng) {
  const solution = randomFullGrid(rng);
  const puzzle = Int8Array.from(solution);
  const order = shuffle([...Array(41).keys()], rng); // cell i pairs with 80 - i
  for (const i of order) {
    const j = 80 - i;
    const a = puzzle[i], b = puzzle[j];
    puzzle[i] = 0;
    puzzle[j] = 0;
    if (countSolutions(puzzle, 2) !== 1) {
      puzzle[i] = a;
      puzzle[j] = b;
    }
  }
  return { puzzle, solution };
}
