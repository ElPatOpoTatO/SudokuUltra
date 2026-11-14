// board.js — board DOM build, rendering, refresh, and every cell effect.
// Moved verbatim from the feel prototype (sections 5 buildBoard, 6 RENDERING,
// 7 MOTION). Only change: givens come from S.given (per puzzle).
import { $, div, rowOf, colOf, BOXES, PEERS, PEERFLAG, bit, reducedMotion, dist } from './util.js';
import { S, UI, conflictAt, countOf, wrongAt, hintHooks } from './state.js';
/* --- step8 --- */
import { shownConflict } from './state.js';
/* --- end step8 --- */
import { digitKeys, keys } from './pad.js';

export const boardEl = $('board');
export const statusEl = $('status');
export const mistEl = $('mist');
export const toastEl = $('toast');
export const toastMsg = $('toastMsg');
export const cells = new Array(81);   // {el, v, n:[9 spans], fxA, fxE, fxF}
export const hooks = { afterRefresh: null };

export function buildBoard() {
  for (let b = 0; b < 9; b++) {
    const box = div('box', boardEl);
    for (const i of BOXES[b]) {
      const el = div('cell', box);
      el.dataset.i = i;
      if (S.given[i]) el.classList.add('given');
      const fxT = div('fx fx-t', el), fxG = div('fx fx-g', el);
      const fxA = div('fx fx-a', el), fxE = div('fx fx-e', el), fxF = div('fx fx-f', el);
      const notesEl = div('notes', el);
      const n = [];
      for (let d = 1; d <= 9; d++) { const s = document.createElement('span'); s.textContent = d; notesEl.appendChild(s); n.push(s); }
      const v = div('v', el);
      cells[i] = { el, v, n, fxA, fxE, fxF, fxT, fxG, ghost: null, rub: null };
    }
  }
}
/* New puzzle: re-mark the locked cells. */
export function markGivens() {
  for (let i = 0; i < 81; i++) cells[i].el.classList.toggle('given', !!S.given[i]);
}

/* =========================================================================
   6. RENDERING
   ========================================================================= */
export function killGhost(i) {
  const c = cells[i];
  if (c.ghost) { c.ghost.remove(); c.ghost = null; }
  if (c.rub) { c.rub.remove(); c.rub = null; }
}
export function renderCell(i, cancelAnims = true) {
  killGhost(i);
  const c = cells[i], val = S.values[i];
  c.v.textContent = val ? String(val) : '';
  const m = val ? 0 : S.notes[i];
  for (let k = 0; k < 9; k++) {
    const s = c.n[k];
    if (cancelAnims && s.getAnimations) s.getAnimations().forEach(a => a.cancel());
    s.classList.toggle('on', !!(m & (1 << k)));
  }
}
export function renderAll() { for (let i = 0; i < 81; i++) renderCell(i); }


const prevLeft = [];   // last shown count per digit (for the badge flip)
/* Recompute every highlight/indicator from state. Cheap: 81 cells + 12 keys. */
export function refresh() {
  const sel = S.selected;
  const focus = S.loaded || (sel >= 0 ? S.values[sel] : 0);
  const peers = (sel >= 0 && !S.loaded) ? PEERFLAG[sel] : null;
  boardEl.classList.toggle('loaded', !!S.loaded);

  for (let i = 0; i < 81; i++) {
    const c = cells[i], cl = c.el.classList, v = S.values[i];
    cl.toggle('sel', i === sel && !S.loaded);
    cl.toggle('peer', !!(peers && peers[i]));
    cl.toggle('same', !!focus && v === focus);
    cl.toggle('conflict', /* --- step8 --- */ shownConflict(i) /* --- end step8 --- */);
    for (let k = 0; k < 9; k++) c.n[k].classList.toggle('hit', k + 1 === focus);
  }

  for (let d = 1; d <= 9; d++) {
    const k = digitKeys[d], left = 9 - countOf(d);
    k.cnt.textContent = left > 0 ? String(left) : '';
    if (prevLeft[d] >= 0 && left < prevLeft[d] && left > 0) animFlip(k.cnt);
    prevLeft[d] = left;
    k.el.classList.toggle('locked', left <= 0);
    k.el.classList.toggle('latched', S.loaded === d);
    k.el.classList.toggle('note-latched', S.loaded === d && S.loadedNote);
  }
  keys.pencil.classList.toggle('latched', S.pencil);

  const shown = Math.max(0, S.mistakes - UI.mistHeld);   // a chip may still be flying in
  mistEl.textContent = String(shown);
  mistEl.classList.toggle('bad', shown > 0);

  const mode = S.pencil ? 'Pencil' : 'Pen';
  let msg;
  /* --- merge: alt(long, short) keeps the text (textContent) but shows the short
     form when the header is tight (≤ 400 px, style.css .s-long / .s-short) --- */
  const alt = (long, short) => `<span class="s-long">${long}</span><span class="s-short" data-s="${short}"></span>`;
  if (S.solved) msg = S.mode === 'spot' ? 'Spotted' : 'Solved';
  else if (S.loaded) msg = `<b>${S.loaded}</b>` + alt(` loaded${S.loadedNote ? ' as note' : ''} · tap cells`, S.loadedNote ? ' · note' : ' loaded');
  else if (sel >= 0) msg = `R${rowOf(sel) + 1} C${colOf(sel) + 1} · ${mode}`;
  else if (S.mode === 'spot') msg = `Spot a <b>${S.spot.label}</b>` + alt(` · ${mode}`, '');
  else msg = alt('Tap a cell or a number', 'Tap a cell') + ` · ${mode}`;
  statusEl.innerHTML = msg;
  if (hooks.afterRefresh) hooks.afterRefresh();   // autosave (token.js)
  /* --- hints: board changed -> the hint ladder resets --- */
  if (hintHooks.refresh) hintHooks.refresh();
  /* --- end hints --- */
}

