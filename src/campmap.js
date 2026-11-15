// campmap.js — the CAMPAIGN screen is a keyboard being built (step 7).
// A 4×4 plate of 16 sockets (one per planned world). A mastered world's keycap
// sits in its socket (in the player's own keycap style and colorway); the open
// world shows a bare switch waiting for its cap; worlds not open yet and worlds
// still to come are empty sockets. Mastering a world plays a build animation
// the next time the map opens: the cap drops in with its switch sound.
// Tapping a world opens its level list (14 tiles with charges, Master gate).
import { div, reducedMotion, haptic } from './util.js';
import { sfx } from './audio.js';
import { makeKey } from './pad.js';
import { bindPress } from './input.js';
import { dressKey, isClassic } from './settings.js';
import { registerScreen, showScreen } from './screens.js';
import { worldStats, totals, isWorldOpen, isMastered, worldCount, takePendingBuild, getProfile } from './profile.js';
import { meter, setMeter, pips, BOLT_SVG } from './chargeui.js';
import { SPARKS } from './sparks.js';
import { ICON, screenBtn, expertiseEl, paintGains } from './home.js';
/* --- step10: deltas since last seen (uistate.js) --- */
import { seenGet, seenSet } from './uistate.js';
/* --- end step10 --- */
import { SOCKETS, WORLD_INFO, WORLD_CHARGES, MASTER_GATE } from './progcfg.js';

let mapEl, wEl, kbdEl, xpEl, totEl, nextEl, sockets = [], cb = null;
let wTitle, wSub, wMeter, wBody, curWorld = 0;
export const MAP = { built: [], lastBuild: [] };

const levelName = k => (k === 0 ? 'Level 0' : k <= 6 ? `Spot it ${k}` : k <= 12 ? `Use it ${k - 6}` : 'Master');

