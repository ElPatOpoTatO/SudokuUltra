// pipeline-common.mjs — shared definitions for the offline puzzle pipeline.
// Used by tools/generate.mjs (to build the stock) and tools/validate-puzzles.mjs
// (to re-check it). Keep the classification rules here so both agree on them.

import { TECH_INFO } from '../src/solver.js';
// Worlds, ALLOW, daily rhythm and the cands encoding live in src/shared.js so the
// game (browser) uses exactly the same definitions. Re-exported here unchanged.
import { WORLDS, WORLD_TECHS, ALLOW, BANDS, DAY_BANDS, DAILY_COUNT, dailyBand, encodeCands, decodeCands } from '../src/shared.js';
export { WORLDS, WORLD_TECHS, ALLOW, BANDS, DAY_BANDS, DAILY_COUNT, dailyBand, encodeCands, decodeCands };

// ---------------------------------------------------------------------------
// Worlds and allowed technique sets
// ---------------------------------------------------------------------------

export const worldOfTech = (tech) => TECH_INFO[tech].world;

/** Per-world and per-technique step counts of a step list. */
export function countSteps(steps) {
  const byWorld = [0, 0, 0, 0, 0];
  const byTech = {};
  for (const s of steps) {
    byWorld[TECH_INFO[s.tech].world]++;
    byTech[s.tech] = (byTech[s.tech] || 0) + 1;
  }
  return { byWorld, byTech };
}

export const clueCount = (givens) => {
  let n = 0;
  for (let i = 0; i < 81; i++) if (givens[i] && givens[i] !== '0' && givens[i] !== '.') n++;
  return n;
};

// ---------------------------------------------------------------------------
// Pool rules. `s` is a stats object:
//   { solved1: bool   (solvable with ALLOW[1]),
//     world: number|null (world the puzzle belongs to; null = needs > W4),
//     byWorld, byTech  (counts in the solve that defines the world),
//     steps, clues }
// For world w >= 1, `byWorld/byTech/steps` come from the ALLOW[w] solve, which
// is identical to the full solve for a puzzle that belongs to w.
// ---------------------------------------------------------------------------

const fhShare = (s) => (s.byTech['full-house'] || 0) / Math.max(1, s.steps);
const fhHsbShare = (s) => ((s.byTech['full-house'] || 0) + (s.byTech['hidden-single-box'] || 0)) / Math.max(1, s.steps);

/** targetUses for a campaign puzzle of world w (W0 counts full houses). */
export const targetUses = (w, s) => s.byWorld[w];

export const RULES = {
  0: {
    // Near-complete grid, carried by full houses.
    use: (s) => s.solved1 && s.clues >= 56 && s.clues <= 71 && fhShare(s) >= 0.7 && s.byWorld[0] >= 1,
    // Easy full puzzle (36-40 clues) carried by full house + hidden single (box).
    master: (s) => s.solved1 && s.clues >= 36 && s.clues <= 40 && fhHsbShare(s) >= 0.9 && s.byWorld[0] >= 3,
    useText: 'solvable with W0+W1, >= 70% of steps are full house, 10-25 empty cells',
    masterText: 'solvable with W0+W1, 36-40 clues, >= 90% of steps are full house or hidden single (box), >= 3 full houses',
  },
  1: {
    use: (s) => s.world === 1 && s.clues >= 38 && s.clues <= 46 && (s.byTech['hidden-single-line'] || 0) >= 1,
    master: (s) => s.world === 1 && s.clues <= 30 && s.byWorld[1] >= 20 && (s.byTech['hidden-single-line'] || 0) >= 4 && s.byWorld[0] >= 1,
    useText: 'belongs to W1, 38-46 clues, >= 1 hidden single (row/column)',
    masterText: 'belongs to W1, <= 30 clues, >= 20 hidden singles of which >= 4 row/column, >= 1 full house',
  },
  2: {
    use: (s) => s.world === 2 && s.clues >= 26 && s.clues <= 36 && s.byWorld[2] >= 1 && s.byWorld[2] <= 3,
    master: (s) => s.world === 2 && s.clues <= 30 && s.byWorld[2] >= 6 && s.byWorld[1] >= 1,
    useText: 'belongs to W2, 26-36 clues, 1-3 naked singles',
    masterText: 'belongs to W2, <= 30 clues, >= 6 naked singles',
  },
  3: {
    use: (s) => s.world === 3 && s.clues <= 36 && s.byWorld[3] >= 1 && s.byWorld[3] <= 3,
    master: (s) => s.world === 3 && s.clues <= 30 && s.byWorld[3] >= 3 && s.byWorld[2] >= 1,
    useText: 'belongs to W3, 1-3 pointing/claiming steps',
    masterText: 'belongs to W3, <= 30 clues, >= 3 pointing/claiming steps, >= 1 naked single',
  },
  4: {
    use: (s) => s.world === 4 && s.clues <= 36 && s.byWorld[4] >= 1 && s.byWorld[4] <= 3,
    master: (s) => s.world === 4 && s.clues <= 30 && s.byWorld[4] >= 3 && s.byWorld[3] >= 1,
    useText: 'belongs to W4, 1-3 pair steps',
    masterText: 'belongs to W4, <= 30 clues, >= 3 pair steps, >= 1 pointing/claiming step',
  },
};

