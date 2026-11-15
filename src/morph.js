// morph.js — step 10: SPATIAL TRANSITIONS between the non-board screens and the
// spring of sheets / toasts. Every transition has a SOURCE and a PURPOSE:
//
//   expand    the tapped keycap / card grows into the next screen: a slab in the
//             key's own face colour scales from the key to the screen while the
//             destination zooms out of the key's centre (it "comes out of" it)
//   collapse  going back reverses it: the screen you leave shrinks into the key
//             that opened it (its ANCHOR on the screen you return to), and the
//             slab lands on that key and fades into it
//   fade      reduced motion: a crossfade, nothing moves
//   spring    sheets and toasts open out of the control that opened them (scale +
//             a short drift from that point, slight overshoot) and close back into it
//
// Layers: 'home' 'campaign' 'world' (screens.js), 'free' (freemode.js), 'game'
// (the board, #app). A navigation calls note('in'|'out', layer) for what it shows
// and hides (synchronously, the state changes at once); the animation is chosen
// once per navigation in a microtask, when the destination is already painted:
// rects are read once, then only transform/opacity animate. Every animation is
// interruptible: a new navigation finishes the old one at its end state first.
// Destinations take input at once (≤ 260 ms of motion, nothing waits for it).
import { $, reducedMotion } from './util.js';
import { sfx } from './audio.js';

const DEPTH = { home: 0, campaign: 1, free: 1, world: 2, game: 3 };
const T_EXPAND = 260, T_COLLAPSE = 240, T_FADE_IN = 140, T_FADE_OUT = 110;
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)', EASE_IN = 'cubic-bezier(.45,0,.75,.6)';

/* ---- the last pressed control (the SOURCE) -------------------------------------- */
let press = null;
const PRESSABLE = '.key, button, .hbtn, .sbtn, .wcard, .mlock, [role="button"], .cell';
window.addEventListener('pointerdown', e => {
  const t = e.target && e.target.closest ? e.target.closest(PRESSABLE) : null;
  press = t ? { el: t, t: performance.now() } : null;
}, true);
window.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const a = document.activeElement;
  if (a && a !== document.body && a.closest) press = { el: a.closest(PRESSABLE) || a, t: performance.now() };
}, true);
/** The control pressed in the last `ms` milliseconds (still in the page), or null. */
export function recentPress(ms = 1500) {
  return press && press.el.isConnected && performance.now() - press.t < ms ? press.el : null;
}

