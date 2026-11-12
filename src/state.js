// state.js — game state, undo, and the rules (no DOM).
//
// Rules (from the spec):
// - Campaign / Free default = "conflicts only": a digit that visibly clashes
//   with a peer is a mistake (the prototype's shake/red/chip/counter). A wrong
//   digit with no visible clash is not shown; it only bumps `silentWrong`.
// - Dead end: after each placement, solver.isDeadEnd(values). If the board can
//   no longer be completed (and there is no visible clash, which already has
//   its own feedback), the banner offers Rewind: back to the latest undo
//   snapshot where every placed digit is correct. +1 mistake for the dead end.
// - Pencil marks are never mistakes.
// - Spot it: instant feedback. A placed digit that differs from the solution is
//   shown as wrong at once; erasing a candidate that is the cell's solution is a
//   mistake (and the note is put back). The target is found when the player
//   performs any valid step of the world's techniques (see spotProgress).
import { PEERS, bit } from './util.js';
import { isDeadEnd, allSteps } from './solver.js';
import { ALLOW, WORLD_TECHS } from './shared.js';

/* =========================================================================
   3. STATE + UNDO
   ========================================================================= */
export const S = {
  values: new Int8Array(81),
  notes: new Uint16Array(81),
  selected: -1,        // cell-first selection
  loaded: 0,           // number-first loaded digit
  loadedNote: false,   // loaded via long-press → taps write notes
  pencil: false,
  mistakes: 0,
  solved: false,       // free play: puzzle complete; Spot it: target found
  undo: [],
  pending: null,       // provisional placement awaiting release: {i, d, pressId}

  // current puzzle (set by game.js startPuzzle)
  id: '',
  mode: 'free',        // 'free' | 'spot'
  kind: '',            // 'proto' | 'useIt' | 'master' | 'quick' | 'daily' | 'spotIt'
  world: -1,
  given: new Int8Array(81),       // locked cells (Spot it: every filled cell of the snapshot)
  sol: new Int8Array(81),
  startNotes: new Uint16Array(81),
  silentWrong: 0,      // wrong digits without a visible clash (never shown)
  deadEnd: false,      // dead-end banner showing
  spot: null           // Spot it: { steps: [...], erased: Set<cell*10+digit> }
};

/* Transient UI flags shared across modules (not saved). */
export const UI = {
  mistHeld: 0,         // mistakes whose chip is still flying to the counter
  mistGen: 0,
  sheetOpen: false     // token sheet or dev sheet open: keyboard goes to the sheet
};

export function snapshot() { return { v: S.values.slice(), n: S.notes.slice(), solved: S.solved }; }
export function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 400) S.undo.shift(); }
export function restore(snap) { S.values.set(snap.v); S.notes.set(snap.n); S.solved = snap.solved; }

export function conflictAt(i) {
  const v = S.values[i];
  if (!v) return false;
  for (const j of PEERS[i]) if (S.values[j] === v) return true;
  return false;
}
export function countOf(d) { let n = 0; for (let i = 0; i < 81; i++) if (S.values[i] === d) n++; return n; }
export const isLocked = d => countOf(d) >= 9;

/* Spot it shows wrong digits at once (styled like a conflict). */
export const wrongAt = i => S.mode === 'spot' && !!S.values[i] && !S.given[i] && S.values[i] !== S.sol[i];

export function isSolvedBoard() {
  for (let k = 0; k < 81; k++) if (S.values[k] !== S.sol[k]) return false;
  return true;
}

/* ---- dead end ---------------------------------------------------------- */
/* Banner-worthy dead end: cannot be completed, but nothing clashes visibly. */
export function checkDeadEnd() {
  if (S.mode !== 'free' || S.solved) return false;
  for (let i = 0; i < 81; i++) if (conflictAt(i)) return false;
  return isDeadEnd(S.values);
}

const allCorrect = v => { for (let i = 0; i < 81; i++) if (v[i] && v[i] !== S.sol[i]) return false; return true; };

/* Latest undo snapshot whose placed digits are all correct. Returns
   {index, values, notes}; index -1 means "back to the givens" (stack exhausted). */
export function rewindTarget() {
  for (let k = S.undo.length - 1; k >= 0; k--) {
    if (allCorrect(S.undo[k].v)) return { index: k, values: S.undo[k].v, notes: S.undo[k].n };
  }
  return { index: -1, values: Int8Array.from(S.given), notes: S.startNotes.slice() };
}

/* Notes after a rewind: notes made after the target are kept where still valid
   (cell empty in the rewound board and no peer holds that digit). */
export function rewindNotes(values, oldNotes) {
  const out = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    if (values[i]) continue;
    let m = S.values[i] ? oldNotes[i] : S.notes[i];
    for (const j of PEERS[i]) if (values[j]) m &= ~bit(values[j]);
    out[i] = m;
  }
  return out;
}

/* ---- Spot it ----------------------------------------------------------- */
/* Every valid step of the target world's techniques on the starting board. */
export function spotSteps(values, cands, world) {
  const target = new Set(WORLD_TECHS[world]);
  const out = [];
  for (const st of allSteps(values, cands, ALLOW[world])) if (target.has(st.tech)) out.push(st);
  return out;
}

/* Is (i, d) a placement of some valid step? */
export function spotPlacementHit(i, d) {
  return S.spot.steps.find(st => st.place && st.place.cell === i && st.place.digit === d) || null;
}

/* Elimination target found: every elimination of some valid step was erased by
   the player and is still erased. */
export function spotEliminationHit() {
  const E = S.spot.erased;
  return S.spot.steps.find(st => !st.place && st.eliminate.length &&
    st.eliminate.every(([c, d]) => E.has(c * 10 + d) && !S.values[c] && !(S.notes[c] & bit(d)))) || null;
}

