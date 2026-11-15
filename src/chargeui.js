// chargeui.js — the look and feel of POWER CHARGES (step 7): the charge cell
// (a small battery cell with a bolt; empty = outlined, filled = glowing), the
// charge meter (bars), the "charge up" sound, and the results card that fills
// the cells when a level is complete. See docs/progression.md.
import { $, div, reducedMotion, haptic } from './util.js';
import { sfx } from './audio.js';
import { cells, mistEl, toastEl } from './board.js';
import { SPARKS, pointOf } from './sparks.js';
import { MISTAKE_LIMIT, WORLD_CHARGES } from './progcfg.js';

/* ---- the charge cell ------------------------------------------------------- */
const CELL_SVG = '<svg viewBox="0 0 20 28" aria-hidden="true"><rect class="cc-nub" x="7" y="0.8" width="6" height="3.2" rx="1.2"/>' +
  '<rect class="cc-body" x="2" y="3.6" width="16" height="23.2" rx="4.2"/><rect class="cc-fill" x="4.1" y="5.7" width="11.8" height="19" rx="2.6"/>' +
  '<path class="cc-bolt" d="M11.6 7.6 6.4 15.6h3.7l-1.5 6.9 5.6-8.6H10.4z"/></svg>';
export const BOLT_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.4 1 3.2 9.2h4.2L6.4 15l6.4-8.6H8.6z"/></svg>';

/** A charge cell element (span.cc). on = filled. */
export function chargeCell(on = false, cls = '') {
  const s = document.createElement('span');
  s.className = 'cc' + (on ? ' on' : '') + (cls ? ' ' + cls : '');
  s.innerHTML = CELL_SVG;
  return s;
}
/** Three pips for a level tile: best = -1 (never done) … 3. */
export function pips(best, parent) {
  const p = div('pips3', parent);
  for (let k = 0; k < 3; k++) p.appendChild(chargeCell(k < best));
  p.setAttribute('aria-label', best < 0 ? 'not played' : `${best} of 3 charges`);
  return p;
}

/* ---- the charge meter ------------------------------------------------------ */
/** A charge meter: bright = earned, dim = available, track = all. ticks = segments. */
export function meter(parent, { label = '', ticks = 13, big = false } = {}) {
  const m = div('cm' + (big ? ' big' : ''), parent);
  m.setAttribute('role', 'meter'); m.setAttribute('aria-valuemin', '0');
  const ic = div('cm-ic', m); ic.innerHTML = BOLT_SVG;
  const tr = div('cm-track', m);
  div('cm-dim', tr); div('cm-fill', tr); div('cm-glint', tr);
  tr.style.setProperty('--ticks', ticks);
  div('cm-nub', m);
  const num = div('cm-num', m);
  if (label) { m.setAttribute('aria-label', label); m.dataset.label = label; }
  m._num = num;
  return m;
}
export function setMeter(m, earned, available, all = available, { animate = false, from = null, delay = 0, dur = 520 } = {}) {
  const pct = v => (all > 0 ? Math.max(0, Math.min(100, (v / all) * 100)) : 0);
  const fill = m.querySelector('.cm-fill'), dim = m.querySelector('.cm-dim');
  dim.style.width = pct(available) + '%';
  m.setAttribute('aria-valuenow', String(earned)); m.setAttribute('aria-valuemax', String(available));
  m.dataset.earned = earned; m.dataset.available = available; m.dataset.all = all;
  const show = v => { m._num.innerHTML = `<b>${v}</b><span>/${available}</span>`; m._shown = v; };
  const tickTo = v => { if (v === m._shown) return; m._shown = v; const b = m._num.firstChild; if (b) b.textContent = String(v); };
  if (m._anim) { try { m._anim.cancel(); } catch (e) {} m._anim = null; }
  if (m._tick) { clearTimeout(m._tick); m._tick = 0; }
  fill.style.transition = 'none'; fill.style.width = pct(earned) + '%';
  /* step10: the delta grows with transform only (scaleX from the old width), the layout width is final at once */
  if (animate && from != null && from < earned && !reducedMotion() && pct(earned) > 0) {
    const r = Math.max(0, pct(from) / pct(earned));
    m._anim = fill.animate([{ transform: `scaleX(${r.toFixed(4)})` }, { transform: 'none' }],
      { duration: dur, delay, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' });
    show(from);
    // the number counts up in a few steps (each text change costs a layout: ≤ 6 of them)
    const steps = Math.min(6, earned - from);
    for (let i = 1; i <= steps; i++) {
      const v = Math.round(from + (earned - from) * (i / steps)), at = delay + dur * (1 - Math.pow(1 - i / steps, 1 / 3));
      m._tick = setTimeout(() => tickTo(v), at);
    }
    try { fill.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 700, delay, easing: 'ease-out', pseudoElement: '::after' }); } catch (e) {}
  } else show(earned);
}

