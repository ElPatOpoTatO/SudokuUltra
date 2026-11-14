// token.js — the SDK1 board codec (scrambled + CRC32-checksummed), board
// pack/unpack and the per-puzzle autosave. Step 9: the token sheet UI moved to
// backup.js (the SDK2 backup code); SDK1 stays the local per-puzzle save format.
// Moved verbatim from the feel prototype (section 12). Changes: the save key
// is per puzzle id, byte 1 of the payload tags the puzzle, and the
// `refresh = function(){...scheduleSave()}` patch is a refresh hook.
import { S, UI, checkDeadEnd } from './state.js';
import { renderAll, refresh, hooks } from './board.js';
import { FX } from './particles.js';
import { hideToast, showToast, showDeadEnd, hideDeadEnd } from './actions.js';
import { cancelAllPresses } from './input.js';
import { seal, unseal, squeeze, puzzleTag as codecTag } from './tokencodec.js';

/* =========================================================================
   12. PROGRESS TOKEN (scrambled + checksummed) + AUTOSAVE
   Format: "SDK1." + base64url( salt | scramble( payload | crc32 ) )
   SDK1 is now only the per-puzzle LOCAL save format (sudoku.save.v1.<id>);
   the backup code the player copies is SDK2 (tokenformat.js, backup.js).
   The envelope lives in tokencodec.js (shared with SDK2). The salt stays
   random here, exactly as in the prototype.
   ========================================================================= */
export const Token = (() => {
  const PREFIX = 'SDK1.';
  function encode(payload) { return seal(PREFIX, payload, (Math.random() * 256) | 0); }
  function decode(token) {                // returns payload bytes or throws
    const t = squeeze(token);
    if (!t.startsWith(PREFIX)) throw new Error('This is not a sudoku progress token.');
    try { return unseal(t.slice(PREFIX.length)); }
    catch (e) { throw new Error('The token is damaged or was edited. Copy it again.'); }
  }
  return { encode, decode };
})();

/* Board <-> bytes. In the real game this packs campaign progress instead.
   Byte 1 is a one-byte tag of the puzzle id (the prototype puzzle "proto" is 0,
   so prototype tokens still load); unpack also checks the givens. */
const SAVE_VER = 1;
export function puzzleTag(id = S.id) { return codecTag(id); }
export function packState() {
  const PUZZLE_ID = puzzleTag();
  const b = new Uint8Array(5 + 41 + 162);
  b[0] = SAVE_VER; b[1] = PUZZLE_ID;
  b[2] = S.mistakes >>> 8 & 0xFF; b[3] = S.mistakes & 0xFF;
  b[4] = S.solved ? 1 : 0;
  for (let i = 0; i < 81; i++) b[5 + (i >> 1)] |= (S.values[i] & 0xF) << ((i & 1) ? 0 : 4);
  for (let i = 0; i < 81; i++) { b[46 + i * 2] = S.notes[i] >>> 8; b[47 + i * 2] = S.notes[i] & 0xFF; }
  return b;
}
export function unpackState(b) {
  const PUZZLE_ID = puzzleTag();
  if (b.length !== 208 || b[0] !== SAVE_VER) throw new Error('This token is from a different version.');
  if (b[1] !== PUZZLE_ID) throw new Error('This token is for a different puzzle.');
  const values = new Int8Array(81), notes = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    const v = (b[5 + (i >> 1)] >> ((i & 1) ? 0 : 4)) & 0xF;
    if (v > 9 || (S.given[i] && v !== S.given[i])) throw new Error('The token does not match this puzzle.');
    values[i] = v;
    const n = (b[46 + i * 2] << 8) | b[47 + i * 2];
    if (n > 0x1FF) throw new Error('The token is damaged.');
    notes[i] = v ? 0 : n;
  }
  return { values, notes, mistakes: (b[2] << 8) | b[3], solved: b[4] === 1 };
}
export function applyState(st) {
  cancelAllPresses(); hideToast(); hideDeadEnd(); FX.clear();
  UI.mistHeld = 0; UI.mistGen++;
  S.values.set(st.values); S.notes.set(st.notes);
  S.mistakes = st.mistakes; S.solved = st.solved;
  S.selected = -1; S.loaded = 0; S.loadedNote = false; S.pencil = false; S.undo = [];
  if (st.meta) applyMeta(st.meta);
  renderAll(); refresh();
  if (checkDeadEnd()) { showDeadEnd(); refresh(); }
  if (S.solved) showToast();
}

/* Autosave on this device (best effort: storage can be missing or blocked).
   One save per puzzle id: the SDK1 token of the board, plus a small JSON with
   what the token cannot hold (hidden silentWrong, Spot it progress). */
