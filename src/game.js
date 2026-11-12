// game.js — puzzle sessions: start / switch puzzles (free play or Spot it),
// restore the per-id autosave, the Next / Play again keycap.
import { $ } from './util.js';
import { sfx } from './audio.js';
import { S, spotSteps } from './state.js';
import { markGivens } from './board.js';
import { resetGame } from './actions.js';
import { bindPress } from './input.js';
import { flushSave, loadSaved } from './token.js';
import { boardFor, nextId, modeLabel, has } from './puzzles.js';

const pidEl = $('pid');
const LAST_KEY = 'sudoku.last';

/* --- level0: hooks for the Level 0 engine and the campaign runner (campaign.js, level0.js) --- */
// start: listeners called with the id before any puzzle starts; next: the toast
// keycap asks it first (return true = handled); label: header label override.
export const gameHooks = { start: [], next: null, label: null };
/* --- end level0 --- */

export function updatePid() {
  pidEl.innerHTML = /* --- level0 --- */ (gameHooks.label && gameHooks.label()) || /* --- end level0 --- */ `<b>DEV</b> · ${S.id} · ${modeLabel(S.id)}`;
}

/* Start (or switch to) a puzzle. `restore`: load this id's autosave if any. */
export function startPuzzle(id, restore = true) {
  const b = boardFor(id);
  if (!b || !b.sol) return false;
  /* --- level0 --- */ for (const f of gameHooks.start) f(id); /* --- end level0 --- */
  if (S.id && S.id !== id) flushSave();          // keep the puzzle we are leaving
  S.id = id; S.mode = b.mode; S.kind = b.kind; S.world = b.world;
  S.given.set(b.given); S.sol.set(b.sol); S.startNotes.set(b.notes);
  S.spot = b.mode === 'spot'
    ? { steps: spotSteps(b.values, b.notes, b.world), erased: new Set(), found: null, label: b.label, step: b.step }
    : null;
  markGivens();
  resetGame();
  if (restore) loadSaved();
  updatePid();
  try { localStorage.setItem(LAST_KEY, id); } catch (e) {}
  return true;
}

/* Puzzle to open at boot: #p=<id>, else the last one played, else the first gentle Quick Play. */
export function initialId() {
  const m = /[#&]p=([\w-]+)/.exec(location.hash);
  if (m && has(m[1])) return m[1];
  try { const last = localStorage.getItem(LAST_KEY); if (last && has(last)) return last; } catch (e) {}
  return 'q-gentle-001';
}

export function initGame() {
  // Toast keycap: "Play again" after a solve, "Next" after a Spot it
  bindPress($('againKey'), () => {
    sfx.mod();
    /* --- level0 --- */ if (gameHooks.next && gameHooks.next()) return; /* --- end level0 --- */
    if (S.mode === 'spot' && S.solved) startPuzzle(nextId(S.id));
    else resetGame();
  });
  window.addEventListener('hashchange', () => {
    const m = /[#&]p=([\w-]+)/.exec(location.hash);
    if (m && has(m[1]) && m[1] !== S.id) startPuzzle(m[1]);
  });
}