/* =========================================================================
   7. MOTION (Web Animations API; transform + opacity only)
   ========================================================================= */
export const EASE_OUT = 'cubic-bezier(.2,.8,.25,1)';

export function animPop(el) {
  if (reducedMotion()) {
    el.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 90, easing: 'ease-out' });
  } else {
    // quick, precise seat: transform only
    el.animate([
      { transform: 'scale(.82)' },
      { transform: 'scale(1.04)', offset: .55 },
      { transform: 'scale(1)' }
    ], { duration: 140, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }
}
/* ~1-frame highlight when a digit lands (opacity only, fine under reduced motion) */
export function animFlash(i) {
  cells[i].fxF.animate([{ opacity: 1 }, { opacity: 1, offset: .14 }, { opacity: 0 }], { duration: 120, easing: 'ease-out' });
}
/* a note is WRITTEN: drawn in from the lower-left like a pencil stroke */
export function animNoteIn(span) {
  if (reducedMotion()) { span.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 70, easing: 'ease-out' }); return; }
  span.animate([
    { transform: 'translate(-28%, 28%) scale(.2) rotate(-18deg)', opacity: 0 },
    { transform: 'translate(4%, -4%) scale(1.12) rotate(3deg)', opacity: 1, offset: .65 },
    { transform: 'none', opacity: 1 }
  ], { duration: 120, easing: 'cubic-bezier(.3,.7,.4,1)' });
}
/* a note toggled off: a tiny flick (the class is already off; the animation holds it visible) */
export function animNoteFlick(span, dir) {
  if (reducedMotion()) { span.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80 }); return; }
  span.animate([
    { transform: 'none', opacity: 1 },
    { transform: `scale(1.12) rotate(${6 * dir}deg)`, opacity: 1, offset: .3 },
    { transform: `translate(${30 * dir}%, -30%) scale(.1) rotate(${-20 * dir}deg)`, opacity: 0 }
  ], { duration: 140, easing: 'ease-in' });
}
/* ERASE: 3 wipe strokes. A ghost of the old content smears with each stroke
   while an eraser-shaped highlight rubs across; both are removed after. */
