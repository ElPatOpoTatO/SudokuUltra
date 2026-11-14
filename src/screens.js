// screens.js — full-screen layers over the game (step 7): Home, the keyboard
// map, a world's level list. One is shown at a time; the game stays loaded
// underneath (Continue = hide the layer). Transform/opacity transitions only;
// reduced motion = a short fade. While a screen is up, the desktop keyboard
// does not reach the board (Escape = back).
import { reducedMotion } from './util.js';
import { cancelAllPresses } from './input.js';

const reg = new Map();     // name -> { el, onShow, onHide, back }
let cur = null;
const listeners = [];
export const onScreen = fn => listeners.push(fn);
export const currentScreen = () => cur;

export function registerScreen(name, el, opts = {}) {
  el.classList.add('scr'); el.dataset.scr = name;
  el.setAttribute('aria-hidden', 'true');
  reg.set(name, { el, ...opts });
}

/** Show a screen. dir: 1 = deeper (slides in from the right), -1 = back, 0 = rise in. */
export function showScreen(name, arg, dir = 0) {
  const s = reg.get(name);
  if (!s) return;
  cancelAllPresses();
  const prev = cur ? reg.get(cur) : null;
  if (s.onShow) s.onShow(arg);
  if (prev && prev !== s) leave(prev, dir);
  enter(s, prev ? dir : 0);
  cur = name;
  document.documentElement.classList.add('scr-on');
  for (const f of listeners) f(cur);
}
export function hideScreens() {
  if (!cur) return;
  const s = reg.get(cur);
  leave(s, 0, true);
  cur = null;
  document.documentElement.classList.remove('scr-on');
  for (const f of listeners) f(null);
}
function enter(s, dir) {
  const el = s.el, rm = reducedMotion();
  el.classList.add('show'); el.setAttribute('aria-hidden', 'false');
  el.scrollTop = 0;
  const from = rm ? 'none' : dir > 0 ? 'translate3d(28px,0,0)' : dir < 0 ? 'translate3d(-28px,0,0)' : 'translate3d(0,14px,0)';
  el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: rm ? 120 : 280, easing: 'cubic-bezier(.2,.8,.25,1)' });
}
function leave(s, dir, toGame = false) {
  const el = s.el, rm = reducedMotion();
  if (s.onHide) s.onHide();
  el.setAttribute('aria-hidden', 'true');
  const to = rm ? 'none' : toGame ? 'translate3d(0,10px,0)' : dir > 0 ? 'translate3d(-20px,0,0)' : 'translate3d(20px,0,0)';
  const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }], { duration: rm ? 100 : 200, easing: 'ease-in' });
  el.classList.add('leaving');
  a.onfinish = () => { el.classList.remove('leaving'); if (cur !== s.el.dataset.scr) el.classList.remove('show'); };
}

// the board's keyboard input stays behind the screens
window.addEventListener('keydown', e => {
  if (!cur || document.querySelector('.sheet.show')) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { const s = reg.get(cur); if (s && s.back) s.back(); }
}, true);