/* ---- geometry helpers --------------------------------------------------------- */
const face = el => (el && el.classList && el.classList.contains('key') ? el.querySelector(':scope > .cap') || el : el);
function visibleRect(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const r = face(el).getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
  return r;
}
function faceStyle(el) {
  // the key's visible face: .sk (dressed keycaps) or .cap (classic), else the card itself
  const f = (el.querySelector && el.querySelector(':scope > .cap > .sk')) || face(el);
  const cs = getComputedStyle(f);
  let bg = cs.backgroundColor, img = cs.backgroundImage;
  if ((!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && (!img || img === 'none')) {
    const c2 = getComputedStyle(el);
    bg = c2.backgroundColor; img = c2.backgroundImage;
  }
  if ((!bg || bg === 'rgba(0, 0, 0, 0)') && (!img || img === 'none')) bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
  return { bg, img, radius: cs.borderRadius || '12px' };
}

/* ---- layers ------------------------------------------------------------------- */
const layers = new Map();   // name -> { el: () => Element, anchor(from) -> Element|null, fallbackIn(dir), fallbackOut(dir), outDone(), inDone() }
export function regLayer(name, spec) { layers.set(name, spec); }
layers.set('game', { el: () => $('app') });
const layerEl = n => { const L = layers.get(n); return L && L.el ? L.el() : null; };

let ready = false;
export function morphReady(on = true) { ready = on; }

let batch = null;
/** A navigation shows (`in`) or hides (`out`) a layer. Returns true when this module animates it. */
export function note(kind, name, dir = 0) {
  if (!ready || !layers.has(name)) return false;
  if (!batch) { batch = { ins: [], outs: [], dir }; queueMicrotask(run); }
  (kind === 'in' ? batch.ins : batch.outs).push(name);
  if (dir) batch.dir = dir;
  return true;
}

/* ---- running transitions (interruptible) ------------------------------------------ */
const running = [];       // { anims: [Animation], done: fn }
let slab = null;
function getSlab() {
  if (!slab) {
    slab = document.createElement('div');
    slab.className = 'mslab'; slab.setAttribute('aria-hidden', 'true');
    document.body.appendChild(slab);
  }
  return slab;
}
function track(anims, done) {
  const rec = { anims, done, over: false };
  const fin = () => { if (rec.over) return; rec.over = true; done(); for (const a of anims) { try { a.cancel(); } catch (e) {} } const i = running.indexOf(rec); if (i >= 0) running.splice(i, 1); };
  rec.finish = fin;
  let left = anims.length;
  if (!left) { fin(); return rec; }
  for (const a of anims) a.addEventListener('finish', () => { if (--left === 0) fin(); });
  running.push(rec);
  return rec;
}
/** Finish every running transition at its end state (a new navigation, or a test). */
export function settle() { while (running.length) running[0].finish(); }
export const morphBusy = () => running.length > 0;
export const MORPH = { last: null, count: 0 };

function setStyles(el, st) { const old = {}; for (const k of Object.keys(st)) { old[k] = el.style[k]; el.style[k] = st[k]; } return () => { for (const k of Object.keys(old)) el.style[k] = old[k]; }; }

/* ---- the navigation ---------------------------------------------------------------- */
function run() {
  const b = batch; batch = null;
  settle();
  const ins = [...new Set(b.ins)].filter(n => !b.outs.includes(n));
  const outs = [...new Set(b.outs)].filter(n => !b.ins.includes(n));
  if (!ins.length && !outs.length) return;
  if (!ins.length) ins.push('game');
  if (!outs.length) outs.push('game');
  const inN = ins[ins.length - 1], outN = outs[0];
  const inEl = layerEl(inN), outEl = layerEl(outN);
  if (!inEl || !outEl) return fallback(ins, outs, b.dir);
  const rm = reducedMotion();
  let mode = null, ref = null;
  if (rm) mode = 'fade';
  else {
    if (DEPTH[inN] < DEPTH[outN]) {
      const L = layers.get(inN), a = L.anchor ? L.anchor(outN) : null;
      if (a && inEl.contains(a)) { ref = visibleRect(a); if (ref) { mode = 'collapse'; ref.el = a; } }
    }
    if (!mode) {
      const p = recentPress();
      if (p && outEl.contains(p)) { ref = visibleRect(p); if (ref) { mode = 'expand'; ref.el = p; } }
    }
  }
  MORPH.last = { mode: mode || 'fallback', from: outN, to: inN, t: performance.now() };
  MORPH.count++;
  if (!mode) return fallback(ins, outs, b.dir);
  if (mode === 'fade') return fade(inN, inEl, outN, outEl);
  swoosh(mode === 'expand' ? 1 : -1);
  if (mode === 'expand') expand(inN, inEl, outN, outEl, ref);
  else collapse(inN, inEl, outN, outEl, ref);
  // a second hidden layer (e.g. Home behind Free Mode) just goes
  for (const n of outs.slice(1)) { const L = layers.get(n); if (L && L.outDone) L.outDone(); }
}
function fallback(ins, outs, dir) {
  for (const n of outs) { const L = layers.get(n); if (L && L.fallbackOut) L.fallbackOut(dir); else if (L && L.outDone) L.outDone(); }
  for (const n of ins) { const L = layers.get(n); if (L && L.fallbackIn) L.fallbackIn(dir); }
}
function done(n, kind) { const L = layers.get(n); const f = L && (kind === 'in' ? L.inDone : L.outDone); if (f) f(); }
/* the transform-origin of a layer for a viewport point */
function originIn(el, x, y) { const r = el.getBoundingClientRect(); return `${(x - r.left).toFixed(1)}px ${(y - r.top).toFixed(1)}px`; }

function expand(inN, inEl, outN, outEl, R) {
  const vw = innerWidth, vh = innerHeight, cx = R.left + R.width / 2, cy = R.top + R.height / 2;
  const fs = faceStyle(R.el), s = getSlab();
  // the key's face (slab) grows over everything and dissolves into the destination,
  // which zooms out of the key's centre underneath it; the screen left behind stays
  // put (the destination covers it) unless the destination is the board beneath it
  const undoSlab = setStyles(s, { display: 'block', left: R.left + 'px', top: R.top + 'px', width: R.width + 'px', height: R.height + 'px',
    background: fs.img && fs.img !== 'none' ? `${fs.img}, ${fs.bg}` : fs.bg, borderRadius: fs.radius, zIndex: '34' });
  // (the board itself never transforms: re-layering the whole board costs a frame on a slow
  // phone; the slab carries the motion and the screen above it fades away)
  const toGame = inN === 'game';
  const undoIn = toGame ? () => {} : setStyles(inEl, { transformOrigin: originIn(inEl, cx, cy), zIndex: '33' });
  const undoOut = outN === 'game' ? () => {} : setStyles(outEl, { zIndex: '31', ...(outN === 'free' ? { visibility: 'visible' } : {}) });
  const sx = vw / R.width, sy = vh / R.height;
  const a1 = s.animate([
    { transform: 'none', opacity: 1 },
    { opacity: 0.85, offset: 0.2 },
    { opacity: 0, offset: 0.7 },
    { transform: `translate3d(${-R.left}px, ${-R.top}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`, opacity: 0 }
  ], { duration: T_EXPAND, easing: EASE_OUT });
  const a2 = toGame ? null : inEl.animate([
    { transform: 'scale(.55)', opacity: 0 },
    { opacity: 1, offset: 0.5 },
    { transform: 'none', opacity: 1 }
  ], { duration: T_EXPAND, easing: EASE_OUT });
  // the board sits under the screen it replaces: that screen fades away instead
  const a3 = toGame && outN !== 'game' ? outEl.animate([{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], { duration: T_EXPAND, easing: 'ease-out', fill: 'forwards' }) : null;
  track([a1, a2, a3].filter(Boolean), () => {
    undoSlab(); s.style.display = 'none'; undoIn(); undoOut();
    done(outN, 'out'); done(inN, 'in');
  });
}

function collapse(inN, inEl, outN, outEl, R) {
  const vw = innerWidth, vh = innerHeight, cx = R.left + R.width / 2, cy = R.top + R.height / 2;
  const s = getSlab(), fs = faceStyle(R.el), fromGame = outN === 'game';
  const undoSlab = setStyles(s, { display: 'block', left: R.left + 'px', top: R.top + 'px', width: R.width + 'px', height: R.height + 'px',
    background: fs.img && fs.img !== 'none' ? `${fs.img}, ${fs.bg}` : fs.bg, borderRadius: fs.radius, zIndex: '32' });
  // leaving a screen: it shrinks into the anchor above the destination. Leaving the board:
  // the board stays still (no re-layering) and the destination fades in over it.
  const undoOut = fromGame ? () => {} : setStyles(outEl, { transformOrigin: originIn(outEl, cx, cy), zIndex: '33', ...(outN === 'free' ? { visibility: 'visible' } : {}) });
  const undoIn = inN === 'game' ? () => {} : setStyles(inEl, { zIndex: '31' });
  const sx = vw / R.width, sy = vh / R.height;
  const a1 = s.animate([
    { transform: `translate3d(${-R.left}px, ${-R.top}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`, opacity: 0 },
    { opacity: 1, offset: 0.22 },
    { opacity: 1, offset: 0.8 },
    { transform: 'none', opacity: 0 }
  ], { duration: T_COLLAPSE, easing: EASE_OUT });
  const a2 = fromGame
    ? inEl.animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1 }], { duration: T_COLLAPSE, easing: 'ease-out' })
    : outEl.animate([
      { transform: 'none', opacity: 1 },
      { opacity: 0, offset: 0.4 },
      { transform: 'scale(.6)', opacity: 0 }
    ], { duration: T_COLLAPSE, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
  track([a1, a2], () => {
    undoSlab(); s.style.display = 'none'; undoOut(); undoIn();
    done(outN, 'out'); done(inN, 'in');
  });
}

function fade(inN, inEl, outN, outEl) {
  swoosh(DEPTH[inN] < DEPTH[outN] ? -1 : 1);
  const anims = [];
  let undo = () => {};
  if (inN !== 'game') {
    // the destination crossfades in ABOVE the screen it replaces, which stays opaque under it
    // (nothing behind shows through, nothing moves)
    const u1 = setStyles(inEl, { zIndex: '33' });
    // (Free Mode's hidden state is transparent: hold it as it was while the new screen covers it)
    const u2 = outN === 'free' ? setStyles(outEl, { visibility: 'visible', opacity: '1', transform: 'none' }) : () => {};
    undo = () => { u1(); u2(); };
    anims.push(inEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T_FADE_IN, easing: 'ease-out' }));
  } else if (outN !== 'game') {
    // the board is already under it: the screen fades away
    if (outN === 'free') undo = setStyles(outEl, { visibility: 'visible' });
    anims.push(outEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T_FADE_OUT, easing: 'ease-in', fill: 'forwards' }));
  }
  track(anims, () => { undo(); done(outN, 'out'); done(inN, 'in'); });
}

