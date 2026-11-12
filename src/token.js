// token.js — progress token codec (SDK1: scrambled + CRC32-checksummed),
// board pack/unpack, per-puzzle autosave, and the token sheet UI.
// Moved verbatim from the feel prototype (section 12). Changes: the save key
// is per puzzle id, byte 1 of the payload tags the puzzle, and the
// `refresh = function(){...scheduleSave()}` patch is a refresh hook.
import { $ } from './util.js';
import { sfx } from './audio.js';
import { S, UI, checkDeadEnd } from './state.js';
import { renderAll, refresh, hooks } from './board.js';
import { FX } from './particles.js';
import { hideToast, showToast, release, showDeadEnd, hideDeadEnd } from './actions.js';
import { pressStart, cancelAllPresses, bindPress, bindHeaderBtn } from './input.js';

/* =========================================================================
   12. PROGRESS TOKEN (scrambled + checksummed) + AUTOSAVE
   Format: "SDK1." + base64url( salt | scramble( payload | crc32 ) )
   Scrambling stops casual reading/editing; the CRC32 checksum rejects typos
   and edited tokens. It is NOT real security (the key lives in this code).
   ========================================================================= */
export const Token = (() => {
  const PREFIX = 'SDK1.';
  const KEY = 0x5D0C_2A17;            // scramble key (obfuscation only)
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function stream(salt) {                 // mulberry32 keystream
    let a = (KEY ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) & 0xFF;
    };
  }
  const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function unb64u(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(bin, ch => ch.charCodeAt(0));
  }
  function encode(payload) {
    const salt = (Math.random() * 256) | 0;
    const plain = new Uint8Array(payload.length + 4);
    plain.set(payload);
    const crc = crc32(Uint8Array.of(salt, ...payload));
    plain[payload.length] = crc >>> 24; plain[payload.length + 1] = crc >>> 16 & 0xFF;
    plain[payload.length + 2] = crc >>> 8 & 0xFF; plain[payload.length + 3] = crc & 0xFF;
    const out = new Uint8Array(plain.length + 1);
    out[0] = salt;
    const ks = stream(salt);
    let prev = salt;
    for (let i = 0; i < plain.length; i++) { prev = plain[i] ^ ks() ^ prev; out[i + 1] = prev; }
    return PREFIX + b64u(out);
  }
  function decode(token) {                // returns payload bytes or throws
    const t = String(token).replace(/\s+/g, '');
    if (!t.startsWith(PREFIX)) throw new Error('This is not a sudoku progress token.');
    let raw;
    try { raw = unb64u(t.slice(PREFIX.length)); } catch (e) { throw new Error('The token has invalid characters.'); }
    if (raw.length < 6) throw new Error('The token is too short.');
    const salt = raw[0], ks = stream(salt), plain = new Uint8Array(raw.length - 1);
    let prev = salt;
    for (let i = 1; i < raw.length; i++) { plain[i - 1] = raw[i] ^ ks() ^ prev; prev = raw[i]; }
    const n = plain.length - 4, payload = plain.slice(0, n);
    const got = ((plain[n] << 24) | (plain[n + 1] << 16) | (plain[n + 2] << 8) | plain[n + 3]) >>> 0;
    if (crc32(Uint8Array.of(salt, ...payload)) !== got) throw new Error('The token is damaged or was edited. Copy it again.');
    return payload;
  }
  return { encode, decode };
})();

/* Board <-> bytes. In the real game this packs campaign progress instead.
   Byte 1 is a one-byte tag of the puzzle id (the prototype puzzle "proto" is 0,
   so prototype tokens still load); unpack also checks the givens. */
const SAVE_VER = 1;
export function puzzleTag(id = S.id) {
  if (id === 'proto') return 0;
  let h = 0x811C9DC5;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 0x01000193);
  return ((h >>> 0) % 255) + 1;
}
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

/* Token sheet UI */
const sheetEl = $('sheet'), sheetBg = $('sheetBg'), tokOut = $('tokOut'), tokIn = $('tokIn'), tokMsg = $('tokMsg');
function say(text, kind) { tokMsg.textContent = text; tokMsg.className = 'msg' + (kind ? ' ' + kind : ''); }
export function openSheet() {
  cancelAllPresses(); release();
  tokOut.value = Token.encode(packState());
  tokIn.value = ''; say('');
  UI.sheetOpen = true; sheetEl.classList.add('show'); sheetBg.classList.add('show');
}
export function closeSheet() {
  UI.sheetOpen = false; sheetEl.classList.remove('show'); sheetBg.classList.remove('show');
  tokIn.blur(); tokOut.blur();
}

export function initToken() {
  hooks.afterRefresh = scheduleSave;
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  bindHeaderBtn($('tokenBtn'), () => { sfx.mod(); openSheet(); });
  sheetBg.addEventListener('pointerdown', e => { e.preventDefault(); closeSheet(); });
  bindPress($('closeKey'), () => { sfx.mod(); closeSheet(); });
  // Clipboard must run inside a click handler, so Copy listens to click too
  $('copyKey').addEventListener('pointerdown', e => { e.preventDefault(); sfx.unlock(); pressStart('p' + e.pointerId, $('copyKey'), () => sfx.mod(), null); });
  $('copyKey').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tokOut.value); say('Copied. Paste it in the other browser or device.', 'ok'); }
    catch (e) { tokOut.focus(); tokOut.select(); say('Copy was blocked here. The token is selected, copy it manually.', 'bad'); }
  });
  bindPress($('loadKey'), () => {
    try {
      const st = unpackState(Token.decode(tokIn.value));
      applyState(st); saveNow(); sfx.latch(0);
      say('Progress loaded.', 'ok');
      setTimeout(closeSheet, 650);
    } catch (e) { sfx.error(); say(e.message || 'That token could not be read.', 'bad'); }
  });
}
