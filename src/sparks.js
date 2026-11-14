// sparks.js — the ENERGY effects of power charges (step 7): its own pooled
// canvas (like particles.js: one canvas, one rAF loop that sleeps when idle,
// a fixed pool, no allocation per frame). Every effect has a SOURCE and a PURPOSE:
//   bolt(a, b)   an energy bolt born where a charge was EARNED (board, Hint key,
//                Mistakes counter) that crackles along a curve INTO its charge cell
//   crackle(p)   a few short sparks thrown off where a cell fills (the charge "lands")
//   pulse(a, b)  a small glowing mote carrying a filled cell's energy to a charge bar
// Colours come from --charge / --charge-hot (progress.css).
import { reducedMotion } from './util.js';

const BOLT = 1, SPARK = 2, MOTE = 3, MAX = 160, TAU = Math.PI * 2;
let cv = null, g = null, dpr = 1, raf = 0, last = 0, alive = 0, cursor = 0;
const pool = [];
for (let k = 0; k < MAX; k++) pool.push({ on: false, kind: 0, x: 0, y: 0, sx: 0, sy: 0, tx: 0, ty: 0, cx: 0, cy: 0, vx: 0, vy: 0, age: 0, life: 1, delay: 0, size: 1, seed: 0, done: null });
const C = { charge: '#f0a800', hot: '#fff3c4' };

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  C.charge = cs.getPropertyValue('--charge').trim() || C.charge;
  C.hot = cs.getPropertyValue('--charge-hot').trim() || C.hot;
}
function ensure() {
  if (cv) return;
  cv = document.createElement('canvas');
  cv.className = 'sparkc'; cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  g = cv.getContext('2d');
  resize(); readColors();
  window.addEventListener('resize', resize);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors); } catch (e) {}
}
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineCap = 'round'; g.lineJoin = 'round';
}
function get(kind, x, y, life, delay, size) {
  let p = null;
  for (let n = 0; n < MAX; n++) { const q = pool[(cursor + n) % MAX]; if (!q.on) { p = q; cursor = (cursor + n + 1) % MAX; break; } }
  if (!p) { p = pool[cursor]; cursor = (cursor + 1) % MAX; alive--; }
  Object.assign(p, { on: true, kind, x, y, sx: x, sy: y, tx: x, ty: y, cx: x, cy: y, vx: 0, vy: 0, age: 0, life, delay, size, seed: Math.random() * 1000, done: null });
  alive++;
  return p;
}
function wake() { if (!raf && alive > 0) { last = performance.now(); raf = requestAnimationFrame(frame); } }
const bez = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;

function frame(now) {
  let dt = now - last; last = now;
  if (dt > 34) dt = 34; else if (dt < 0) dt = 0;
  g.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
  for (let k = 0; k < MAX; k++) {
    const p = pool[k];
    if (!p.on) continue;
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.age += dt;
    if (p.age >= p.life) { p.on = false; alive--; if (p.done) { const f = p.done; p.done = null; f(); } continue; }
    const t = p.age / p.life;
    if (p.kind === BOLT) {
      // ease-in-out travel along a bowed curve; a jagged trail re-rolled every frame = crackle
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const t0 = Math.max(0, e - 0.32), N = 9;
      g.globalAlpha = 1;
      g.shadowColor = C.charge; g.shadowBlur = 10;
      for (let pass = 0; pass < 2; pass++) {
        g.beginPath();
        for (let n = 0; n <= N; n++) {
          const u = t0 + (e - t0) * (n / N);
          let x = bez(p.sx, p.cx, p.tx, u), y = bez(p.sy, p.cy, p.ty, u);
          if (n > 0 && n < N) { const j = (1 - n / N) * 5 + 1; x += (Math.random() * 2 - 1) * j; y += (Math.random() * 2 - 1) * j; }
          if (n === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokeStyle = pass ? C.hot : C.charge;
        g.globalAlpha = pass ? 0.95 : 0.75;
        g.lineWidth = pass ? 1.1 : 3.2;
        g.stroke();
      }
      const hx = bez(p.sx, p.cx, p.tx, e), hy = bez(p.sy, p.cy, p.ty, e);
      g.fillStyle = C.hot; g.globalAlpha = 1;
      g.beginPath(); g.arc(hx, hy, p.size * (1 + 0.25 * Math.sin(p.age * 0.06)), 0, TAU); g.fill();
      g.shadowBlur = 0;
    } else if (p.kind === SPARK) {
      p.vx *= Math.pow(0.992, dt); p.vy = p.vy * Math.pow(0.992, dt) + 0.0009 * dt;
      const ox = p.x, oy = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      g.globalAlpha = 1 - t; g.strokeStyle = t < 0.4 ? C.hot : C.charge; g.lineWidth = p.size;
      g.beginPath(); g.moveTo(ox - p.vx * 18, oy - p.vy * 18); g.lineTo(p.x, p.y); g.stroke();
    } else if (p.kind === MOTE) {
      const e = t * t;
      const x = bez(p.sx, p.cx, p.tx, e), y = bez(p.sy, p.cy, p.ty, e);
      g.globalAlpha = t < 0.15 ? t / 0.15 : 1;
      g.shadowColor = C.charge; g.shadowBlur = 8;
      g.fillStyle = C.hot; g.beginPath(); g.arc(x, y, p.size * (t > 0.8 ? (1 - t) / 0.2 : 1), 0, TAU); g.fill();
      g.shadowBlur = 0;
    }
  }
  g.globalAlpha = 1;
  if (alive > 0) raf = requestAnimationFrame(frame);
  else { raf = 0; g.clearRect(0, 0, cv.width / dpr, cv.height / dpr); }
}

const center = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
export const pointOf = v => (v && v.getBoundingClientRect ? center(v) : v);

export const SPARKS = {
  /** Energy bolt from a → b (elements or points). Calls done() on arrival; returns its duration. */
  bolt(a, b, { delay = 0, dur = 0, bow = 0.22, done = null } = {}) {
    ensure(); readColors();
    const A = pointOf(a), B = pointOf(b);
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    const life = dur || Math.min(620, 300 + L * 0.9);
    const p = get(BOLT, A.x, A.y, life, delay, 3.2);
    const side = Math.random() < 0.5 ? -1 : 1;
    p.tx = B.x; p.ty = B.y;
    p.cx = (A.x + B.x) / 2 - dy / L * L * bow * side; p.cy = (A.y + B.y) / 2 + dx / L * L * bow * side;
    p.done = done;
    wake();
    return life;
  },
  /** A burst of short sparks thrown off a point (where a charge lands). */
  crackle(at, n = 9, { delay = 0 } = {}) {
    if (reducedMotion()) return;
    ensure(); readColors();
    const P = pointOf(at);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + Math.random() * 0.6, v = 0.09 + Math.random() * 0.12;
      const p = get(SPARK, P.x, P.y, 220 + Math.random() * 160, delay, 1.3);
      p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - 0.04;
    }
    wake();
  },
  /** A glowing mote carrying energy a → b (a filled cell feeding a charge bar). */
  pulse(a, b, { delay = 0, done = null } = {}) {
    ensure(); readColors();
    const A = pointOf(a), B = pointOf(b);
    const p = get(MOTE, A.x, A.y, 420, delay, 3);
    p.tx = B.x; p.ty = B.y; p.cx = (A.x + B.x) / 2 + (B.y - A.y) * 0.18; p.cy = Math.min(A.y, B.y) - 24;
    p.done = done;
    wake();
    return 420;
  },
  clear() { for (const p of pool) { p.on = false; p.done = null; } alive = 0; },
  get alive() { return alive; }
};
