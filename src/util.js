// util.js — board geometry, tiny DOM helpers and shared constants.
// Moved verbatim from the feel prototype (sections 1, 2, 5 and `haptic`).

export const LONG_MS = 350;      // long-press threshold
export const RIPPLE_MS = 30;     // stagger between auto-cleanup notes

/* =========================================================================
   GEOMETRY (rows / cols / boxes / peers)
   ========================================================================= */
export const rowOf = i => (i / 9) | 0;
export const colOf = i => i % 9;
export const boxOf = i => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);
export const ROWS = [];
export const COLS = [];
export const BOXES = [];
for (let k = 0; k < 9; k++) {
  ROWS.push([]); COLS.push([]); BOXES.push([]);
}
for (let i = 0; i < 81; i++) {
  ROWS[rowOf(i)].push(i); COLS[colOf(i)].push(i); BOXES[boxOf(i)].push(i);
}
export const unitsOf = i => [ROWS[rowOf(i)], COLS[colOf(i)], BOXES[boxOf(i)]];
export const PEERS = [];        // PEERS[i] = array of peer indices
export const PEERFLAG = [];     // PEERFLAG[i][j] = 1 if j is a peer of i
for (let i = 0; i < 81; i++) {
  const flag = new Uint8Array(81);
  for (const u of unitsOf(i)) for (const j of u) if (j !== i) flag[j] = 1;
  PEERFLAG.push(flag);
  PEERS.push([...flag.keys()].filter(j => flag[j]));
}
export const bit = d => 1 << (d - 1);
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function dist(a, b) { return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)); }

/* Android-only haptics (iOS Safari has no vibrate API) */
export function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

export const $ = id => document.getElementById(id);
export function div(cls, parent) { const e = document.createElement('div'); e.className = cls; if (parent) parent.appendChild(e); return e; }

/* ?debug=1 turns on test hooks (sfx call log, window.__debug). Never on in normal play. */
export const DEBUG = (() => { try { return new URLSearchParams(location.search).get('debug') === '1'; } catch (e) { return false; } })();
