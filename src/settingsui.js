// settingsui.js — the gear button and the Settings sheet (Keycaps, Colorway,
// Sound) with a live preview strip of real keys. Every change applies at once;
// the keys "swap" in a wave from the tapped option: each cap keeps its old
// look (old classes pinned on the key itself), lifts, takes the new look at
// the top of the lift and drops back in (transform/opacity only). Reduced
// motion: a short crossfade instead.
import { $, div, reducedMotion } from './util.js';
import { sfx } from './audio.js';
import { UI } from './state.js';
import { padEl, makeKey, ICONS } from './pad.js';
import { bindPress, bindHeaderBtn, cancelAllPresses } from './input.js';
import { release } from './actions.js';
import { PRESETS, LAYOUTS } from './colorways.js';
import { STYLES, getSettings, setSettings, initSettings, isClassic } from './settings.js';

const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const HINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>';

let sheet, bg, tilesEl, swEl, segEl, sndBtn, volEl, prevEl;
/* --- step7: hooks for the unlock layer (unlockui.js): locked tiles, NEW marks, gear badge --- */
export const setHooks = { sync: [], open: [], close: [] };
/* --- end step7 --- */

/* ---- the swap wave ---- */
let waveTimers = [];
function pinOld(el, old) {
  el.classList.add('ks-' + old.style, 'cw-' + old.preset, 'pin-' + old.layout, 'kpin');
}
function unpin(el) {
  for (const c of [...el.classList]) if (c.startsWith('ks-') || c.startsWith('cw-') || c.startsWith('pin-') || c === 'kpin') el.classList.remove(c);
}
const swapKeys = () => [...document.querySelectorAll('.set-prev .key, #pad .key, .hkeys .key')];
function wave(old, origin) {
  for (const t of waveTimers) clearTimeout(t);
  waveTimers = [];
  document.querySelectorAll('.key.kpin').forEach(unpin);
  const rm = reducedMotion();
  for (const k of swapKeys()) {
    pinOld(k, old);
    const cap = k.querySelector(':scope > .cap');
    const r = k.getBoundingClientRect();
    const dist = origin ? Math.hypot(r.left + r.width / 2 - origin.x, r.top + r.height / 2 - origin.y) : 0;
    if (rm) {
      cap.animate([{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: 220, easing: 'ease-in-out' });
      waveTimers.push(setTimeout(() => unpin(k), 100));
      continue;
    }
    const delay = Math.min(300, dist * 0.55), dur = 330;
    cap.animate([
      { transform: 'translate3d(0,0,0)', opacity: 1 },
      { transform: 'translate3d(0,-8px,0)', opacity: 0.15, offset: 0.34 },
      { transform: 'translate3d(0,1.5px,0)', opacity: 1, offset: 0.72 },
      { transform: 'translate3d(0,0,0)', opacity: 1 }
    ], { duration: dur, delay, easing: 'cubic-bezier(.33,.6,.4,1)' });
    const sh = k.querySelector(':scope > .shadow');
    if (sh) sh.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.34 }, { opacity: 1, offset: 0.72 }, { opacity: 1 }], { duration: dur, delay });
    waveTimers.push(setTimeout(() => unpin(k), delay + dur * 0.34));
  }
}
function change(patch, ev) {
  const old = getSettings();
  const origin = ev && ev.currentTarget ? (() => { const r = ev.currentTarget.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null;
  const next = setSettings(patch);
  if (next.style !== old.style || next.preset !== old.preset || next.layout !== old.layout) wave(old, origin);
  sync();
}

/* ---- building blocks ---- */
function btn(cls, parent, html) {
  const b = document.createElement('button'); b.type = 'button'; b.className = cls;
  if (html) b.innerHTML = html;
  parent.appendChild(b); return b;
}
function digitKey(d, parent, extra = '') {
  // data-pd, not data-d: '.key.digit[data-d=…]' stays unique to the real pad
  const k = makeKey('digit ' + extra, `<span class="lg">${d}</span><span class="cnt"></span><i class="led"></i>`, parent);
  k.dataset.pd = d; k.setAttribute('aria-hidden', 'true'); return k;
}
function modKey(icon, label, parent, extra = '', led = false) {
  const k = makeKey('mod ' + extra, `${icon}<span class="lbl">${label}</span>${led ? '<i class="led"></i>' : ''}`, parent);
  k.setAttribute('aria-hidden', 'true'); return k;
}

function build() {
  bg = div('sheet-bg', document.body); bg.id = 'setBg';
  sheet = div('sheet set', document.body); sheet.id = 'setSheet';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Settings');

  const top = div('set-top', sheet);
  const head = div('set-head', top);
  const h = document.createElement('h2'); h.textContent = 'Settings'; head.appendChild(h);
  const x = btn('set-x', head, CLOSE); x.setAttribute('aria-label', 'Close settings');
  x.addEventListener('click', () => { sfx.mod(); close(); });

  // live preview strip: real keys, pressable (you hear the switch)
  prevEl = div('set-prev kp', top);
  prevEl.setAttribute('aria-label', 'Preview');
  const k4 = digitKey(4, prevEl), k5 = digitKey(5, prevEl), k6 = digitKey(6, prevEl, 'locked');
  k4.querySelector('.cnt').textContent = '6'; k5.querySelector('.cnt').textContent = '7';
  const pen = modKey(ICONS.pencil, 'Pencil', prevEl, 'latched', true);
  const hint = modKey(HINT, 'Hint', prevEl, 'hk');
  for (const k of [k4, k5, k6]) bindPress(k, () => { k.classList.contains('locked') ? sfx.blocked() : sfx.pen(); });
  bindPress(pen, () => { pen.classList.toggle('latched'); sfx.mod(); });
  bindPress(hint, () => sfx.mod());

  // Keycaps
  const s1 = div('set-sec', sheet);
  s1.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Keycaps' }));
  tilesEl = div('set-tiles', s1);
  for (const st of STYLES) {
    const t = btn('set-tile ks-' + st.id, tilesEl);
    t.dataset.style = st.id;
    t.setAttribute('aria-label', `${st.name} ${st.sub} keycaps`);
    const mk = div('set-mk kp', t);
    digitKey(5, mk);
    modKey(ICONS.undo, 'Undo', mk);
    const lab = div('set-lab', t);
    lab.innerHTML = `<b>${st.name}</b> <span>${st.sub}</span><small>${st.sound}</small>`;
    t.addEventListener('click', e => { change({ style: st.id }, e); sfx.pen(); });
  }

  // Colorway
  const s2 = div('set-sec', sheet);
  s2.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Colorway' }));
  segEl = div('set-seg', s2); segEl.setAttribute('role', 'group'); segEl.setAttribute('aria-label', 'Layout');
  div('thumb', segEl);
  for (const l of LAYOUTS) {
    const b = btn('', segEl, l.name); b.dataset.layout = l.id;
    b.addEventListener('click', e => { change({ layout: l.id }, e); sfx.mod(); });
  }
  swEl = div('set-sw', s2);
  for (const p of PRESETS) {
    const b = btn('set-swatch cw-' + p.id, swEl);
    b.dataset.preset = p.id; b.setAttribute('aria-label', `${p.name} colorway: ${p.note}`);
    const mk = div('set-mini', b);
    digitKey(1, mk); digitKey(2, mk);
    modKey(ICONS.undo, '', mk);
    modKey(HINT, '', mk, 'hk');
    const lab = div('set-lab', b);
    lab.innerHTML = `<b>${p.name}</b><small>${p.note}</small>`;
    b.addEventListener('click', e => { change({ preset: p.id }, e); sfx.mod(); });
  }

  // Sound
  const s3 = div('set-sec', sheet);
  s3.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Sound' }));
  const r1 = div('set-row', s3);
  r1.appendChild(Object.assign(document.createElement('span'), { textContent: 'Sound' }));
  sndBtn = btn('set-toggle', r1, '<i></i>'); sndBtn.setAttribute('role', 'switch'); sndBtn.setAttribute('aria-label', 'Sound');
  sndBtn.addEventListener('click', () => { const on = !getSettings().sound; setSettings({ sound: on }); if (on) sfx.select(); sync(); });
  const r2 = div('set-row', s3);
  const vl = document.createElement('label'); vl.textContent = 'Switch sound'; vl.htmlFor = 'setVol'; r2.appendChild(vl);
  volEl = document.createElement('input');
  Object.assign(volEl, { type: 'range', min: '0', max: '100', step: '1', id: 'setVol' });
  r2.appendChild(volEl);
  volEl.addEventListener('input', () => { setSettings({ switchVol: volEl.value / 100 }); paintVol(); });
  volEl.addEventListener('change', () => { sfx.unlock(); sfx.pen(); sfx.release(); });

  const row = div('row set-done', sheet);
  const done = makeKey('mod', '<span class="lbl">Done</span>', row);
  done.setAttribute('aria-label', 'Done');
  bindPress(done, () => { sfx.mod(); close(); });

  bg.addEventListener('pointerdown', e => { e.preventDefault(); close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.classList.contains('show')) close(); });
}
function paintVol() { volEl.style.setProperty('--v', volEl.value + '%'); }

function sync() {
  const s = getSettings();
  for (const t of tilesEl.children) t.setAttribute('aria-pressed', String(t.dataset.style === s.style));
  for (const b of swEl.children) b.setAttribute('aria-pressed', String(b.dataset.preset === s.preset));
  const bs = [...segEl.querySelectorAll('button')];
  bs.forEach((b, i) => { b.setAttribute('aria-pressed', String(b.dataset.layout === s.layout)); if (b.dataset.layout === s.layout) segEl.style.setProperty('--i', i); });
  sndBtn.setAttribute('aria-checked', String(s.sound));
  volEl.value = Math.round(s.switchVol * 100); paintVol();
  sheet.classList.toggle('mute', !s.sound);
  /* --- step7 --- */ for (const f of setHooks.sync) f(sheet); /* --- end step7 --- */
}

export function openSettings() {
  if (!sheet) return;
  cancelAllPresses(); release();
  sync();
  UI.sheetOpen = true;
  sheet.scrollTop = 0;
  sheet.classList.add('show'); bg.classList.add('show');
  /* --- step7 --- */ for (const f of setHooks.open) f(sheet); /* --- end step7 --- */
}
export function closeSettings() { close(); }
function close() {
  if (!sheet || !sheet.classList.contains('show')) return;
  UI.sheetOpen = false;
  sheet.classList.remove('show'); bg.classList.remove('show');
  /* --- step7 --- */ for (const f of setHooks.close) f(sheet); /* --- end step7 --- */
}

/* Called once from main.js after the pad and the hint keys exist. */
export function initKeys() {
  initSettings();
  if (isClassic()) return;                      // debug-only original look: no gear, no sheet
  padEl.classList.add('kp');
  build();
  const hb = document.querySelector('.hbtns');
  const g = div('hbtn', null); g.id = 'setBtn';
  g.setAttribute('role', 'button'); g.setAttribute('aria-label', 'Settings');
  g.innerHTML = GEAR;
  hb.insertBefore(g, $('muteBtn'));
  bindHeaderBtn(g, () => { sfx.mod(); openSettings(); });
  sync();
}