const SAVE_PREFIX = 'sudoku.save.v1.', META_PREFIX = 'sudoku.meta.v1.';
let saveTimer = 0;
function packMeta() {
  const m = { silentWrong: S.silentWrong };
  /* --- hints --- */ m.paidHints = S.paidHints; /* --- end hints --- */
  if (S.spot) { m.erased = [...S.spot.erased]; m.found = S.spot.found ? S.spot.steps.indexOf(S.spot.found) : -1; }
  return m;
}
function applyMeta(m) {
  S.silentWrong = m.silentWrong | 0;
  /* --- hints --- */ S.paidHints = m.paidHints | 0; /* --- end hints --- */
  if (S.spot) {
    S.spot.erased = new Set(Array.isArray(m.erased) ? m.erased : []);
    S.spot.found = m.found >= 0 ? S.spot.steps[m.found] || null : null;
  }
}
export function saveNow() {
  if (!S.id) return;
  try {
    localStorage.setItem(SAVE_PREFIX + S.id, Token.encode(packState()));
    localStorage.setItem(META_PREFIX + S.id, JSON.stringify(packMeta()));
  } catch (e) {}
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
/* Flush the pending save of the current puzzle before switching away. */
export function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveNow(); } }
export function loadSaved() {
  try {
    const t = localStorage.getItem(SAVE_PREFIX + S.id);
    if (t) {
      const st = unpackState(Token.decode(t));
      try { st.meta = JSON.parse(localStorage.getItem(META_PREFIX + S.id) || 'null'); } catch (e) {}
      applyState(st);
      return true;
    }
  } catch (e) {}
  return false;
}
export function hasSave(id) { try { return !!localStorage.getItem(SAVE_PREFIX + id); } catch (e) { return false; } }

/* Pack any board (not just the one on screen) into the SDK1 save payload. */
export function packBoard(id, values, notes, mistakes, solved) {
  const b = new Uint8Array(5 + 41 + 162);
  b[0] = SAVE_VER; b[1] = codecTag(id);
  b[2] = mistakes >>> 8 & 0xFF; b[3] = mistakes & 0xFF;
  b[4] = solved ? 1 : 0;
  for (let i = 0; i < 81; i++) b[5 + (i >> 1)] |= (values[i] & 0xF) << ((i & 1) ? 0 : 4);
  for (let i = 0; i < 81; i++) { const n = values[i] ? 0 : notes[i]; b[46 + i * 2] = n >>> 8; b[47 + i * 2] = n & 0xFF; }
  return b;
}
/* Write a puzzle's local save (board + meta) without touching the screen. */
export function writeSave(id, board, meta) {
  try {
    localStorage.setItem(SAVE_PREFIX + id, Token.encode(packBoard(id, board.values, board.notes, board.mistakes | 0, !!board.solved)));
    localStorage.setItem(META_PREFIX + id, JSON.stringify(meta || {}));
  } catch (e) {}
}
export function removeSave(id) { try { localStorage.removeItem(SAVE_PREFIX + id); localStorage.removeItem(META_PREFIX + id); } catch (e) {} }
/* Read a puzzle's local save: { values, notes, mistakes, solved, meta } or null.
   `given` (81 digits) is checked like unpackState does for the board on screen. */
export function readSave(id, given) {
  try {
    const t = localStorage.getItem(SAVE_PREFIX + id);
    if (!t) return null;
    const b = Token.decode(t);
    if (b.length !== 208 || b[0] !== SAVE_VER || b[1] !== codecTag(id)) return null;
    const values = new Array(81), notes = new Array(81);
    for (let i = 0; i < 81; i++) {
      const v = (b[5 + (i >> 1)] >> ((i & 1) ? 0 : 4)) & 0xF;
      if (v > 9 || (given && given[i] && v !== given[i])) return null;
      const n = (b[46 + i * 2] << 8) | b[47 + i * 2];
      values[i] = v; notes[i] = v || n > 0x1FF ? 0 : n;
    }
    let meta = null;
    try { meta = JSON.parse(localStorage.getItem(META_PREFIX + id) || 'null'); } catch (e) {}
    return { values, notes, mistakes: (b[2] << 8) | b[3], solved: b[4] === 1, meta: meta || {} };
  } catch (e) { return null; }
}
/* step 9: the Backup code sheet lives in backup.js; modules that backup.js imports reach it here. */
export const sheetHooks = { open: null };
/* Drop a pending (debounced) save without writing it. */
export function cancelSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; } }

export function initToken() {
  hooks.afterRefresh = scheduleSave;
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
}