export const ERASE_MS = 240;
export const ERASE_STROKES = [.30, .60, .88];
export function animErase(i, val, notes, color) {
  const c = cells[i], rm = reducedMotion(), dir = Math.random() < .5 ? -1 : 1;
  let ghost;
  if (val) {
    ghost = div('v ghost', c.el); ghost.textContent = String(val); ghost.style.color = color;
  } else {
    ghost = div('notes ghost', c.el);
    for (let d = 1; d <= 9; d++) { const sp = document.createElement('span'); sp.textContent = d; if (notes & bit(d)) sp.className = 'on'; ghost.appendChild(sp); }
  }
  const rub = div('rub', c.el);
  c.ghost = ghost; c.rub = rub;
  const done = () => { if (c.ghost === ghost) killGhost(i); };
  if (rm) {
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' }).onfinish = done;
    rub.animate([{ opacity: 0 }, { opacity: .8, offset: .3 }, { opacity: 0 }], { duration: 140 });
    return dir;
  }
  const sm = val ? 1 : .6;   // notes smudge a little less
  ghost.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translateX(${10 * dir * sm}%) skewX(${-12 * dir}deg) scaleX(1.06)`, opacity: .68, offset: ERASE_STROKES[0] },
    { transform: `translateX(${-7 * dir * sm}%) skewX(${9 * dir}deg) scaleX(1.12)`, opacity: .36, offset: ERASE_STROKES[1] },
    { transform: `translateX(${9 * dir * sm}%) skewX(${-12 * dir}deg) scaleX(1.18)`, opacity: .08, offset: ERASE_STROKES[2] },
    { transform: `translateX(${12 * dir * sm}%) scaleX(1.22)`, opacity: 0 }
  ], { duration: ERASE_MS, easing: 'linear', fill: 'forwards' }).onfinish = done;
  const r = `rotate(${8 * dir}deg)`;
  rub.animate([
    { transform: `translateX(${-110 * dir}%) ${r}`, opacity: 0 },
    { transform: `translateX(${-70 * dir}%) ${r}`, opacity: 1, offset: .08 },
    { transform: `translateX(${90 * dir}%) ${r}`, opacity: 1, offset: ERASE_STROKES[0] },
    { transform: `translateX(${-80 * dir}%) ${r}`, opacity: 1, offset: ERASE_STROKES[1] },
    { transform: `translateX(${110 * dir}%) ${r}`, opacity: 0 }
  ], { duration: ERASE_MS, easing: 'ease-in-out', fill: 'forwards' });
  return dir;
}
/* count badge ticks down with a tiny flip */
export function animFlip(el) {
  if (reducedMotion()) { el.animate([{ opacity: .2 }, { opacity: 1 }], { duration: 120 }); return; }
  el.animate([
    { transform: 'perspective(40px) rotateX(-90deg)', opacity: 0 },
    { transform: 'perspective(40px) rotateX(15deg)', opacity: 1, offset: .7 },
    { transform: 'none', opacity: 1 }
  ], { duration: 170, easing: 'ease-out' });
}
/* SELECT: the row/col/box tint sweeps outward from the cell (shows its reach) */
export function animReach(i) {
  const rm = reducedMotion();
  for (let j = 0; j < 81; j++) { const t = cells[j].fxT; if (t.getAnimations) t.getAnimations().forEach(a => a.cancel()); }
  if (rm) return;
  for (const j of PEERS[i]) {
    cells[j].fxT.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, delay: dist(i, j) * 12, easing: 'ease-out', fill: 'backwards' });
  }
}
/* PENCIL TOGGLE: empty cells shimmer (graphite) or catch an ink sheen,
   sweeping up from the bottom-right where the Pencil key sits */
export function animModeShimmer(pencilOn) {
  const rm = reducedMotion();
  for (let i = 0; i < 81; i++) {
    if (S.values[i]) continue;
    const layer = pencilOn ? cells[i].fxG : cells[i].fxA, peak = pencilOn ? 1 : .45;
    layer.animate([{ opacity: 0 }, { opacity: peak, offset: .35 }, { opacity: 0 }],
      { duration: rm ? 200 : 300, delay: rm ? 0 : (8 - rowOf(i)) * 14 + (8 - colOf(i)) * 6, easing: 'ease-out' });
  }
}
export function animPing(i, delay, peak = .7) {
  cells[i].fxA.animate([{ opacity: 0 }, { opacity: peak, offset: .3 }, { opacity: 0 }], { duration: 240, delay: Math.max(0, delay), easing: 'ease-out' });
}
export function bumpCounter() {
  if (reducedMotion()) { mistEl.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 150 }); return; }
  mistEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.32)', offset: .35 }, { transform: 'scale(1)' }],
    { duration: 220, easing: 'cubic-bezier(.3,1.4,.5,1)' });
}
export function animNoteOut(span, delay, onDone) {
  // fill:'both' keeps the note visible during its delay, even though state already removed it
  const a = span.animate([
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(1.35)', opacity: .9, offset: .25 },
    { transform: 'scale(.2)', opacity: 0 }
  ], { duration: reducedMotion() ? 90 : 190, delay, easing: 'ease-in', fill: 'both' });
  a.onfinish = () => { onDone(); a.cancel(); };
}
export function animShake(i) {
  const c = cells[i], rm = reducedMotion();
  const xs = rm ? [0, -2, 2, 0] : [0, -6, 5, -4, 3, -1.5, 0];
  c.el.animate(xs.map(x => ({ transform: `translateX(${x}px)` })), { duration: rm ? 150 : 320, easing: 'ease-out' });
  c.fxE.animate([{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
}
export function animBlink(i) {
  cells[i].fxE.animate([{ opacity: 0 }, { opacity: .9 }, { opacity: 0 }, { opacity: .9 }, { opacity: 0 }],
    { duration: 560, easing: 'linear' });
}
export function animSweep(unit, origin, startDelay) {
  // light travels outward along the unit from the placed cell
  const order = unit.slice().sort((a, b) => dist(a, origin) - dist(b, origin) || a - b);
  order.forEach((i, k) => {
    cells[i].fxA.animate([{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 0 }],
      { duration: reducedMotion() ? 220 : 340, delay: startDelay + k * SWEEP_STEP(), easing: 'ease-out' });
  });
}
export function animCascade(origin = 0) {
  // radiates from the winning move (origin 0 = the old top-left diagonal)
  const rm = reducedMotion();
  let far = 0;
  for (let i = 0; i < 81; i++) {
    const delay = dist(i, origin) * (rm ? 12 : 38);
    if (delay > far) far = delay;
    cells[i].fxA.animate([{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 0 }], { duration: 520, delay, easing: 'ease-out' });
    if (!rm) cells[i].v.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)', offset: .35 }, { transform: 'scale(1)' }],
      { duration: 380, delay, easing: EASE_OUT });
  }
  return far + 520;
}
export const CASCADE_STEP = () => reducedMotion() ? 12 : 38;
export const SWEEP_STEP = () => reducedMotion() ? 10 : 30;
