// screens.js — full-screen layers over the game (step 7): Home, the keyboard
// map, a world's level list. One is shown at a time; the game stays loaded
// underneath (Continue = hide the layer). Transform/opacity transitions only;
// reduced motion = a short fade. While a screen is up, the desktop keyboard
// does not reach the board (Escape = back).
import { reducedMotion } from './util.js';
import { cancelAllPresses } from './input.js';
/* --- step10: spatial transitions (morph.js): the destination grows out of the tapped key --- */
import { regLayer, note } from './morph.js';
/* --- end step10 --- */

const reg = new Map();     // name -> { el, onShow, onHide, back }
let cur = null;
const listeners = [];
export const onScreen = fn => listeners.push(fn);
export const currentScreen = () => cur;

export function registerScreen(name, el, opts = {}) {
  el.classList.add('scr'); el.dataset.scr = name;
  el.setAttribute('aria-hidden', 'true');
  reg.set(name, { el, ...opts });
  /* --- step10 --- */
  const s = reg.get(name);
  regLayer(name, {
    el: () => el,
    anchor: from => (opts.anchor ? opts.anchor(from) : null),
    fallbackIn: dir => enterAnim(s, dir),
    fallbackOut: dir => leaveAnim(s, dir, false),
    outDone: () => leaveDone(s)
  });
  /* --- end step10 --- */
}

/** Show a screen. dir: 1 = deeper (slides in from the right), -1 = back, 0 = rise in. */
export function showScreen(name, arg, dir = 0) {
  const s = reg.get(name);
  if (!s) return;
  cancelAllPresses();
  const prev = cur ? reg.get(cur) : null;
  if (s.onShow) s.onShow(arg);
  cur = name;
  if (prev && prev !== s) leave(prev, dir);
  if (prev !== s) enter(s, prev ? dir : 0);     /* step10: the same screen again just repaints */
  document.documentElement.classList.add('scr-on');
  for (const f of listeners) f(cur);
}
export function hideScreens() {
  if (!cur) return;
  const s = reg.get(cur);
  cur = null;
  leave(s, 0, true);
  document.documentElement.classList.remove('scr-on');
  for (const f of listeners) f(null);
}
function enter(s, dir) {
  const el = s.el;
  el.classList.remove('leaving');
  el.classList.add('show'); el.setAttribute('aria-hidden', 'false');
  el.scrollTop = 0;
  if (!note('in', el.dataset.scr, dir)) enterAnim(s, dir);     /* step10: morph.js animates it */
}
function enterAnim(s, dir) {
  const el = s.el, rm = reducedMotion();
  const from = rm ? 'none' : dir > 0 ? 'translate3d(28px,0,0)' : dir < 0 ? 'translate3d(-28px,0,0)' : 'translate3d(0,14px,0)';
  el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: rm ? 120 : 280, easing: 'cubic-bezier(.2,.8,.25,1)' });
}
function leave(s, dir, toGame = false) {
  const el = s.el;
  if (s.onHide) s.onHide();
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('leaving');
  if (!note('out', el.dataset.scr, dir)) leaveAnim(s, dir, toGame);   /* step10 */
}
function leaveAnim(s, dir, toGame) {
  const el = s.el, rm = reducedMotion();
  const to = rm ? 'none' : toGame ? 'translate3d(0,10px,0)' : dir > 0 ? 'translate3d(-20px,0,0)' : 'translate3d(20px,0,0)';
  const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }], { duration: rm ? 100 : 200, easing: 'ease-in' });
  el.classList.add('leaving');
  a.onfinish = () => leaveDone(s);
}
function leaveDone(s) {
  const el = s.el;
  el.classList.remove('leaving');
  if (cur !== el.dataset.scr) el.classList.remove('show');
}

// the board's keyboard input stays behind the screens
window.addEventListener('keydown', e => {
  if (!cur || document.querySelector('.sheet.show')) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { const s = reg.get(cur); if (s && s.back) s.back(); }
}, true);
