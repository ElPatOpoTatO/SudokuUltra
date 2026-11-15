// uistate.js — step 10: what the player has already SEEN on the non-board
// screens, so a bar or a counter animates only the part that is new (and only
// once). UI state only: its own localStorage key, never in the backup code.
//
//   sudoku.ui.v1 = { v: 1,
//     xp: {tier, inner, points}, total,           Home + map (expertise, total charges)
//     w: {world: earned}, wc: {world: earned},    level list world bar / the map's world card
//     lv: {levelId: best}, gate: {world: n},      level list pips / Master gate meter
//     mo: {world: masterOpen},                    the Master lock popping off
//     fm: {streak, days: [day], bands: {band: {solved, best}}},
//     pulse: world | null }                       the world key to pulse on the map
//
// With no stored state (first run of this version) everything is seeded from the
// current profile / Free Mode state, so nothing replays old progress.
import { getProfile, worldEarned, gateEarned, isMasterOpen, totals, WORLD_IDS } from './profile.js';
import { getFreeModeState } from './fmstore.js';
import { currentStreak, dayNumber } from './daily.js';
import { bandStats } from './quickplay.js';
import { BANDS } from './shared.js';

export const UI_KEY = 'sudoku.ui.v1';
let U = null;

export function fmSnapshot(st = getFreeModeState(), today = dayNumber(new Date())) {
  const bands = {};
  for (const b of BANDS) { const s = bandStats(st, b); bands[b] = { solved: s.solved, best: s.best }; }
  return { streak: currentStreak(st, today), days: Object.keys(st.daily.solved || {}).map(Number), bands };
}
function seed() {
  const p = getProfile(), w = {}, gate = {}, mo = {};
  for (const x of WORLD_IDS) { w[x] = worldEarned(x); gate[x] = gateEarned(x); mo[x] = isMasterOpen(x); }
  let fm = null;
  try { fm = fmSnapshot(); } catch (e) { fm = null; }
  return { v: 1, xp: { ...p.expertise }, total: totals().earned, w, wc: { ...w }, lv: { ...p.levels }, gate, mo, fm, pulse: null };
}
function load() {
  if (U) return U;
  try { U = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch (e) { U = null; }
  if (!U || U.v !== 1 || typeof U !== 'object') { U = seed(); save(); }
  for (const k of ['w', 'wc', 'lv', 'gate', 'mo']) if (!U[k] || typeof U[k] !== 'object') U[k] = {};
  return U;
}
let saveT = 0;
function save() { try { localStorage.setItem(UI_KEY, JSON.stringify(U)); } catch (e) {} }
/* writes are batched off the animation frame: one storage write per burst of seenSet calls */
function saveSoon() { if (saveT) return; saveT = setTimeout(() => { saveT = 0; save(); }, 400); }
window.addEventListener('pagehide', () => { if (saveT) { clearTimeout(saveT); saveT = 0; save(); } });

/** The value last seen under `key` (a top-level field, or 'field.sub'), or `dflt`. */
export function seenGet(key, dflt) {
  const u = load(), [a, b] = key.split('.');
  const v = b == null ? u[a] : u[a] && u[a][b];
  return v === undefined || v === null ? dflt : v;
}
export function seenSet(key, val) {
  const u = load(), [a, b] = key.split('.');
  if (b == null) u[a] = val; else { if (!u[a] || typeof u[a] !== 'object') u[a] = {}; u[a][b] = val; }
  saveSoon();
}
/** Re-read storage (tests). */
export function reloadSeen() { U = null; load(); }
/** A backup code was loaded or undone: the new state is not a gain, so nothing replays. */
export function reseedSeen() { U = seed(); save(); }
/** Debug / tests: the whole record. */
export const seenAll = () => JSON.parse(JSON.stringify(load()));
