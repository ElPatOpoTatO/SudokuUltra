// backup.js — step 9: the BACKUP CODE (SDK2) in the game. Builds a snapshot
// of everything from the per-module stores, applies a loaded code atomically
// (with Undo load), keeps one unified local snapshot up to date, and runs the
// Backup code sheet (header key icon, Settings → "Backup & restore", Home link).
// Format and validation: tokenformat.js; envelope: tokencodec.js; docs/token.md.
//
// Stores it reads and writes (their formats are unchanged):
//   sudoku.profile.v1 (profile.js)   sudoku.settings.v1 (settings.js)   sudoku.free.v1 (fmstore.js)
//   sudoku.save.v1.<id> / sudoku.meta.v1.<id> (token.js)                sudoku.lastctx / sudoku.last (progress.js)
// It adds one key: sudoku.backup.v2 = the latest backup code (the unified autosave snapshot).
import { $, div, DEBUG, reducedMotion } from './util.js';
import { sfx } from './audio.js';
import { S, UI } from './state.js';
import { hooks } from './board.js';
import { release } from './actions.js';
import { pressStart, cancelAllPresses, bindPress, bindHeaderBtn } from './input.js';
import { flushSave, cancelSave, readSave, writeSave, removeSave, sheetHooks } from './token.js';
import { DATA } from './puzzles-data.js';
import { boardFor, entry } from './puzzles.js';
import { getProfile, setProfile, onProfile, levelInfo, PROFILE_KEY } from './profile.js';
import { getSettings, setSettings, onSettings, isClassic, DEFAULTS, STORE_KEY as SETTINGS_KEY } from './settings.js';
import { getFreeModeState, setFreeModeState, onFreeModeState, FM_KEY } from './fmstore.js';
import { resetFreeSession, syncFreeMode, freeModeOpen, flushFreeClock } from './freemode.js';
import { clockHooks } from './events.js';
import { lastPlayed } from './home.js';
import { resumeAfterRestore } from './progress.js';
import { currentScreen } from './screens.js';
import { closeSettings } from './settingsui.js';
import { gameHooks } from './game.js';
import { SPARKS } from './sparks.js';
/* --- step10: the copy confirmation travels from the Copy key to the code box --- */
import { FX } from './particles.js';
/* --- end step10 --- */
import { makeFormat, messageFor } from './tokenformat.js';
import { puzzleTag } from './tokencodec.js';

export const F = makeFormat(DATA);
export const SNAPSHOT_KEY = 'sudoku.backup.v2';
const KEY_PREFIX = 'sudoku.';

/* =========================================================================
   SNAPSHOT: everything the code carries, read from the stores on demand
   ========================================================================= */
let sStale = false;          // after a load / undo with the board hidden, S still holds the old puzzle
function boardSource(id) {
  const b = boardFor(id);
  if (!b) return null;
  if (S.id === id && !sStale && (S.mode === 'free' || S.mode === 'spot')) {
    return { values: Array.from(S.values), notes: Array.from(S.notes), mistakes: S.mistakes, solved: S.solved,
      silentWrong: S.silentWrong, paidHints: S.paidHints, given: b.given, start: b.notes };
  }
  const sv = readSave(id, b.given);
  if (!sv) return null;
  return { values: sv.values, notes: sv.notes, mistakes: sv.mistakes, solved: sv.solved,
    silentWrong: sv.meta.silentWrong | 0, paidHints: sv.meta.paidHints | 0, given: b.given, start: b.notes };
}
/** The puzzle in progress (unsolved, with player input), or null. */
function boardInProgress(id, fm) {
  if (!id || !F.isShipped(id)) return null;
  const src = boardSource(id);
  if (!src || src.solved) return null;
  let input = src.mistakes > 0 || src.paidHints > 0;
  for (let i = 0; i < 81 && !input; i++) {
    if (src.values[i] && !src.given[i]) input = true;
    else if (!src.values[i] && (src.notes[i] & 0x1FF) !== (src.start[i] & 0x1FF)) input = true;
  }
  if (!input) return null;
  const live = clockHooks.ms ? clockHooks.ms(id) : null;          // a running Free Mode clock (Date.now based)
  const elapsed = typeof live === 'number' ? live : (fm.clock[id] || 0);
  return { values: src.values, notes: src.notes, mistakes: src.mistakes, paidHints: src.paidHints, silentWrong: src.silentWrong, elapsed };
}