/* ---- the "charge up" sound: a rising buzz + a soft zap; step 0-2 rises in pitch ---- */
const P = sfx.prims;
sfx.charge = function (step = 0) {
  if (!P.ready()) return;
  const ctx = P.ctx, t = P.now() + 0.004, p = P.pj(), up = Math.pow(2, (step * 3) / 12);   // +3 semitones per charge
  const out = ctx.createGain(); out.gain.value = 1; out.connect(P.master);
  // rising buzz: a sawtooth through a sweeping bandpass, with a fast tremolo (the "electric" grain)
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(150 * p * up, t);
  o.frequency.exponentialRampToValueAtTime(430 * p * up, t + 0.15);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(700 * p * up, t); bp.frequency.exponentialRampToValueAtTime(2600 * p * up, t + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.085, t + 0.03);
  g.gain.setValueAtTime(0.085, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 46 * P.jit(0.1);
  const lg = ctx.createGain(); lg.gain.value = 0.035; lfo.connect(lg); lg.connect(g.gain);
  o.connect(bp); bp.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.24); lfo.start(t); lfo.stop(t + 0.24);
  // soft zap: a short bright noise crack + a falling sine blip as the cell takes the charge
  const tz = t + 0.15;
  const src = ctx.createBufferSource(); src.buffer = P.noise;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800 * p;
  const zg = ctx.createGain(); zg.gain.setValueAtTime(0.0001, tz); zg.gain.linearRampToValueAtTime(0.11, tz + 0.002); zg.gain.exponentialRampToValueAtTime(0.0001, tz + 0.05);
  src.connect(hp); hp.connect(zg); zg.connect(out); src.start(tz, Math.random() * 0.9); src.stop(tz + 0.08);
  const b = ctx.createOscillator(); b.type = 'sine';
  b.frequency.setValueAtTime(1900 * p * up, tz); b.frequency.exponentialRampToValueAtTime(880 * p * up, tz + 0.09);
  const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, tz); bg.gain.linearRampToValueAtTime(0.06, tz + 0.004); bg.gain.exponentialRampToValueAtTime(0.0001, tz + 0.14);
  b.connect(bg); bg.connect(out); b.start(tz); b.stop(tz + 0.18);
};
/** The bolt's travel: a faint crackle while it flies (very quiet). */
sfx.crackle = function () {
  if (!P.ready()) return;
  const ctx = P.ctx, t0 = P.now(), p = P.pj();
  for (let k = 0; k < 5; k++) {
    const t = t0 + k * 0.045 + Math.random() * 0.02;
    const src = ctx.createBufferSource(); src.buffer = P.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = (2600 + Math.random() * 2400) * p; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.025, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    src.connect(bp); bp.connect(g); g.connect(P.master); src.start(t, Math.random() * 0.9); src.stop(t + 0.03);
  }
};

/* ---- the results card ------------------------------------------------------ */
/* "Solved" is earned on the board: the winning cell, or (when the card covers it)
   the board's edge level with that cell, on the side nearest to it. */