/* ---- the keyboard map -------------------------------------------------------- */
function socketState(w) {
  if (w >= worldCount()) return 'future';
  if (isMastered(w)) return 'built';
  if (isWorldOpen(w)) return 'open';
  return 'locked';
}
function paintSocket(s, state) {
  const k = s.key;
  k.classList.remove('built', 'open', 'locked', 'future');
  k.classList.add(state);
  s.state = state;
  k.setAttribute('aria-label', state === 'future' ? 'Empty socket: more worlds to come'
    : `World ${s.w}, ${WORLD_INFO[s.w].name}: ${state === 'built' ? 'mastered' : state === 'open' ? 'open' : 'locked'}`);
  k.setAttribute('aria-disabled', String(state === 'locked' || state === 'future'));
}
function buildMap() {
  mapEl = div('cmap', document.body); mapEl.id = 'campMap';
  mapEl.setAttribute('role', 'region'); mapEl.setAttribute('aria-label', 'Campaign');
  const inner = div('scr-in', mapEl);
  const bar = div('scr-bar', inner);
  screenBtn(bar, ICON.back, 'Home', () => cb.home());
  const t = div('scr-title', bar); t.innerHTML = '<h1>Campaign</h1>';
  div('scr-sp', bar);
  const head = div('cmap-head', inner);
  xpEl = expertiseEl(head, true);
  totEl = meter(head, { label: 'Total charges', ticks: 0 });
  totEl.classList.add('tot');

  const kcase = div('kcase', inner);
  const badge = div('kbadge', kcase); badge.innerHTML = '<span>SDK·16</span><i></i>';
  kbdEl = div('kbd kp', kcase);
  for (const c of ['tl', 'tr', 'bl', 'br']) div('screw ' + c, kcase);
  sockets = [];
  for (let i = 0; i < SOCKETS; i++) {
    const r = (i / 4) | 0, c = i % 4;
    const k = makeKey('digit wk r' + Math.min(3, r + 1) + ((r + c) % 2 ? ' ev' : ''), `<span class="lg">${i}</span><span class="wl">${WORLD_INFO[i] ? WORLD_INFO[i].short : ''}</span>`, kbdEl);
    k.dataset.world = String(i);
    k.setAttribute('role', 'button');
    if (!isClassic()) dressKey(k);         // (the debug-only classic look stays undressed)
    const pl = k.querySelector('.sw .pl'); if (pl) pl.textContent = i < worldCount() ? 'W' + i : '';
    const sk = div('sock', k); if (i < worldCount()) sk.dataset.w = 'W' + i;
    const s = { w: i, key: k, state: '' };
    bindPress(k, () => tapSocket(s));
    sockets.push(s);
  }
  nextEl = div('cmap-next', inner);
  const cap = div('cmap-cap', inner);
  cap.textContent = `Master a world to set its keycap. ${SOCKETS - worldCount()} more sockets to fill.`;
  registerScreen('campaign', mapEl, {
    onShow: () => { paintMap(); pulseLast(); }, back: () => cb.home(),
    /* step10: back from a world's list (or the game) collapses into that world's key */
    anchor: from => { const w = from === 'world' ? curWorld : cb.gameWorld ? cb.gameWorld() : null; const s = w != null ? sockets[w] : null; return s && s.state !== 'locked' && s.state !== 'future' ? s.key : null; }
  });
}
function tapSocket(s) {
  if (s.state === 'built' || s.state === 'open') { sfx.pen(); openWorld(s.w, 1); return; }
  sfx.blocked(); haptic(10);
  if (!reducedMotion()) s.key.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 180 });
  if (s.state === 'locked') flashNext(`Master World ${s.w - 1} to open World ${s.w}.`);
  else flashNext('More worlds are on the way.');
}
let nextTimer = 0;
function flashNext(msg) {
  const m = nextEl.querySelector('.cmap-msg');
  if (!m) return;
  m.textContent = msg; m.classList.add('show');
  clearTimeout(nextTimer); nextTimer = setTimeout(() => { m.classList.remove('show'); }, 2200);
}
export function paintMap() {
  if (!mapEl) return;
  /* --- step10 --- */ paintGains(xpEl, totEl, { delay: 280 }); /* --- end step10 --- */
  const pending = new Set(getProfile().flags.pendingBuild);
  for (const s of sockets) paintSocket(s, pending.has(s.w) ? 'open' : socketState(s.w));
  MAP.built = sockets.filter(s => s.state === 'built').map(s => s.w);
  // the world to play next: the open, unmastered one (else the last one)
  let w = sockets.find(s => socketState(s.w) === 'open');
  w = w ? w.w : Math.max(0, worldCount() - 1);
  const st = worldStats(w);
  nextEl.innerHTML = '';
  const card = div('wcard', nextEl); card.setAttribute('role', 'button'); card.tabIndex = 0;
  card.innerHTML = `<div class="wc-t"><b>World ${w}</b><span>${WORLD_INFO[w].name}</span></div><span class="wc-go">${st.mastered ? 'Replay' : 'Open'} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></span>`;
  const m = meter(card, { label: `World ${w} charges`, ticks: 13 });
  /* --- step10: the next world's card shows its charge delta once --- */
  const wc0 = seenGet('wc.' + w, st.earned);
  setMeter(m, st.earned, WORLD_CHARGES, WORLD_CHARGES, wc0 < st.earned ? { animate: true, from: wc0, delay: 320 } : {});
  seenSet('wc.' + w, st.earned);
  /* --- end step10 --- */
  card.addEventListener('click', () => { sfx.pen(); openWorld(w, 1); });
  div('cmap-msg', nextEl);
}
/** Play the build animation for the worlds mastered since the map was last seen. */
export function playBuilds() {
  const list = takePendingBuild();
  MAP.lastBuild = list.slice();
  list.forEach((w, j) => {
    const s = sockets[w];
    if (!s) return;
    setTimeout(() => dropCap(s), (reducedMotion() ? 150 : 420) + j * 520);
  });
  return list;
}
function dropCap(s) {
  paintSocket(s, 'built');
  MAP.built = sockets.filter(x => x.state === 'built').map(x => x.w);
  const cap = s.key.querySelector(':scope > .cap'), sh = s.key.querySelector(':scope > .shadow');
  const land = () => {
    sfx.pen();                                  // the player's switch (sfx routes it to sfx.sw)
    setTimeout(() => sfx.release(), 95);
    haptic(12);
  };
  if (reducedMotion()) {
    cap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    land(); return;
  }
  cap.animate([
    { transform: 'translate3d(0,-54px,0) scale(1.08)', opacity: 0 },
    { transform: 'translate3d(0,-54px,0) scale(1.08)', opacity: 1, offset: 0.12 },
    { transform: 'translate3d(0,3px,0) scale(1)', opacity: 1, offset: 0.62 },
    { transform: 'translate3d(0,-2px,0)', opacity: 1, offset: 0.8 },
    { transform: 'translate3d(0,0,0)', opacity: 1 }
  ], { duration: 520, easing: 'cubic-bezier(.45,0,.55,1)' });
  if (sh) sh.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 0, transform: 'scale(.7)', offset: 0.3 }, { opacity: 1, transform: 'none', offset: 0.62 }, { opacity: 1 }], { duration: 520 });
  setTimeout(() => {
    land();
    const r = s.key.getBoundingClientRect();
    SPARKS.crackle({ x: r.left + r.width / 2, y: r.bottom - 4 }, 6);
    kbdEl.animate([{ transform: 'none' }, { transform: 'translate3d(0,1.5px,0)' }, { transform: 'none' }], { duration: 160 });
  }, 320);
}