export function snapshot() {
  const p = getProfile(), s = getSettings(), fm = getFreeModeState();
  const lp = lastPlayed();
  const last = lp && (F.isShipped(lp.id) || F.isL0(lp.id)) ? lp.id : '';
  const levels = {};
  for (const [id, c] of Object.entries(p.levels)) {
    const L = levelInfo(id);
    if (L && (L.k === 0 || c >= 1)) levels[id] = L.k === 0 ? 0 : c;
  }
  return {
    levels,
    skip: Object.keys(p.flags.skip || {}).filter(k => p.flags.skip[k]).map(Number),
    mastered: p.mastered.slice(), pendingBuild: (p.flags.pendingBuild || []).slice(),
    expertise: { ...p.expertise },
    fillNotes: !!p.unlocks.fillNotes, badge: !!p.flags.badge, devUnlockAll: !!p.flags.devUnlockAll,
    lastFree: p.flags.lastFree || '',
    settings: isClassic() ? { ...DEFAULTS, sound: s.sound, switchVol: s.switchVol } : { style: s.style, layout: s.layout, preset: s.preset, sound: s.sound, switchVol: s.switchVol },
    free: { played: fm.played, solved: fm.solved, best: fm.best, current: fm.current, feedback: fm.feedback, challenge: fm.challenge, daily: fm.daily },
    last,
    board: last ? boardInProgress(last, fm) : null
  };
}
export const currentCode = () => F.encode(snapshot());

/* =========================================================================
   APPLY (atomic) + UNDO
   ========================================================================= */
function captureStorage() {
  const m = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(KEY_PREFIX)) m[k] = localStorage.getItem(k); } } catch (e) {}
  return m;
}
function writeStorage(m) {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(KEY_PREFIX) && !(k in m)) drop.push(k); }
    for (const k of drop) localStorage.removeItem(k);
    for (const k of Object.keys(m)) localStorage.setItem(k, m[k]);
  } catch (e) {}
}
const boardShowing = () => !currentScreen() && !freeModeOpen();

/** Everything a load can change, so it can be put back. */
function capture() {
  flushSave();                  // the board on screen, as it is now
  flushFreeClock();             // a running Free Mode clock, as it is now
  return { storage: captureStorage(), profile: getProfile(), settings: getSettings(), free: getFreeModeState() };
}
function restore(prev) {
  cancelSave(); resetFreeSession();
  writeStorage(prev.storage);
  setProfile(prev.profile);
  if (prev.settings.style !== 'classic') setSettings(prev.settings);
  setFreeModeState(prev.free);
  writeStorage(prev.storage);   // exactly as it was (the setters may add keys)
  syncFreeMode();
  afterRestore();
}

function spotMeta(id, values, notes) {
  const b = boardFor(id), m = { silentWrong: 0, paidHints: 0 };
  if (b && b.mode === 'spot') {
    m.erased = [];
    for (let c = 0; c < 81; c++) if (!values[c]) for (let d = 1; d <= 9; d++) { const bt = 1 << (d - 1); if ((b.notes[c] & bt) && !(notes[c] & bt)) m.erased.push(c * 10 + d); }
    m.found = -1;
  }
  return m;
}
function setLast(id) {
  try {
    if (!id) { localStorage.removeItem('sudoku.lastctx'); localStorage.removeItem('sudoku.last'); return; }
    const L = levelInfo(id), ctx = L ? { id, world: L.world, k: L.k } : { id };
    localStorage.setItem('sudoku.lastctx', JSON.stringify(ctx));
    if (F.isShipped(id)) localStorage.setItem('sudoku.last', id);
  } catch (e) {}
}

function applyV2(snap) {
  const prof = {
    v: 1, levels: { ...snap.levels }, mastered: snap.mastered.slice(),
    expertise: { ...snap.expertise },
    unlocks: { fillNotes: snap.fillNotes, items: [] },
    flags: { skip: Object.fromEntries(snap.skip.map(w => [String(w), true])), clean: {}, badge: snap.badge, fresh: [],
      pendingBuild: snap.pendingBuild.slice(), devUnlockAll: snap.devUnlockAll, lastFree: snap.lastFree }
  };
  setProfile(prof);
  setSettings(snap.settings);
  const f = snap.free, clock = {};
  if (snap.board && F.isFreeId(snap.last)) clock[snap.last] = snap.board.elapsed;
  setFreeModeState({ v: 1, played: f.played, solved: f.solved, best: f.best, current: f.current, clock, daily: f.daily, feedback: f.feedback, challenge: f.challenge });
  if (snap.last && F.isShipped(snap.last)) {
    if (snap.board) {
      const b = snap.board, m = spotMeta(snap.last, b.values, b.notes);
      m.silentWrong = b.silentWrong; m.paidHints = b.paidHints;
      writeSave(snap.last, { values: b.values, notes: b.notes, mistakes: b.mistakes, solved: false }, m);
    } else removeSave(snap.last);       // nothing in progress there: start it fresh, like the other device
  }
  setLast(snap.last);
}
function applySdk1(board) {
  const m = spotMeta(board.id, board.values, board.notes);
  writeSave(board.id, board, m);
  setLast(board.id);
}

