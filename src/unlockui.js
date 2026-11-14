// unlockui.js — UNLOCKS in the interface (step 7). Keycaps are earned:
//  - Settings: locked styles / layouts / presets are dimmed tiles with a lock and
//    "Master World N" (a teaser, not selectable); fresh unlocks carry a NEW mark
//  - a dot badge on the Settings gear (header and Home) until Settings is opened
//  - the reward moment on the end-of-world toast: "New keycaps: Cherry OEM" with a
//    key that drops in with its own switch sound
import { $, div, reducedMotion, haptic } from './util.js';
import { sfx } from './audio.js';
import { toastEl } from './board.js';
import { makeKey, ICONS } from './pad.js';
import { getSettings } from './settings.js';
import { setHooks } from './settingsui.js';
import { getProfile, isUnlocked, lockWorld, clearBadge, clearFresh, itemsFor, itemName, onProfile } from './profile.js';
import { ICON } from './home.js';

const LOCK = ICON.lock;

/* ---- Settings sheet ---------------------------------------------------------- */
function mark(el, kind, id) {
  const locked = !isUnlocked(kind, id), w = lockWorld(kind, id);
  el.classList.toggle('lockd', locked);
  el.setAttribute('aria-disabled', String(locked));
  const prev = el.querySelector(':scope > .set-mk, :scope > .set-mini');
  const lab = el.querySelector(':scope > .set-lab');
  el.querySelectorAll('.lock-tag, .lock-req').forEach(x => x.remove());
  if (locked) {
    const tag = document.createElement('span'); tag.className = 'lock-tag';
    tag.innerHTML = LOCK;
    const req = document.createElement('span'); req.className = 'lock-req';
    req.innerHTML = `${LOCK}<span>Master World&nbsp;${w}</span>`;
    if (prev) { prev.appendChild(tag); lab.appendChild(req); }
    else el.appendChild(req);                 // segmented button: inline requirement
    el.title = `Locked: master World ${w}`;
  } else el.removeAttribute('title');
  const fresh = !locked && getProfile().flags.fresh.includes(kind + ':' + id);
  el.classList.toggle('fresh', fresh);
  let nw = el.querySelector(':scope > .new-tag');
  if (fresh && !nw) { nw = document.createElement('span'); nw.className = 'new-tag'; nw.textContent = 'New'; el.appendChild(nw); }
  if (!fresh && nw) nw.remove();
}
function paintSheet(sheet) {
  if (!sheet) return;
  sheet.querySelectorAll('.set-tile[data-style]').forEach(t => mark(t, 'style', t.dataset.style));
  sheet.querySelectorAll('.set-seg button[data-layout]').forEach(b => mark(b, 'layout', b.dataset.layout));
  sheet.querySelectorAll('.set-swatch[data-preset]').forEach(b => mark(b, 'preset', b.dataset.preset));
}
function guard(e) {
  const t = e.target.closest && e.target.closest('.lockd');
  if (!t || !t.closest('#setSheet')) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  if (e.type !== 'click') return;
  sfx.blocked(); haptic(10);
  if (!reducedMotion()) t.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 240 });
  const tag = t.querySelector('.lock-tag');
  if (tag) tag.animate([{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }], { duration: 300 });
}

/* ---- the gear badge ---------------------------------------------------------- */
export function paintBadge() {
  const on = getProfile().flags.badge;
  const g = $('setBtn'); if (g) g.classList.toggle('badge', on);
  const h = document.querySelector('#home .key.set'); if (h) h.classList.toggle('badge', on);
}

/* ---- the reward moment ------------------------------------------------------- */
/** On the end-of-world toast: what this world unlocked, with a key dropping in. */
export function showReward(w, parent = toastEl, before = $('againKey')) {
  const items = itemsFor(w);
  const box = document.createElement('div'); box.className = 'rw';
  parent.insertBefore(box, before);
  const head = div('rw-h', box);
  head.innerHTML = `<span class="rw-k">Keycap set</span> World ${w} is in your keyboard.`;
  if (!items.length) return box;
  const styleIt = items.find(i => i.kind === 'style');
  const names = items.map(itemName);
  const kindWord = styleIt ? 'New keycaps' : items.some(i => i.kind === 'layout') ? 'New colorway' : (items.length > 1 ? 'New colorways' : 'New colorway');
  const row = div('rw-row', box);
  const s = getSettings();
  // the dropped-in key wears the reward: its style, its preset, its layout
  const wrap = div('rw-keys kp', row);
  const st = styleIt ? styleIt.id : s.style;
  const pre = (items.find(i => i.kind === 'preset') || {}).id || s.preset;
  const lay = (items.find(i => i.kind === 'layout') || {}).id;
  wrap.classList.add('ks-' + st, 'cw-' + pre);
  const keys = [];
  const k1 = makeKey('digit', '<span class="lg">1</span>', wrap); keys.push(k1);
  const k2 = makeKey('digit' + (lay === 'checker' ? ' ev pin-checker' : ''), '<span class="lg">2</span>', wrap); keys.push(k2);
  const k3 = makeKey('mod', `${ICONS.pencil}`, wrap); keys.push(k3);
  keys.forEach(k => k.setAttribute('aria-hidden', 'true'));
  const txt = div('rw-t', row);
  txt.innerHTML = `<small>${kindWord}</small><b>${names.join(' + ')}</b><span>Pick ${items.length > 1 ? 'them' : 'it'} in Settings</span>`;
  box.dataset.items = items.map(i => i.kind + ':' + i.id).join(',');
  // drop in, one key after another, each with that switch's sound
  const rm = reducedMotion();
  keys.forEach((k, j) => {
    const cap = k.querySelector(':scope > .cap');
    const delay = (rm ? 120 : 520) + j * (rm ? 60 : 150);
    if (!rm) cap.animate([{ transform: 'translate3d(0,-38px,0)', opacity: 0 }, { transform: 'translate3d(0,-38px,0)', opacity: 1, offset: .1 }, { transform: 'translate3d(0,2px,0)', opacity: 1, offset: .65 }, { transform: 'none', opacity: 1 }], { duration: 440, delay, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'backwards' });
    else cap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay, fill: 'backwards' });
    setTimeout(() => {
      const prev = sfx.keyStyle;
      if (prev) sfx.keyStyle = st;              // the reward's own switch
      sfx.pen(); setTimeout(() => { if (prev) sfx.keyStyle = st; sfx.release(); sfx.keyStyle = prev; }, 80);
      sfx.keyStyle = prev;
      haptic(6);
    }, delay + (rm ? 0 : 280));
  });
  return box;
}

export function initUnlockUI() {
  setHooks.sync.push(paintSheet);
  setHooks.open.push(sheet => { paintSheet(sheet); clearBadge(); });
  setHooks.close.push(() => clearFresh());
  const sheet = $('setSheet');
  if (sheet) {
    for (const ev of ['click', 'pointerdown', 'pointerup']) sheet.addEventListener(ev, guard, true);
    paintSheet(sheet);
  }
  onProfile(() => { paintBadge(); if (sheet && sheet.classList.contains('show')) paintSheet(sheet); });
  paintBadge();
}