/* ---- a world's level list ---------------------------------------------------- */
function buildWorld() {
  wEl = div('cworld', document.body); wEl.id = 'campWorld';
  wEl.setAttribute('role', 'region'); wEl.setAttribute('aria-label', 'World');
  const inner = div('scr-in', wEl);
  const bar = div('scr-bar', inner);
  screenBtn(bar, ICON.back, 'Keyboard', () => openMap(-1));
  const t = div('scr-title', bar);
  wTitle = document.createElement('h1'); wSub = document.createElement('span');
  t.append(wTitle, wSub);
  screenBtn(bar, ICON.home, 'Home', () => cb.home());
  const mrow = div('cw-meter', inner);
  wMeter = meter(mrow, { label: 'World charges', ticks: 13, big: true });
  wBody = div('cw-body kp', inner);
  registerScreen('world', wEl, {
    onShow: w => { paintWorld(w); enterWorldFx(w); }, back: () => openMap(-1),
    /* step10: back from a level collapses into its tile */
    anchor: from => { const id = from === 'game' && cb.gameLevel ? cb.gameLevel() : null; return id ? wBody.querySelector(`[data-level="${id}"]`) : null; }
  });
}
function tile(parent, w, lv, cls, label, sub) {
  const k = makeKey('digit lt ' + cls, `<span class="lg">${label}</span>${sub ? `<span class="lts">${sub}</span>` : ''}`, parent);
  k.dataset.level = `${w}.${lv.k}`;
  k.setAttribute('aria-label', `${levelName(lv.k)}: ${lv.best < 0 ? 'not played' : lv.k === 0 ? 'done' : lv.best + ' of 3 charges'}`);
  return k;
}
function section(name, extra = '') {
  const s = div('cw-sec', wBody);
  const h = div('cw-h', s); h.innerHTML = `<span>${name}</span>${extra}`;
  return s;
}
export function paintWorld(w) {
  curWorld = w;
  const st = worldStats(w);
  wTitle.textContent = `World ${w}`;
  wSub.textContent = WORLD_INFO[w].name;
  setMeter(wMeter, st.earned, WORLD_CHARGES);
  wBody.innerHTML = '';
  const L = st.levels;
  // Level 0
  const s0 = section('Level 0', '<em>Guided · no charges</em>');
  const r0 = div('cw-row one', s0);
  const t0 = tile(r0, w, L[0], 'wide l0t' + (L[0].done ? ' done' : ''), L[0].done ? 'Learn again' : 'Learn the trick', '');
  t0.querySelector('.cap').insertAdjacentHTML('beforeend', `<span class="ltk">${L[0].done ? '✓ Done' : 'Start here'}</span>`);
  bindPress(t0, () => { sfx.pen(); cb.play(w, 0); });
  // Spot it / Use it
  for (const [name, a] of [['Spot it', 1], ['Use it', 7]]) {
    const got = L.slice(a, a + 6).reduce((x, l) => x + Math.max(0, l.best), 0);
    const s = section(name, `<em>${got}/18 <span class="b">${BOLT_SVG}</span></em>`);
    const r = div('cw-row six', s);
    for (let j = 0; j < 6; j++) {
      const lv = L[a + j];
      const k = tile(r, w, lv, lv.best >= 0 ? 'played' : '', String(j + 1), '');
      pips(lv.best, k.querySelector('.cap'));
      bindPress(k, () => { sfx.pen(); cb.play(w, lv.k); });
    }
  }
  // Master
  const lm = L[13];
  const sm = section('Master', `<em>${st.mastered ? 'Mastered' : st.masterOpen ? 'Unlocked' : 'Locked'}</em>`);
  const rm = div('cw-row one', sm);
  if (st.masterOpen) {
    const k = tile(rm, w, lm, 'wide mt open' + (lm.best >= 0 ? ' played' : ''), 'Master', '');
    k.classList.add('hk');
    pips(lm.best, k.querySelector('.cap'));
    bindPress(k, () => { sfx.pen(); cb.play(w, 13); });
  } else {
    const k = div('mlock', rm);
    k.dataset.level = `${w}.13`;
    k.setAttribute('role', 'button'); k.setAttribute('aria-disabled', 'true');
    k.setAttribute('aria-label', `Master locked: ${MASTER_GATE - st.gate} more charges to unlock`);
    k.innerHTML = `<span class="ml-ic">${ICON.lock}</span><span class="ml-t"><b>${MASTER_GATE}<span class="b">${BOLT_SVG}</span> to unlock</b><small>${MASTER_GATE - st.gate} more from Spot it and Use it</small></span>`;
    const gm = meter(k, { label: 'Master gate', ticks: 8 });
    gm.classList.add('gate');
    setMeter(gm, st.gate, MASTER_GATE, MASTER_GATE);
    k.addEventListener('click', () => { sfx.blocked(); haptic(10); if (!reducedMotion()) k.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 200 }); });
  }
}