function afterRestore() {
  const show = boardShowing();
  sStale = !show;
  resumeAfterRestore(show);
}

let undoState = null;
/** Decode and apply a pasted code. Returns { ok, kind, message, code? }. */
export function loadCode(text) {
  let res;
  try { res = F.decode(text, { preferId: S.id }); }
  catch (e) { return { ok: false, code: e.code || 'damaged', message: messageFor(e) }; }
  cancelAllPresses();
  const prev = capture();
  cancelSave(); resetFreeSession();
  try {
    if (res.kind === 'v2') applyV2(res.snap); else applySdk1(res.board);
  } catch (e) {
    console.error(e);
    restore(prev);
    return { ok: false, code: 'damaged', message: messageFor(e) };
  }
  syncFreeMode();
  afterRestore();
  undoState = prev;
  writeSnapshot();
  return { ok: true, kind: res.kind,
    message: res.kind === 'v2' ? 'Loaded. Your progress, settings and puzzle are here.' : 'Puzzle loaded (an older code: only the board).' };
}
export function undoLoad() {
  if (!undoState) return false;
  const prev = undoState;
  undoState = null;
  restore(prev);
  writeSnapshot();
  return true;
}
export const canUndo = () => !!undoState;

/* =========================================================================
   UNIFIED AUTOSAVE: one snapshot (the current backup code) under
   sudoku.backup.v2, written 250 ms after any change and when the page hides.
   The per-module keys stay the source of truth; this is derived from them.
   (The board's own save keeps its separate 250 ms timer in token.js.)
   ========================================================================= */
let snapTimer = 0;
export function writeSnapshot() {
  if (snapTimer) { clearTimeout(snapTimer); snapTimer = 0; }
  try { localStorage.setItem(SNAPSHOT_KEY, currentCode()); } catch (e) {}
}
function scheduleSnapshot() { clearTimeout(snapTimer); snapTimer = setTimeout(writeSnapshot, 250); }

/* =========================================================================
   THE SHEET
   ========================================================================= */
let sheetEl, sheetBg, tokOut, tokIn, tokMsg, tokMeta, undoRow;
function say(text, kind) { tokMsg.textContent = text; tokMsg.className = 'msg' + (kind ? ' ' + kind : ''); }
function metaLine(snap, code) {
  const n = code.length;
  if (!snap.board) return `${n} characters`;
  const e = entry(snap.last), L = levelInfo(snap.last), cap = t => t ? t[0].toUpperCase() + t.slice(1) : '';
  const what = L ? `World ${L.world} · ${L.k <= 6 ? `Spot it ${L.k}` : L.k <= 12 ? `Use it ${L.k - 6}` : 'Master'}`
    : e && e.kind === 'quick' ? `Quick Play · ${cap(e.band)}` : e && e.kind === 'daily' ? `Daily · ${cap(e.item.band)}` : 'a puzzle';
  return `${n} characters · with ${what}`;
}
function fillCode() {
  const snap = snapshot(), code = F.encode(snap);
  tokOut.value = code;
  tokMeta.textContent = metaLine(snap, code);
}
export function openSheet() {
  cancelAllPresses(); release();
  closeSettings();
  fillCode();
  tokIn.value = ''; say('');
  undoRow.classList.toggle('show', canUndo());
  UI.sheetOpen = true; sheetEl.classList.add('show'); sheetBg.classList.add('show');
}
export function closeSheet() {
  UI.sheetOpen = false; sheetEl.classList.remove('show'); sheetBg.classList.remove('show');
  tokIn.blur(); tokOut.blur();
}

/* Load success: a bolt from the Load key into the sheet's header key icon. */
function loadEffect() {
  const ic = $('bkIcon'), lk = $('loadKey');
  const land = () => { ic.classList.remove('pop'); void ic.offsetWidth; ic.classList.add('pop'); SPARKS.crackle(ic, 10); };
  if (reducedMotion()) { land(); return; }
  document.body.classList.add('bk-fx');               // spark canvas above the sheet for a moment
  const life = SPARKS.bolt(lk, ic, { bow: 0.18, done: land });
  setTimeout(() => document.body.classList.remove('bk-fx'), life + 520);
}
/* step10: Copy → a short pulse leaves the Copy key and lands on the code box, which
   acknowledges with a ring (purpose: confirms exactly what was copied). */