// ---------------------------------------------------------------------------
// Free Mode bands
// ---------------------------------------------------------------------------

/** Band of a puzzle from the world it belongs to (null if it needs > W4). */
export const bandOfWorld = (w) => (w === null ? null : w <= 1 ? 'gentle' : BANDS[w - 1]);
/** Clue-count window accepted per band (gentle gets extra clues). */
export const BAND_CLUES = { gentle: [28, 38], easy: [22, 36], medium: [17, 36], tricky: [17, 36] };

// ---------------------------------------------------------------------------
// Canonical form for deduplication
//
// Group used: 8 rotations/reflections (dihedral group of the square)
//   x 6 band permutations x 6 stack permutations  = 288 cell permutations,
// each followed by digit relabeling by first appearance (reading order).
// The canonical form is the lexicographically smallest resulting string.
// Not the full sudoku group (it skips row/column swaps inside a band/stack,
// which would multiply the work by 1296), but it catches every rotation,
// reflection, band/stack shuffle and relabeling of a puzzle.
// ---------------------------------------------------------------------------

const PERMS3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const DIHEDRAL = [
  (r, c) => [r, c],
  (r, c) => [c, 8 - r],
  (r, c) => [8 - r, 8 - c],
  (r, c) => [8 - c, r],
  (r, c) => [c, r],
  (r, c) => [8 - c, 8 - r],
  (r, c) => [r, 8 - c],
  (r, c) => [8 - r, c],
];

/** CANON_PERMS[t][target] = source cell. */
const CANON_PERMS = (() => {
  const out = [];
  for (const g of DIHEDRAL) for (const bp of PERMS3) for (const sp of PERMS3) {
    const perm = new Int8Array(81);
    for (let i = 0; i < 81; i++) {
      const [r1, c1] = g((i / 9) | 0, i % 9);
      const r2 = bp[(r1 / 3) | 0] * 3 + (r1 % 3);
      const c2 = sp[(c1 / 3) | 0] * 3 + (c1 % 3);
      perm[r2 * 9 + c2] = i;
    }
    out.push(perm);
  }
  return out;
})();

/** Canonical 81-char string ('0' = empty) of a givens string or array. */
export function canonical(givens) {
  const v = new Int8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = typeof givens === 'string' ? givens.charCodeAt(i) - 48 : givens[i];
    v[i] = ch >= 1 && ch <= 9 ? ch : 0;
  }
  let best = null;
  const cur = new Int8Array(81);
  const map = new Int8Array(10);
  for (const perm of CANON_PERMS) {
    map.fill(0);
    let next = 1;
    let state = best ? 0 : -1; // 0 = equal so far, -1 = already smaller, 1 = larger (abort)
    for (let i = 0; i < 81; i++) {
      const d = v[perm[i]];
      let x = 0;
      if (d) {
        if (!map[d]) map[d] = next++;
        x = map[d];
      }
      cur[i] = x;
      if (state === 0) {
        if (x < best[i]) state = -1;
        else if (x > best[i]) { state = 1; break; }
      }
    }
    if (state === -1) best = Int8Array.from(cur);
  }
  return Array.from(best).join('');
}
