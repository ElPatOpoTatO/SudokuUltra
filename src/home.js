// home.js — the HOME screen (step 7): shown at launch instead of jumping into
// a puzzle. Title, expertise (tier + inner level), the total charge bar and big
// keycap buttons: Continue (resume the last puzzle), Campaign (→ the keyboard
// map), Free Mode (dispatches sudoku:nav {to:'free'}), Settings. DEV label
// opens the dev menu. See docs/progression.md.
import { div, reducedMotion } from './util.js';
import { sfx } from './audio.js';
import { S } from './state.js';
import { makeKey } from './pad.js';
import { bindPress } from './input.js';
import { modeLabel, entry } from './puzzles.js';
import { registerScreen, showScreen } from './screens.js';
import { getProfile, expertise, totals, levelInfo } from './profile.js';
import { meter, setMeter, BOLT_SVG } from './chargeui.js';
import { TIERS_PLANNED, INNER_MAX, TIERS } from './progcfg.js';
/* --- step10: effects (deltas since last seen, the title settling, spatial anchors) --- */
import { seenGet, seenSet } from './uistate.js';
import { swPress } from './switches.js';
/* --- end step10 --- */

export const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-5.5h4V20h5V9.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  kbd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M6.5 9.5h.01M10.2 9.5h.01M13.8 9.5h.01M17.5 9.5h.01M6.5 13h.01M10.2 13h.01M13.8 13h.01M17.5 13h.01M8 16h8"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>'
};

/** A round header button for the screens (back / home). */
export function screenBtn(parent, icon, label, fn) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'sbtn'; b.innerHTML = icon; b.setAttribute('aria-label', label);
  b.addEventListener('click', () => { sfx.mod(); fn(); });
  parent.appendChild(b);
  return b;
}

/** Expertise block: tier pill + inner level + 10 segments + "Tier n of 5". */
const segF = (e, k) => (k < e.inner ? 1 : k === e.inner ? (e.inner >= INNER_MAX ? 1 : Math.max(0.12, e.progress)) : 0);
export function expertiseEl(parent, compact = false) {
  const x = div('xp' + (compact ? ' sm' : ''), parent);
  x._paint = () => {
    const e = expertise();
    let seg = '';
    for (let k = 1; k <= INNER_MAX; k++) {
      const f = segF(e, k);
      seg += `<i style="--f:${f.toFixed(3)}"${k <= e.inner ? ' class="on"' : ''}><b></b></i>`;
    }
    let tiers = '';
    for (let k = 1; k <= TIERS_PLANNED; k++) tiers += `<i${k <= e.tier ? ' class="on"' : ''}></i>`;
    x.innerHTML = `<div class="xp-top"><span class="xp-tier">${e.name}</span><span class="xp-lv">Level <b>${e.inner}</b></span><span class="xp-tiers" title="Tier ${e.tier} of ${TIERS_PLANNED}">${tiers}</span></div><div class="xp-seg" aria-hidden="true">${seg}</div>`;
    x.setAttribute('aria-label', `Expertise: ${e.name}, level ${e.inner} of ${INNER_MAX}, tier ${e.tier} of ${TIERS_PLANNED}`);
    x.dataset.tier = e.tier; x.dataset.inner = e.inner;
    return e;
  };
  x._paint();
  return x;
}
/* --- step10: the expertise segments fill from what was last seen to now (purpose: what
   you gained). Same tier only; one switch tick per inner level crossed, climbing the
   pentatonic ladder; the "Level n" number steps up as each level is crossed.
   The DOM (data-inner, aria) is final at once: only the paint lags. Returns ms. --- */