/* ---- sound: a soft air swell, up for expand, down for collapse (±5 % via pj) ------ */
function swoosh(dir) {
  const P = sfx.prims;
  if (!P || !P.ready()) return;
  try {
    const ctx = P.ctx, t = P.now() + 0.004, p = P.pj(), d = 0.17 * P.jit(0.08);
    const src = ctx.createBufferSource(); src.buffer = P.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.85;
    const lo = 420 * p, hi = 1250 * p;
    bp.frequency.setValueAtTime(dir > 0 ? lo : hi, t); bp.frequency.exponentialRampToValueAtTime(dir > 0 ? hi : lo, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    if (dir > 0) { g.gain.exponentialRampToValueAtTime(0.05 * P.jit(0.1), t + d * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    else { g.gain.exponentialRampToValueAtTime(0.045 * P.jit(0.1), t + d * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    src.connect(bp); bp.connect(g); g.connect(P.master);
    src.start(t, Math.random() * 0.8); src.stop(t + d + 0.03);
    // a faint low body: rises into the new screen, settles into the key on the way back
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime((dir > 0 ? 150 : 210) * p, t); o.frequency.exponentialRampToValueAtTime((dir > 0 ? 210 : 120) * p, t + d);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.018, t + d * (dir > 0 ? 0.6 : 0.8)); og.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.04);
    o.connect(og); og.connect(P.master); o.start(t); o.stop(t + d + 0.06);
  } catch (e) {}
}
sfx.swoosh = swoosh;

/* =========================================================================
   SHEETS + TOASTS: spring out of their source control, close back into it.
   Watches the `show` class, so every opener (settings, backup, DEV, the solved
   toast with the results card or the Free Mode streak) gets it unchanged.
   ========================================================================= */
const sheets = new Map();   // el -> { open, src: {x,y}|null, anim, base, source() }
export function regSheet(el, opts = {}) {
  if (!el || sheets.has(el)) return;
  const rec = { open: el.classList.contains('show'), src: null, anim: null, undo: null, opts };
  sheets.set(el, rec);
  new MutationObserver(() => {
    const on = el.classList.contains('show');
    if (on === rec.open) return;
    rec.open = on;
    if (rec.opts.skip && rec.opts.skip()) return;
    spring(el, rec, on);
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
}
const SPRING = 'cubic-bezier(.3,1.32,.5,1)';
function pointOf(v) {
  if (!v) return null;
  if (typeof v.x === 'number') return v;
  const r = visibleRect(v);
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}
function stopSpring(rec) {
  if (rec.anim) { const a = rec.anim; rec.anim = null; try { a.cancel(); } catch (e) {} }
  if (rec.undo) { const u = rec.undo; rec.undo = null; u(); }
}
function spring(el, rec, open) {
  stopSpring(rec);
  const rm = reducedMotion();
  const undoT = setStyles(el, { transition: 'none' });
  const cur = getComputedStyle(el).transform;                    // the transform of the new state (transitions off)
  if (open) { rec.shown = cur; rec.src = pointOf(rec.opts.source ? rec.opts.source() : recentPress()) || null; }
  const shown = (open ? cur : rec.shown || cur) || 'none';
  let anim;
  if (rm) {
    anim = el.animate(open ? [{ opacity: 0, transform: shown }, { opacity: 1, transform: shown }]
      : [{ opacity: 1, transform: shown }, { opacity: 0, transform: shown }], { duration: open ? 140 : 110, easing: 'ease-out', fill: open ? 'none' : 'forwards' });
    rec.undo = undoT;
  } else {
    // where the element sits when shown (closing: the hidden transform is already applied)
    const r = el.getBoundingClientRect();
    let ddx = 0, ddy = 0;
    if (!open) { try { const M = new DOMMatrix(cur === 'none' ? undefined : cur), S = new DOMMatrix(shown === 'none' ? undefined : shown); ddx = S.e - M.e; ddy = S.f - M.f; } catch (e) {} }
    const box = { left: r.left + ddx, top: r.top + ddy, width: r.width, height: r.height };
    const P = rec.src || { x: box.left + box.width / 2, y: box.top + box.height };
    const ox = Math.max(0, Math.min(box.width, P.x - box.left)), oy = Math.max(0, Math.min(box.height, P.y - box.top));
    const dx = (P.x - (box.left + ox)) * 0.3, dy = (P.y - (box.top + oy)) * 0.3;
    const undoO = setStyles(el, { transformOrigin: `${ox.toFixed(1)}px ${oy.toFixed(1)}px`, ...(open ? {} : { pointerEvents: 'none' }) });
    const base = shown === 'none' ? '' : shown + ' ';
    const small = `${base}translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(.84)`, big = shown;
    anim = open
      ? el.animate([{ transform: small, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: big, opacity: 1 }], { duration: 340, easing: SPRING })
      : el.animate([{ transform: big, opacity: 1 }, { opacity: 1, offset: 0.25 }, { transform: small, opacity: 0 }], { duration: 190, easing: EASE_IN, fill: 'forwards' });
    rec.undo = () => { undoO(); undoT(); };
  }
  rec.anim = anim;
  anim.addEventListener('finish', () => {
    if (rec.anim !== anim) return;
    rec.anim = null;
    const u = rec.undo; rec.undo = null;
    try { anim.cancel(); } catch (e) {}
    getComputedStyle(el).transform;          // flush with transitions still off, so nothing re-animates
    if (u) u();
  });
}
