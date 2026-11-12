// input.js — the press system (pointerdown = action, release = upstroke),
// pointer + keyboard input, long-press, cell-first / number-first, pencil.
// Moved verbatim from the feel prototype (digit key, cells, sections 9-10).
// Listeners are registered by initInput() (called once from main.js).
import { $, rowOf, colOf, LONG_MS, haptic } from './util.js';
import { sfx } from './audio.js';
import { S, UI, isLocked } from './state.js';
import { boardEl, refresh, animReach } from './board.js';
import { digitKeys, keys, buildPad } from './pad.js';
import { FX } from './particles.js';
import {
  toggleNote, placeProvisional, clearCell, finalizePending, convertPendingToNote,
  togglePencil, doErase, doUndo, release, resetGame
} from './actions.js';

/* ---- Digit key ------------------------------------------------------- */
function digitDown(d, pressId) {
  if (S.solved) { sfx.blocked(); return 'none'; }
  const sel = S.selected;

  // Cell-first: a cell is selected and nothing is loaded
  if (sel >= 0 && !S.loaded) {
    if (S.given[sel]) { sfx.blocked(); return 'none'; }
    if (S.pencil) {
      if (toggleNote(sel, d)) { sfx.pencil(); return 'note'; }
      sfx.blocked(); return 'none';
    }
    if (S.values[sel] === d) { clearCell(sel); sfx.pen(); return 'clear'; }
    if (isLocked(d)) { sfx.blocked(); return 'none'; }
    sfx.pen();
    placeProvisional(sel, d, pressId);
    return 'place';
  }

  // Number-first: (un)load the digit
  if (S.loaded === d) {
    S.loaded = 0; S.loadedNote = false;
    S.pencil ? sfx.pencil() : sfx.pen();
    refresh(); return 'unload';
  }
  if (isLocked(d)) { sfx.blocked(); return 'none'; }
  S.loaded = d; S.loadedNote = false; S.selected = -1;
  S.pencil ? sfx.pencil() : sfx.pen();
  haptic(5);
  refresh(); FX.loadPulse(d); return 'load';
}

function digitLong(d, press) {
  if (S.pending && S.pending.pressId === press.id) { convertPendingToNote(); return; }
  // Number-first long-press: load the digit for notes instead
  if ((press.result === 'load' || press.result === 'unload') && !S.solved && !isLocked(d)) {
    S.loaded = d; S.loadedNote = true; S.selected = -1;
    sfx.pencil(); haptic(4); refresh();
  }
}

/* ---- Cells ----------------------------------------------------------- */
let lastTap = null;   // where the finger landed on the board (for the select ring)
function selectFx(i, x, y) { animReach(i); FX.ring(i, x, y); }
function cellDown(i, pressId) {
  if (S.solved) return;
  if (S.loaded) {
    const d = S.loaded;
    if (S.given[i]) { sfx.blocked(); return; }
    if (S.pencil || S.loadedNote) {
      if (toggleNote(i, d)) sfx.pencil(); else sfx.blocked();
      return;
    }
    if (S.values[i] === d) { clearCell(i); sfx.pen(); return; }
    sfx.pen();
    placeProvisional(i, d, pressId);
    return;
  }
  // No digit loaded → select / deselect
  S.selected = S.selected === i ? -1 : i;
  sfx.select();
  refresh();
  if (S.selected === i) selectFx(i, lastTap && lastTap.i === i ? lastTap.x : null, lastTap && lastTap.i === i ? lastTap.y : null);
}
function cellLong(i, press) {
  if (S.pending && S.pending.pressId === press.id) convertPendingToNote();
}

/* =========================================================================
   9. INPUT: PRESS SYSTEM (pointerdown = action, release = upstroke)
   ========================================================================= */
const presses = new Map();   // pressId → {id, el, timer, result}

export function pressStart(id, el, onDown, onLong) {
  if (presses.has(id)) pressEnd(id, true);
  finalizePending();                       // a new press settles any previous one
  if (el) el.classList.add('down');        // visual on this exact frame
  const p = { id, el, timer: 0, result: null };
  presses.set(id, p);
  p.result = onDown(id);
  if (onLong) p.timer = setTimeout(() => { p.timer = 0; if (presses.get(id) === p) onLong(p); }, LONG_MS);
}
export function pressEnd(id, silent) {
  const p = presses.get(id);
  if (!p) return;
  presses.delete(id);
  clearTimeout(p.timer);
  if (p.el) {
    p.el.classList.remove('down');
    if (!silent && p.el.classList.contains('key')) sfx.release();
  }
  if (S.pending && S.pending.pressId === id) finalizePending();
}
export function cancelAllPresses() { for (const id of [...presses.keys()]) pressEnd(id, true); finalizePending(); }