/* ---- step10: effects with a source and a purpose ------------------------------------ */
export const CFX = { pulse: 0, stagger: 0, pips: 0, bar: 0, master: 0, lastPips: [] };
/** The world key just played pulses once on arrival (purpose: you are here). */
function pulseLast() {
  const w = seenGet('pulse', null);
  if (w == null) return;
  seenSet('pulse', null);
  const s = sockets[w];
  if (!s || s.state === 'locked' || s.state === 'future') return;
  CFX.pulse++;
  const cap = s.key.querySelector(':scope > .cap'), sw = s.key.querySelector(':scope > .sw');
  const target = s.state === 'built' ? cap : sw;
  if (!target) return;
  setTimeout(() => {
    if (!s.key.isConnected) return;
    if (reducedMotion()) { target.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 360 }); return; }
    target.animate([{ transform: 'none' }, { transform: 'translate3d(0,-3px,0) scale(1.06)', offset: 0.4 }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.3,.5,1)' });
    const r = s.key.getBoundingClientRect();
    if (!reducedMotion()) SPARKS.crackle({ x: r.left + r.width / 2, y: r.top + 4 }, 4);
  }, 300);
}
/** The level list arrives: the tiles settle in a quick stagger (≤ 200 ms in all), then
    what changed since this world was last seen fills: pips, the world bar, the gate
    meter, and the Master lock pops off when the gate was crossed. */
