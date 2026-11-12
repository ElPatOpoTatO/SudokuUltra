// shared.js — definitions shared by the game (browser) and the offline
// pipeline (tools/pipeline-common.mjs re-exports these). Browser-safe: no Node APIs.
import { TECHNIQUES, TECH_INFO } from './solver.js';

export const WORLDS = [0, 1, 2, 3, 4];

/** WORLD_TECHS[w] = techniques taught in world w. */
export const WORLD_TECHS = WORLDS.map((w) => TECHNIQUES.filter((t) => TECH_INFO[t].world === w));

/** ALLOW[w] = cumulative techniques of worlds 0..w. Always a prefix of TECHNIQUES. */
export const ALLOW = WORLDS.map((w) => TECHNIQUES.filter((t) => TECH_INFO[t].world <= w));

// ---------------------------------------------------------------------------
// Daily rhythm. daily[i] is the puzzle for day offset i mod DAILY_COUNT, day 0
// is a Monday: Mon gentle, Tue/Wed easy, Thu/Fri medium, Sat/Sun tricky.
// The pipeline only fixes "day 0 is a Monday"; the game anchors day 0 to the
// Monday DAILY_EPOCH (local calendar date, no time zone maths).
// ---------------------------------------------------------------------------

export const BANDS = ['gentle', 'easy', 'medium', 'tricky'];
export const DAY_BANDS = ['gentle', 'easy', 'easy', 'medium', 'medium', 'tricky', 'tricky'];
export const DAILY_COUNT = 400;
export const dailyBand = (i) => DAY_BANDS[i % 7];
export const DAILY_EPOCH = [2026, 1, 5]; // Monday 5 January 2026 (year, month 1-12, day)

/** Daily index for a local calendar date (defaults to today on this device). */
export function dailyIndex(date = new Date()) {
  const [y, m, d] = DAILY_EPOCH;
  const day = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(y, m - 1, d)) / 864e5);
  return ((day % DAILY_COUNT) + DAILY_COUNT) % DAILY_COUNT;
}

// ---------------------------------------------------------------------------
// Candidate encoding: 81 bitmasks -> 243 hex chars (3 per cell)
// ---------------------------------------------------------------------------

export function encodeCands(cands) {
  let s = '';
  for (let i = 0; i < 81; i++) s += cands[i].toString(16).padStart(3, '0');
  return s;
}

export function decodeCands(str) {
  if (typeof str !== 'string' || str.length !== 243) throw new Error('cands string must have 243 hex chars');
  const c = new Uint16Array(81);
  for (let i = 0; i < 81; i++) c[i] = parseInt(str.slice(i * 3, i * 3 + 3), 16);
  return c;
}