export const BKFX = { copies: 0 };
let ackEl = null;
function copyFx() {
  BKFX.copies++;
  if (!ackEl) { ackEl = div('bk-ack', sheetEl); ackEl.setAttribute('aria-hidden', 'true'); }
  Object.assign(ackEl.style, { left: tokOut.offsetLeft + 'px', top: tokOut.offsetTop + 'px', width: tokOut.offsetWidth + 'px', height: tokOut.offsetHeight + 'px' });
  document.body.classList.add('fx-top');
  const flight = FX.carry($('copyKey'), tokOut);
  setTimeout(() => {
    ackEl.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 520, easing: 'ease-out' });
    sfx.noteTick(0, 3);
  }, flight);
  setTimeout(() => document.body.classList.remove('fx-top'), flight + 560);
}
function shake(el) {
  if (reducedMotion()) return;
  el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
    { duration: 260, easing: 'ease-out' });
}

function doLoad() {
  const r = loadCode(tokIn.value);
  if (!r.ok) { sfx.error(); say(r.message, 'bad'); shake(tokIn); undoRow.classList.toggle('show', canUndo()); return; }
  sfx.latch(0);
  say(r.message, 'ok');
  tokIn.value = '';
  fillCode();
  undoRow.classList.add('show');
  loadEffect();
}
function doUndo() {
  if (!undoLoad()) return;
  sfx.mod();
  fillCode();
  undoRow.classList.remove('show');
  say('Load undone. Everything is back as it was.', 'ok');
}

function buildSettingsRow(sheet) {
  if (sheet.querySelector('.set-bk')) return;
  const sec = div('set-sec set-bksec', null);
  sec.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Backup' }));
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'set-bk';
  b.innerHTML = `<span class="bk-ic" aria-hidden="true">${$('bkIcon').innerHTML}</span><span class="set-bk-t"><b>Backup &amp; restore</b><small>Move your progress to another device</small></span><span class="set-bk-ch" aria-hidden="true">›</span>`;
  b.setAttribute('aria-label', 'Backup and restore');
  b.addEventListener('click', () => { sfx.mod(); openSheet(); });
  sec.appendChild(b);
  const done = sheet.querySelector('.set-done');
  sheet.insertBefore(sec, done || null);
}
function buildHomeLink() {
  const top = document.querySelector('#home .home-top');
  if (!top || top.querySelector('.home-bk')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'home-bk';
  b.innerHTML = `<span class="bk-ic" aria-hidden="true">${$('bkIcon').innerHTML}</span>Backup`;
  b.setAttribute('aria-label', 'Backup code');
  b.addEventListener('click', () => { sfx.mod(); openSheet(); });
  top.appendChild(b);
}

/* Called once from main.js, last. */
export function initBackup() {
  sheetEl = $('sheet'); sheetBg = $('sheetBg'); tokOut = $('tokOut'); tokIn = $('tokIn'); tokMsg = $('tokMsg');
  tokMeta = $('tokMeta'); undoRow = $('undoRow');
  sheetHooks.open = openSheet;
  bindHeaderBtn($('tokenBtn'), () => { sfx.mod(); openSheet(); });
  sheetBg.addEventListener('pointerdown', e => { e.preventDefault(); closeSheet(); });
  bindPress($('closeKey'), () => { sfx.mod(); closeSheet(); });
  // Clipboard must run inside a click handler, so Copy listens to click too
  $('copyKey').addEventListener('pointerdown', e => { e.preventDefault(); sfx.unlock(); pressStart('p' + e.pointerId, $('copyKey'), () => sfx.mod(), null); });
  $('copyKey').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tokOut.value); say('Copied. Paste it in the other browser or device.', 'ok'); copyFx(); }
    catch (e) { tokOut.focus(); tokOut.select(); say('Copy was blocked here. The code is selected, copy it manually.', 'bad'); }
  });
  bindPress($('loadKey'), doLoad);
  bindPress($('undoKey'), doUndo);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetEl.classList.contains('show')) closeSheet(); });

  const s = document.getElementById('setSheet');
  if (s) buildSettingsRow(s);
  buildHomeLink();

  gameHooks.start.push(() => { sStale = false; });
  // unified autosave
  onProfile(scheduleSnapshot);
  onSettings(scheduleSnapshot);
  onFreeModeState(scheduleSnapshot);
  const prev = hooks.afterRefresh;
  hooks.afterRefresh = () => { if (prev) prev(); scheduleSnapshot(); };
  window.addEventListener('pagehide', writeSnapshot);
  document.addEventListener('visibilitychange', () => { if (document.hidden) writeSnapshot(); });
  scheduleSnapshot();

  if (DEBUG) {
    window.__debug = window.__debug || {};
    window.__debug.backup = { F, tag: puzzleTag, snapshot, currentCode, loadCode, undoLoad, canUndo, openSheet, closeSheet, writeSnapshot, SNAPSHOT_KEY,
      keys: { PROFILE_KEY, SETTINGS_KEY, FM_KEY } };
  }
}