function enterWorldFx(w) {
  const rm = reducedMotion();
  const keys = [...wBody.querySelectorAll('.key, .mlock')];
  if (!rm) {
    CFX.stagger++;
    const n = keys.length, step = n > 1 ? 80 / (n - 1) : 0;
    keys.forEach((k, j) => {
      const c = k.classList.contains('key') ? k.querySelector(':scope > .cap') : k;
      c.animate([{ transform: 'translate3d(0,6px,0)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 120, delay: Math.round(j * step), easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
    });
  }
  const st = worldStats(w);
  let t = 300;
  // pips: only the cells above what was last seen, tile by tile (one style change and one short
  // composited pop per tile: few layers, few main-thread frames)
  const groups = [];
  let nPips = 0;
  for (const lv of st.levels) {
    if (lv.k === 0) continue;
    const old = seenGet('lv.' + lv.id, -1), now = lv.best;
    if (now > Math.max(0, old)) {
      const tile = wBody.querySelector(`[data-level="${w}.${lv.k}"]`);
      const cc = tile ? [...tile.querySelectorAll('.pips3 .cc')] : [];
      const g = [];
      for (let k = Math.max(0, old); k < now; k++) if (cc[k]) g.push(cc[k]);
      if (g.length) { groups.push({ pips: g, box: tile.querySelector('.pips3') }); nPips += g.length; }
    }
    if (lv.best >= 0) seenSet('lv.' + lv.id, lv.best);
  }
  CFX.lastPips = nPips;
  if (groups.length) CFX.pips++;
  const gstep = groups.length ? Math.min(120, 600 / groups.length) : 0;   // ≤ 600 ms in all
  groups.forEach((g, j) => {
    g.pips.forEach(c => c.classList.add('fx-wait'));
    setTimeout(() => {
      g.pips.forEach(c => { c.classList.add('fx-snap'); c.classList.remove('fx-wait'); });
      if (!g.box.isConnected) return;
      if (!rm) g.box.animate([{ transform: 'scale(.82)' }, { transform: 'scale(1.16)', offset: 0.45 }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.3,1.3,.5,1)' });
      else g.box.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 160 });
      sfx.noteTick(0, j);
    }, t + j * gstep);
  });
  if (groups.length) t += groups.length * gstep + 60;
  // the world bar and the gate meter: the delta only
  const w0 = seenGet('w.' + w, st.earned);
  if (w0 < st.earned && !rm) { setMeter(wMeter, st.earned, WORLD_CHARGES, WORLD_CHARGES, { animate: true, from: w0, delay: t }); CFX.bar++; t += 520; }
  seenSet('w.' + w, st.earned);
  const g0 = seenGet('gate.' + w, st.gate), gm = wBody.querySelector('.mlock .cm');
  if (gm && g0 < st.gate && !rm) setMeter(gm, st.gate, MASTER_GATE, MASTER_GATE, { animate: true, from: g0, delay: t - 520 > 300 ? t - 520 : t });
  seenSet('gate.' + w, st.gate);
  // the Master gate crossed since last seen: the lock pops off the tile
  const mo = seenGet('mo.' + w, st.masterOpen);
  if (st.masterOpen && !mo && !st.mastered) popMasterLock(w, t + 80);
  seenSet('mo.' + w, st.masterOpen);
}
function popMasterLock(w, at) {
  const tile = wBody.querySelector(`[data-level="${w}.13"]`);
  if (!tile) return;
  CFX.master++;
  const cap = tile.querySelector(':scope > .cap');
  tile.classList.add('fx-unlit');
  const lock = document.createElement('span');
  lock.className = 'm-pop'; lock.innerHTML = ICON.lock; lock.setAttribute('aria-hidden', 'true');
  cap.appendChild(lock);
  setTimeout(() => {
    if (!tile.isConnected) return;
    sfx.latch(0, 1); haptic(10);
    tile.classList.remove('fx-unlit');
    if (reducedMotion()) {
      lock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).onfinish = () => lock.remove();
      cap.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 200 });
      return;
    }
    // pops up off the tile, tumbles, falls with gravity (a parabola), fades out low
    const frames = [], vx = 0.05 + Math.random() * 0.03, vy = -0.32, g = 0.0016, D = 560;
    for (let i = 0; i <= 10; i++) {
      const tt = (i / 10) * D, x = vx * tt, y = vy * tt + 0.5 * g * tt * tt;
      frames.push({ transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(i * 7).toFixed(0)}deg)`, opacity: i < 7 ? 1 : 1 - (i - 6) / 4 });
    }
    lock.animate(frames, { duration: D, easing: 'linear', fill: 'forwards' }).onfinish = () => lock.remove();
    cap.animate([{ transform: 'translate3d(0,2px,0)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    const r = cap.getBoundingClientRect();
    SPARKS.crackle({ x: r.left + 26, y: r.top + r.height / 2 }, 6);
  }, at);
}

/* ---- public ------------------------------------------------------------------- */
export function openMap(dir = 1) {
  showScreen('campaign', null, dir);
  playBuilds();
}
export function openWorld(w, dir = 1, opts = {}) {
  showScreen('world', w, dir);
  if (opts.blocked) {
    const k = wEl.querySelector('.mlock');
    if (k && !reducedMotion()) k.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320, delay: 300 });
  }
}
export const mapWorld = () => curWorld;
export function initCampMap(callbacks) {
  cb = callbacks;
  buildMap(); buildWorld();
}