function boardSource(cell) {
  const board = document.getElementById('board');
  if (!(cell >= 0 && cells[cell])) return board;
  const c = cells[cell].el.getBoundingClientRect(), t = toastEl.getBoundingClientRect(), b = board.getBoundingClientRect();
  const x = c.left + c.width / 2, y = c.top + c.height / 2;
  if (x < t.left || x > t.right || y < t.top || y > t.bottom) return { x, y };
  const left = x - b.left < b.right - x;
  return { x: left ? b.left + (t.left - b.left) / 2 : t.right + (b.right - t.right) / 2, y };
}
const visible = el => !!el && (!el.getBoundingClientRect ? true : el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');
function hintKeyEl() { return [...document.querySelectorAll('.hkeys .key.hk')].find(visible) || null; }
const CRIT = [
  { id: 'solved', yes: 'Solved', no: 'Not solved' },
  { id: 'hints', yes: 'No hints', no: 'Hint used' },
  { id: 'mistakes', yes: MISTAKE_LIMIT === 1 ? '≤ 1 mistake' : `≤ ${MISTAKE_LIMIT} mistakes`, no: '' }
];
export const RC = { phase: 'idle', filled: 0, timers: [] };
function later(fn, ms) { RC.timers.push(setTimeout(fn, ms)); }
export function clearResults() {
  for (const t of RC.timers) clearTimeout(t);
  RC.timers = []; RC.phase = 'idle'; RC.filled = 0;
  toastEl.querySelectorAll('.rc, .rw, .tk2').forEach(e => e.remove());
  toastEl.classList.remove('rcard', 'wtoast');
  const ak = $('againKey'); if (ak && ak.parentNode && ak.parentNode.classList.contains('tkeys')) { const row = ak.parentNode; row.parentNode.insertBefore(ak, row); row.remove(); }
}

/**
 * Show the charge cells on the toast and fill them. r = profile.js result,
 * d = the solved event detail.
 */
export function showResults(r, d, worldLabel) {
  clearResults();
  toastEl.classList.add('rcard');
  const box = document.createElement('div'); box.className = 'rc';
  toastEl.insertBefore(box, $('againKey'));
  const row = div('rc-cells', box);
  const earned = [true, d.paidHints === 0, d.mistakes <= MISTAKE_LIMIT];
  const els = CRIT.map((c, k) => {
    const col = div('rc-c', row); col.dataset.crit = c.id;
    const cc = chargeCell(false, 'big');
    col.appendChild(cc);
    const lab = div('rc-l', col);
    lab.textContent = earned[k] ? c.yes : (k === 1 ? (d.paidHints === 1 ? 'Hint used' : `${d.paidHints} hints`) : `${d.mistakes} mistakes`);
    if (!earned[k]) col.classList.add('miss');
    return cc;
  });
  const mrow = div('rc-m', box);
  const ml = div('rc-ml', mrow); ml.textContent = worldLabel;
  const m = meter(mrow, { label: worldLabel + ' charges', ticks: 13 });
  setMeter(m, r.worldBefore, WORLD_CHARGES);
  const note = div('rc-note', box);
  /* --- step10: the unlock beat gets its own line, reserved from the start (no layout shift) --- */
  const unlockText = r.masteredNow != null ? `World ${r.world} mastered` : r.masterOpenedNow ? 'Master unlocked' : '';
  const ul = unlockText ? div('rc-unlock', box) : null;
  if (ul) ul.innerHTML = `<span class="rc-lk">${LOCK_SVG}</span><span>${unlockText}</span>`;
  /* --- end step10 --- */
  const sources = [boardSource(d.cell), hintKeyEl(), mistEl];
  const order = [0, 1, 2].filter(k => earned[k]);
  RC.phase = 'charging'; RC.filled = 0;
  /* step10: one beat after another — charges, then the bar, then the unlock; never overlapping */
  const unlockBeat = () => {
    if (!ul) { RC.phase = 'done'; return; }
    RC.phase = 'unlock';
    ul.classList.add('on');
    sfx.latch(0, 2); haptic(10);
    const lk = ul.querySelector('.rc-lk');
    if (reducedMotion()) ul.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    else {
      ul.animate([{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.3,1)' });
      lk.animate([{ transform: 'none' }, { transform: 'translate3d(0,-3px,0) rotate(-14deg)', offset: 0.4 }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.3,1.3,.5,1)' });
      SPARKS.crackle(lk, 6);
    }
    later(() => { RC.phase = 'done'; }, 400);
  };
  const finish = () => {
    RC.phase = 'feeding';
    const fresh = [];
    for (let k = 0; k < 3; k++) if (earned[k] && k >= Math.max(0, r.prev)) fresh.push(k);   // cells above the old best feed the bar
    const n = r.delta;
    let barEnd = 0;
    if (n > 0 && !reducedMotion()) {
      fresh.slice(0, n).forEach((k, j) => SPARKS.pulse(els[k], m.querySelector('.cm-fill'), { delay: j * 90 }));
      const at = 360 + (Math.min(n, fresh.length) - 1) * 90;
      later(() => setMeter(m, r.worldAfter, WORLD_CHARGES, WORLD_CHARGES, { animate: true, from: r.worldBefore }), at);
      barEnd = at + 520;
    } else { setMeter(m, r.worldAfter, WORLD_CHARGES); barEnd = n > 0 ? 200 : 0; }
    note.textContent = n > 0 ? `+${n} ⚡ for ${worldLabel}` : (r.prev >= 0 ? `Best kept: ${r.best} ⚡` : '');
    note.classList.toggle('up', n > 0);
    RC.barEnd = barEnd;
    later(unlockBeat, barEnd + (ul ? 140 : 380));
  };
  const fillCell = (k, j) => {
    const cc = els[k];
    cc.classList.add('on');
    RC.filled++;
    RC.lands.push(Math.round(performance.now()));
    sfx.charge(j);
    haptic(8);
    if (reducedMotion()) cc.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    else {
      cc.animate([{ transform: 'scale(.82)' }, { transform: 'scale(1.18)', offset: 0.45 }, { transform: 'scale(1)' }], { duration: 340, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      SPARKS.crackle(cc, 10);
    }
  };
  RC.lands = [];
  if (!order.length) { finish(); return; }
  if (reducedMotion()) {
    order.forEach((k, j) => later(() => { fillCell(k, j); if (j === order.length - 1) later(finish, 240); }, 220 + j * 300));
    return;
  }
  /* step10: an even rhythm of landings (one every BEAT ms), each bolt launched so it lands on
     its beat: the three charges read one by one, the rising charge sound marks each */
  const START = 380, BEAT = 380;
  let land = 0;
  order.forEach((k, j) => {
    const src = sources[k], ok = src && visible(src);
    let life = 0;
    if (ok) { const A = pointOf(src), B = pointOf(els[k]); life = Math.min(620, 300 + Math.hypot(B.x - A.x, B.y - A.y) * 0.9); }
    land = j === 0 ? START + life : Math.max(land + BEAT, START + j * 160 + life);
    const launch = land - life, last = j === order.length - 1;
    later(() => {
      if (!ok || !visible(src)) { fillCell(k, j); if (last) later(finish, 280); return; }
      sfx.crackle();
      SPARKS.bolt(src, els[k], { dur: life, done: () => { fillCell(k, j); if (last) later(finish, 280); } });
    }, launch);
  });
}
const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0"/></svg>';
