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
/* --- step10: the unlock moment in Settings (source: the badge, then the tile) --- */
import { SPARKS } from './sparks.js';
import { currentScreen } from './screens.js';
/* --- end step10 --- */

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

/* ---- step10: a fresh unlock, the first time Settings opens after it ------------------
   The gear's badge sends a spark into the sheet, to the new tile; the tile's lock pops
   off (up, tumbling, falling with gravity), the tile lights, a soft latch. Tiles out of
   view simply show unlocked. Reduced motion: the lock fades, the tile flashes. */
export const UFX = { pops: 0, spark: 0 };
let fxT = [];
function badgePoint() {
  const home = currentScreen() === 'home' ? document.querySelector('#home .key.set .dotb') : null;
  const el = home || $('setBtn');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1) return null;
  return home ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: r.right - 9, y: r.top + 9 };
}
function freshFx(sheet, src) {
  const tiles = [...sheet.querySelectorAll('.set-tile.fresh, .set-swatch.fresh')];
  if (!tiles.length) return;
  const rm = reducedMotion();
  tiles.forEach(t => t.classList.add('fx-wait'));
  const go = () => {
    const vis = tiles.filter(t => { const r = t.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    tiles.filter(t => !vis.includes(t)).forEach(t => t.classList.remove('fx-wait'));
    if (vis.length) { document.body.classList.add('bk-fx'); fxT.push(setTimeout(() => document.body.classList.remove('bk-fx'), 1500 + vis.length * 160)); }
    if (src && vis.length && !rm) {
      UFX.spark++;
      SPARKS.pulse(src, vis[0].querySelector('.set-mk, .set-mini') || vis[0], { done: () => vis.forEach((t, j) => fxT.push(setTimeout(() => popTile(t, j), j * 160))) });
    } else vis.forEach((t, j) => fxT.push(setTimeout(() => popTile(t, j), j * 160)));
  };
  fxT.push(setTimeout(go, 360));          // after the sheet's spring has settled (rects read once)
}
function popTile(t, j) {
  if (!t.isConnected) return;
  UFX.pops++;
  const host = t.querySelector('.set-mk, .set-mini') || t, r = host.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2, rm = reducedMotion();
  const lock = document.createElement('span');
  lock.className = 'set-pop'; lock.innerHTML = LOCK; lock.setAttribute('aria-hidden', 'true');
  document.body.appendChild(lock);
  t.classList.remove('fx-wait');
  sfx.latch(0, Math.min(2, j)); haptic(8);
  const glow = document.createElement('span'); glow.className = 'set-glow'; t.appendChild(glow);
  glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 620, easing: 'ease-out' }).onfinish = () => glow.remove();
  if (rm) {
    lock.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    lock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }).onfinish = () => lock.remove();
    return;
  }
  const frames = [], dir = x < innerWidth / 2 ? -1 : 1, vx = dir * (0.04 + Math.random() * 0.03), vy = -0.34, g = 0.0017, D = 600;
  for (let i = 0; i <= 10; i++) {
    const tt = (i / 10) * D;
    frames.push({ transform: `translate3d(${(x + vx * tt).toFixed(1)}px, ${(y + vy * tt + 0.5 * g * tt * tt).toFixed(1)}px, 0) rotate(${(dir * i * 9).toFixed(0)}deg) scale(${i === 0 ? 1.12 : 1})`, opacity: i < 7 ? 1 : 1 - (i - 6) / 4 });
  }
  lock.animate(frames, { duration: D, easing: 'linear', fill: 'forwards' }).onfinish = () => lock.remove();
  SPARKS.crackle({ x, y }, 5);
}

export function initUnlockUI() {
  setHooks.sync.push(paintSheet);
  setHooks.open.push(sheet => {
    /* step10: read the badge before it clears, then the fresh tiles pop their locks */
    const had = getProfile().flags.badge, src = had ? badgePoint() : null;
    paintSheet(sheet); clearBadge();
    freshFx(sheet, src);
  });
  setHooks.close.push(() => { for (const t of fxT) clearTimeout(t); fxT = []; document.querySelectorAll('.set-pop').forEach(e => e.remove()); document.querySelectorAll('#setSheet .fx-wait').forEach(e => e.classList.remove('fx-wait')); document.body.classList.remove('bk-fx'); });
  setHooks.close.push(() => clearFresh());
  const sheet = $('setSheet');
  if (sheet) {
    for (const ev of ['click', 'pointerdown', 'pointerup']) sheet.addEventListener(ev, guard, true);
    paintSheet(sheet);
  }
  onProfile(() => { paintBadge(); if (sheet && sheet.classList.contains('show')) paintSheet(sheet); });
  paintBadge();
}