export function bindPress(el, onDown, onLong) {
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    sfx.unlock();
    pressStart('p' + e.pointerId, el, onDown, onLong);
  });
}

// Header buttons
export function bindHeaderBtn(el, fn) {
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault(); sfx.unlock();
    pressStart('p' + e.pointerId, el, fn, null);
  });
}

/* Pad keys: same handlers the prototype bound inside buildPad(). */
export function buildBoundPad() {
  buildPad((el, kind, d) => {
    if (kind === 'digit') bindPress(el, id => digitDown(d, id), p => digitLong(d, p));
    if (kind === 'undo')   bindPress(el, () => { doUndo(); });
    if (kind === 'erase')  bindPress(el, () => { doErase(); });
    if (kind === 'pencil') bindPress(el, () => { togglePencil(); });
  });
}

export function initInput() {
  // Board: one delegated listener
  boardEl.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const cellEl = e.target.closest('.cell');
    if (!cellEl) return;
    e.preventDefault();
    sfx.unlock();
    const i = +cellEl.dataset.i;
    lastTap = { i, x: e.clientX, y: e.clientY };
    pressStart('p' + e.pointerId, null, id => cellDown(i, id), p => cellLong(i, p));
  });

  // Release anywhere (finger can slide off the key)
  window.addEventListener('pointerup', e => pressEnd('p' + e.pointerId));
  window.addEventListener('pointercancel', e => pressEnd('p' + e.pointerId, true));
  window.addEventListener('blur', cancelAllPresses);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAllPresses(); });

  // Tap on empty space → release loaded digit / deselect
  document.addEventListener('pointerdown', e => {
    sfx.unlock();
    if (e.target.closest('.board, .pad, .hbtn, .toast, .sheet, .sheet-bg, .pid, .dead')) return;
    release();
  });

  // Extra unlock hooks: some iOS versions only honor touchend/click as a gesture
  ['touchend', 'click', 'keydown'].forEach(t => document.addEventListener(t, () => sfx.unlock(), { passive: true }));
  // Kill iOS pinch / double-tap zoom and long-press menus
  ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu'].forEach(t => document.addEventListener(t, e => { if (!(e.target.closest && e.target.closest('textarea'))) e.preventDefault(); }));
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  const muteBtn = $('muteBtn');
  bindHeaderBtn(muteBtn, () => {
    sfx.setMuted(!sfx.muted);
    muteBtn.classList.toggle('muted', sfx.muted);
    if (!sfx.muted) sfx.select();
  });
  bindHeaderBtn($('resetBtn'), () => { sfx.mod(); resetGame(); });

  /* =========================================================================
     10. INPUT: DESKTOP KEYBOARD (same press system, so long-hold works too)
     ========================================================================= */
  document.addEventListener('keydown', e => {
    if (UI.sheetOpen) return;            // typing in the token sheet (or the dev sheet)
    if (e.repeat || e.altKey) return;
    const k = e.key, id = 'k' + e.code;
    if (/^[1-9]$/.test(k) && !e.metaKey && !e.ctrlKey) {
      const d = +k;
      pressStart(id, digitKeys[d].el, pid => digitDown(d, pid), p => digitLong(d, p));
    } else if (k === 'Backspace' || k === 'Delete' || k === '0') {
      e.preventDefault(); pressStart(id, keys.erase, doErase, null);
    } else if ((k === 'z' || k === 'Z') && (e.metaKey || e.ctrlKey) || k === 'u') {
      e.preventDefault(); pressStart(id, keys.undo, doUndo, null);
    } else if (k === 'p' || k === 'n') {
      pressStart(id, keys.pencil, togglePencil, null);
    } else if (k === 'Escape') {
      release();
    } else if (k.startsWith('Arrow') && !S.loaded && !S.solved) {
      e.preventDefault();
      let i = S.selected < 0 ? 40 : S.selected, r = rowOf(i), c = colOf(i);
      if (S.selected >= 0) {
        if (k === 'ArrowUp') r = (r + 8) % 9;
        if (k === 'ArrowDown') r = (r + 1) % 9;
        if (k === 'ArrowLeft') c = (c + 8) % 9;
        if (k === 'ArrowRight') c = (c + 1) % 9;
      }
      S.selected = r * 9 + c;
      sfx.select(); refresh(); selectFx(S.selected);
    }
  });
  document.addEventListener('keyup', e => pressEnd('k' + e.code));
}