export const FXLOG = { xp: 0, total: 0, title: 0 };
function animateXp(x, from, e, delay = 160) {
  if (!from || from.tier !== e.tier || reducedMotion()) return 0;
  const T = TIERS.find(t => t.tier === from.tier) || TIERS[0];
  const fInner = Math.max(1, Math.min(INNER_MAX, from.inner | 0));
  const fe = { inner: fInner, progress: fInner >= INNER_MAX ? 1 : Math.max(0, Math.min(1, ((from.points | 0) - (fInner - 1) * T.perInner) / T.perInner)) };
  const segs = [...x.querySelectorAll('.xp-seg i')];
  const steps = [];
  let amount = 0;
  segs.forEach((el, j) => {
    const k = j + 1, f0 = segF(fe, k), f1 = segF(e, k);
    if (f1 > f0 + 0.001) { steps.push({ el: el.firstChild, f0, f1, k, cross: f1 >= 1 && k < e.inner }); amount += f1 - f0; }
  });
  if (!steps.length) return 0;
  const D = Math.min(700, 300 + amount * 170);
  let t = delay, crossed = 0;
  const lv = x.querySelector('.xp-lv b');
  if (lv && e.inner > fInner) lv.textContent = String(fInner);
  steps.forEach((s, j) => {
    const d = Math.max(60, D * (s.f1 - s.f0) / amount), last = j === steps.length - 1;
    s.el.animate([{ transform: `scaleX(${s.f0.toFixed(3)})` }, { transform: `scaleX(${s.f1.toFixed(3)})` }],
      { duration: d, delay: t, easing: last ? 'cubic-bezier(.2,.8,.3,1)' : 'linear', fill: 'backwards' });
    t += d;
    if (s.cross) {
      const n = ++crossed, at = t, inner = Math.min(e.inner, fInner + n);
      sfx.noteTick(at / 1000, n - 1);
      setTimeout(() => {
        if (!lv || !lv.isConnected) return;
        lv.textContent = String(inner);
        lv.animate([{ transform: 'scale(1.3)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      }, at);
    }
  });
  if (lv && e.inner > fInner) setTimeout(() => { if (lv.isConnected) lv.textContent = String(e.inner); }, t + 20);
  FXLOG.xp++;
  return t;
}
/** Paint an expertise block + a total meter, animating only what is new since last seen. */
export function paintGains(xpEl, totEl, { delay = 160 } = {}) {
  const e = xpEl._paint(), t = totals();
  const fromXp = seenGet('xp', null), fromTot = seenGet('total', t.earned);
  const ms = animateXp(xpEl, fromXp, e, delay);
  const grew = fromTot < t.earned && !reducedMotion();
  setMeter(totEl, t.earned, t.available, t.all, grew ? { animate: true, from: fromTot, delay: delay + Math.min(ms, 240), dur: 560 } : {});
  if (grew) FXLOG.total++;
  seenSet('xp', { tier: e.tier, inner: e.inner, points: e.points });
  seenSet('total', t.earned);
}
/* --- end step10 --- */

let el, xpEl, totEl, contKey, contSub, campKey, freeKey, setKey, onDev = null;
const LETTERS = 'SUDOKU';

export function lastPlayed() {
  // { id, ctx: {world,k}|null } of the puzzle the game would resume, or null
  let ctx = null;
  try { ctx = JSON.parse(localStorage.getItem('sudoku.lastctx') || 'null'); } catch (e) {}
  if (sessionPlayed && S.id && (!ctx || ctx.id !== S.id)) ctx = { id: S.id };
  if (!ctx || !ctx.id) return null;
  return { id: ctx.id, ctx: ctx.world != null ? ctx : null };
}
let sessionPlayed = false;
export function markSessionPlayed() { sessionPlayed = true; }
/* --- step 9: a backup code replaced the stored state: forget this session's puzzle --- */
export function forgetSessionPlayed() { sessionPlayed = false; }
/* --- end step 9 --- */

function contLabel(lp) {
  if (!lp) return '';
  const L = levelInfo(lp.id);
  if (L) return `World ${L.world} · ${L.k === 0 ? 'Level 0' : L.k <= 6 ? `Spot it ${L.k}` : L.k <= 12 ? `Use it ${L.k - 6}` : 'Master'}`;
  const e = entry(lp.id), cap = t => t ? t[0].toUpperCase() + t.slice(1) : '';
  if (e && e.kind === 'quick') return `Quick Play · ${cap(e.band)}`;
  if (e && e.kind === 'daily') return `Daily · ${cap(e.item.band)}`;
  return modeLabel(lp.id) || lp.id;
}

export function paintHome() {
  if (!el) return;
  /* --- step10: deltas since last seen --- */ paintGains(xpEl, totEl); /* --- end step10 --- */
  const lp = lastPlayed();
  contKey.classList.toggle('gone', !lp);
  contSub.textContent = contLabel(lp);
  el.classList.toggle('nocont', !lp);
  setKey.classList.toggle('badge', getProfile().flags.badge);
}

export function buildHome({ onContinue, onCampaign, onFree, onSettings, onDevMenu }) {
  onDev = onDevMenu;
  el = div('home', document.body); el.id = 'home';
  el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Home');
  const inner = div('scr-in', el);
  const top = div('home-top', inner);
  const dev = document.createElement('button'); dev.type = 'button'; dev.className = 'home-dev'; dev.innerHTML = '<b>DEV</b>';
  dev.setAttribute('aria-label', 'DEV menu'); dev.addEventListener('click', () => { sfx.mod(); if (onDev) onDev(); });
  top.appendChild(dev);

  const main = div('home-main', inner);
  const title = div('home-title kp', main);
  title.setAttribute('role', 'heading'); title.setAttribute('aria-level', '1'); title.setAttribute('aria-label', 'Sudoku');
  [...LETTERS].forEach((ch, k) => {
    const kk = makeKey('digit tl' + (k % 2 ? ' ev' : ''), `<span class="lg">${ch}</span>`, title);
    kk.setAttribute('aria-hidden', 'true');
    bindPress(kk, () => sfx.pen());
  });
  const tag = div('home-tag', main); tag.textContent = 'Learn a trick. Spot it. Use it.';

  const card = div('home-card', main);
  xpEl = expertiseEl(card);
  totEl = meter(card, { label: 'Total charges', ticks: 0, big: true });
  totEl.classList.add('tot');

  const keys = div('home-keys kp', main);
  contKey = makeKey('mod hk hbig cont', `<span class="hic">${ICON.play}</span><span class="htx"><span class="lbl">Continue</span><small></small></span>`, keys);
  contSub = contKey.querySelector('small');
  contKey.setAttribute('aria-label', 'Continue');
  const row = div('home-row', keys);
  campKey = makeKey('mod hbig sq camp', `<span class="hic">${ICON.kbd}</span><span class="htx"><span class="lbl">Campaign</span><small>Worlds &amp; tricks</small></span>`, row);
  campKey.setAttribute('aria-label', 'Campaign');
  freeKey = makeKey('mod hbig sq free', `<span class="hic">${ICON.grid}</span><span class="htx"><span class="lbl">Free Mode</span><small>Quick play · Daily</small></span>`, row);
  freeKey.setAttribute('aria-label', 'Free Mode');
  setKey = makeKey('mod hbig set', `<span class="hic">${ICON.gear}</span><span class="htx"><span class="lbl">Settings</span><small>Keycaps · colorways · sound</small></span><i class="dotb"></i>`, keys);
  setKey.setAttribute('aria-label', 'Settings');
  bindPress(contKey, () => { sfx.mod(); onContinue(); });
  bindPress(campKey, () => { sfx.mod(); onCampaign(); });
  bindPress(freeKey, () => { sfx.mod(); onFree(); });
  bindPress(setKey, () => { sfx.mod(); onSettings(); });

  const foot = div('home-foot', inner);
  foot.innerHTML = `<span class="bolt">${BOLT_SVG}</span> Earn up to 3 charges a level: solve it, no hints, at most 1 mistake.`;

  /* --- step10: anchors = the key each screen collapses back into --- */
  registerScreen('home', el, {
    onShow: () => { paintHome(); settleTitle(title); },
    anchor: from => (from === 'free' ? freeKey : from === 'game' ? (contKey.classList.contains('gone') ? null : contKey) : campKey)
  });
  /* --- end step10 --- */
  paintHome();
  return el;
}

export function showHome(dir = -1) { showScreen('home', null, dir); }

/* --- step10: the SUDOKU keycaps settle once per session (source: each key) — a short
   drop in reading order, each landing with the player's switch at low volume. --- */
const TITLE_KEY = 'sudoku.fx.title';
function settleTitle(title) {
  try { if (sessionStorage.getItem(TITLE_KEY)) return; sessionStorage.setItem(TITLE_KEY, '1'); } catch (e) { return; }
  const rm = reducedMotion(), keys = [...title.querySelectorAll(':scope > .key')];
  FXLOG.title++;
  keys.forEach((k, j) => {
    const cap = k.querySelector(':scope > .cap'), sh = k.querySelector(':scope > .shadow');
    const delay = 120 + j * 55, dur = rm ? 160 : 300;
    if (rm) cap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay, fill: 'backwards' });
    else {
      cap.animate([
        { transform: 'translate3d(0,-16px,0)', opacity: 0 },
        { transform: 'translate3d(0,-16px,0)', opacity: 1, offset: 0.15 },
        { transform: 'translate3d(0,2px,0)', opacity: 1, offset: 0.7 },
        { transform: 'none', opacity: 1 }
      ], { duration: dur, delay, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'backwards' });
      if (sh) sh.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: dur, delay, fill: 'backwards' });
    }
    setTimeout(() => swPress(0.28), delay + (rm ? 0 : dur * 0.7));
  });
}
/* --- end step10 --- */
