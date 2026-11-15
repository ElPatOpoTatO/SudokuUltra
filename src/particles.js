// particles.js — the canvas particle engine and every emitter.
// Moved verbatim from the feel prototype (section 7b). One canvas, one rAF
// loop that sleeps when idle, a fixed pool of 256, no per-frame allocation.
// Shell addition: undoLift() takes an optional target keycap (Rewind).
import { $, rowOf, colOf, reducedMotion, dist } from './util.js';
import { S } from './state.js';
import { cells, mistEl, ERASE_MS, ERASE_STROKES, animPing } from './board.js';
import { digitKeys, keys } from './pad.js';

/* =========================================================================
   7b. PARTICLES — every particle has a SOURCE (born where the action
   happened) and a PURPOSE (its motion explains the action). One canvas,
   one rAF loop that sleeps when nothing is alive, a fixed pool, no
   allocations per frame, theme colors read from CSS variables.
   ========================================================================= */
export const FX = (() => {
  const cv = $('fxc'), g = cv.getContext('2d');
  const STREAK = 1, MOTE = 2, CHIP = 3, DOT = 4, CRUMB = 5, RING = 6, GLYPH = 7, TAU = Math.PI * 2;
  const MAX = 256, pool = [];
  for (let k = 0; k < MAX; k++) pool.push({
    on: false, kind: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    sx: 0, sy: 0, tx: 0, ty: 0, nx: 0, ny: 0, curve: 0,
    age: 0, life: 1, delay: 0, size: 1, len: 0, col: '', a: 1,
    grav: 0, drag: 1, rot: 0, vr: 0, txt: '', font: ''
  });
  let alive = 0, raf = 0, last = 0, dpr = 1, cursor = 0;
  let dirty = false, dx0 = 0, dy0 = 0, dx1 = 0, dy1 = 0;   // last frame's drawn area
  const C = { accent: '#3767e8', err: '#d2413a', note: '#5d6168', muted: '#8f939a', ink: '#2552cc' };
  let family = 'system-ui, sans-serif';

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    C.accent = cs.getPropertyValue('--accent').trim() || C.accent;
    C.err = cs.getPropertyValue('--err').trim() || C.err;
    C.note = cs.getPropertyValue('--ink-2').trim() || C.note;
    C.muted = cs.getPropertyValue('--ink-3').trim() || C.muted;
    C.ink = cs.getPropertyValue('--accent-ink').trim() || C.ink;
    family = getComputedStyle(document.body).fontFamily || family;
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round'; g.textAlign = 'center'; g.textBaseline = 'middle';
    dirty = false;
  }
  readColors(); resize();
  window.addEventListener('resize', resize);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors); } catch (e) {}

  /* take a particle from the pool (oldest slot is recycled if full) */
  function get(kind, x, y, life, delay, col, size) {
    let p = null;
    for (let n = 0; n < MAX; n++) { const q = pool[(cursor + n) % MAX]; if (!q.on) { p = q; cursor = (cursor + n + 1) % MAX; break; } }
    if (!p) { p = pool[cursor]; cursor = (cursor + 1) % MAX; alive--; }
    p.on = true; p.kind = kind; p.x = p.px = p.sx = x; p.y = p.py = p.sy = y;
    p.vx = p.vy = 0; p.tx = x; p.ty = y; p.nx = p.ny = p.curve = 0;
    p.age = 0; p.life = life; p.delay = delay; p.col = col; p.size = size; p.len = 0;
    p.a = 1; p.grav = 0; p.drag = 1; p.rot = 0; p.vr = 0;
    alive++;
    return p;
  }
  function wake() { if (!raf && alive > 0) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function frame(now) {
    let dt = now - last; last = now;
    if (dt > 34) dt = 34; else if (dt < 0) dt = 0;
    if (dirty) g.clearRect(dx0, dy0, dx1 - dx0, dy1 - dy0);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < MAX; k++) {
      const p = pool[k];
      if (!p.on) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.age += dt;
      if (p.age >= p.life) { p.on = false; alive--; continue; }
      const t = p.age / p.life;
      p.px = p.x; p.py = p.y;
      let a = p.a, r = p.size, ex = p.x, ey = p.y;
      if (p.kind === CRUMB) {
        // eraser crumb: falls, bounces once or twice off the cell's bottom edge, settles, fades
        const d = Math.pow(p.drag, dt);
        p.vx *= d; p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > p.ty) { p.y = p.ty; if (p.vy > 0.03) { p.vy = -p.vy * 0.35; p.vx *= 0.6; } else { p.vy = 0; p.vx *= 0.8; } }
        g.globalAlpha = a * (t < 0.65 ? 1 : (1 - t) / 0.35); g.fillStyle = p.col;
        g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      } else if (p.kind === RING) {
        // select ring: expands once from the tapped point, clipped to the cell
        const e = 1 - (1 - t) * (1 - t) * (1 - t);
        g.save(); g.beginPath(); g.rect(p.sx, p.sy, p.tx - p.sx, p.ty - p.sy); g.clip();
        g.globalAlpha = a * (1 - t); g.strokeStyle = p.col; g.lineWidth = 1.6 - t;
        g.beginPath(); g.arc(p.x, p.y, 1 + e * p.size, 0, TAU); g.stroke();
        g.restore();
        if (p.sx - 2 < x0) x0 = p.sx - 2; if (p.tx + 2 > x1) x1 = p.tx + 2;
        if (p.sy - 2 < y0) y0 = p.sy - 2; if (p.ty + 2 > y1) y1 = p.ty + 2;
      } else if (p.kind === GLYPH) {
        // undone digit/note lifting back to the Undo key
        const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t), bow = p.curve * Math.sin(Math.PI * t);
        p.x = p.sx + (p.tx - p.sx) * e + p.nx * bow;
        p.y = p.sy + (p.ty - p.sy) * e + p.ny * bow;
        const sc = 1 - 0.6 * e;
        g.globalAlpha = a * (t < 0.7 ? 1 : (1 - t) / 0.3); g.fillStyle = p.col; g.font = p.font;
        g.setTransform(sc * dpr, 0, 0, sc * dpr, p.x * dpr, p.y * dpr);
        g.fillText(p.txt, 0, 0);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        r = p.size * sc;
      } else if (p.kind === MOTE) {
        // pulled toward its target: accelerates in, then is absorbed
        const e = t * t, bow = p.curve * Math.sin(Math.PI * t);
        p.x = p.sx + (p.tx - p.sx) * e + p.nx * bow;
        p.y = p.sy + (p.ty - p.sy) * e + p.ny * bow;
        a *= t < 0.12 ? t / 0.12 : 1;
        if (t > 0.78) r *= (1 - t) / 0.22;
        if (p.age <= dt) { p.px = p.x; p.py = p.y; }
        g.globalAlpha = a; g.strokeStyle = p.col; g.lineWidth = r * 2;
        g.beginPath(); g.moveTo(p.px, p.py); g.lineTo(p.x + 0.01, p.y); g.stroke();
        ex = p.px; ey = p.py;
      } else if (p.kind === STREAK || p.kind === CHIP) {
        const d = p.drag === 1 ? 1 : Math.pow(p.drag, dt);
        p.vx *= d; p.vy = p.vy * d + p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === STREAK) {
          const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1, L = p.len * (1 - t * 0.6);
          ex = p.x - p.vx / sp * L; ey = p.y - p.vy / sp * L;
          g.globalAlpha = a * (1 - t); g.strokeStyle = p.col; g.lineWidth = r;
          g.beginPath(); g.moveTo(ex, ey); g.lineTo(p.x + 0.01, p.y); g.stroke();
        } else {
          p.rot += p.vr * dt;
          const c = Math.cos(p.rot) * dpr, s = Math.sin(p.rot) * dpr;
          g.globalAlpha = a * (t < 0.6 ? 1 : (1 - t) / 0.4); g.fillStyle = p.col;
          g.setTransform(c, s, -s, c, p.x * dpr, p.y * dpr);
          g.fillRect(-r / 2, -r / 2, r, r);
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      } else { // DOT: static flash
        g.globalAlpha = a * (1 - t); g.fillStyle = p.col;
        g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      }
      const lo = r + 3;
      if (p.x - lo < x0) x0 = p.x - lo; if (p.x + lo > x1) x1 = p.x + lo;
      if (p.y - lo < y0) y0 = p.y - lo; if (p.y + lo > y1) y1 = p.y + lo;
      if (ex - lo < x0) x0 = ex - lo; if (ex + lo > x1) x1 = ex + lo;
      if (ey - lo < y0) y0 = ey - lo; if (ey + lo > y1) y1 = ey + lo;
    }
    g.globalAlpha = 1;
    dirty = x1 > x0;
    if (dirty) { dx0 = Math.floor(x0); dy0 = Math.floor(y0); dx1 = Math.ceil(x1); dy1 = Math.ceil(y1); }
    if (alive > 0) raf = requestAnimationFrame(frame);
    else { raf = 0; if (dirty) g.clearRect(dx0, dy0, dx1 - dx0, dy1 - dy0); dirty = false; }
  }

  /* ---- geometry helpers (emit time only) ------------------------------ */
  const centerOf = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.width / 2 }; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rm = reducedMotion;
  // point on the square cell outline in direction (c, s)
  const edgeK = (c, s, h) => h / Math.max(Math.abs(c), Math.abs(s));

  return {
    /* step10 (tests): particles alive right now */
    get alive() { return alive; },
    clear() {
      for (const p of pool) p.on = false;
      alive = 0; g.clearRect(0, 0, innerWidth, innerHeight); dirty = false;
    },

    /* ERASE: crumbs rubbed off at the end of each wipe stroke; they drop,
       bounce off the cell's bottom edge, settle and fade */
    crumbs(i, dir, fine) {
      const r = cells[i].el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, w = r.width;
      if (rm()) { const p = get(DOT, cx, r.bottom - 4, 220, 120, C.muted, fine ? 1 : 1.5); p.a = 0.7; wake(); return; }
      ERASE_STROKES.forEach((off, k) => {
        const sd = k % 2 === 0 ? dir : -dir, n = fine ? 1 : 2;
        for (let m = 0; m < n; m++) {
          const size = fine ? rnd(0.8, 1.2) : rnd(1.3, 2.1);
          const p = get(CRUMB, cx + sd * w * rnd(0.12, 0.28), cy + rnd(-0.18, 0.2) * w, rnd(560, 720), off * ERASE_MS + rnd(-10, 10), C.muted, size);
          p.vx = sd * rnd(0.02, 0.06); p.vy = rnd(-0.07, -0.01); p.grav = 0.0011; p.drag = 0.997;
          p.ty = r.bottom - size - 1.5; p.a = 0.75;
        }
      });
      wake();
    },

    /* NOTE WRITTEN: 2–3 graphite flecks spark off the pencil tip */
    flecks(i, d) {
      if (rm()) return;
      const r = cells[i].n[d - 1].getBoundingClientRect(), tx = r.left + r.width * 0.72, ty = r.top + r.height * 0.78;
      const n = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const p = get(CHIP, tx + rnd(-1.5, 1.5), ty, rnd(240, 340), 40 + k * 25, C.note, rnd(0.9, 1.4));
        p.vx = rnd(-0.04, 0.06); p.vy = rnd(-0.08, -0.03); p.grav = 0.0007; p.drag = 0.99; p.vr = rnd(-0.05, 0.05); p.a = 0.8;
      }
      wake();
    },
    /* NOTE REMOVED: a single fleck flicks away */
    flickOff(i, d, dir) {
      if (rm()) return;
      const o = centerOf(cells[i].n[d - 1]);
      const p = get(CHIP, o.x, o.y, 300, 20, C.note, 1.2);
      p.vx = dir * rnd(0.09, 0.13); p.vy = -rnd(0.08, 0.12); p.grav = 0.0008; p.drag = 0.99; p.vr = dir * 0.04; p.a = 0.8;
      wake();
    },

    /* SELECT: a thin ring expands once from the tapped point inside the cell */
    ring(i, x, y) {
      if (rm()) return;
      const r = cells[i].el.getBoundingClientRect();
      if (x == null) { x = r.left + r.width / 2; y = r.top + r.height / 2; }
      const p = get(RING, x, y, 260, 0, C.accent, r.width * 0.8);
      p.sx = r.left; p.sy = r.top; p.tx = r.right; p.ty = r.bottom; p.a = 0.85;
      wake();
    },

    /* NUMBER-FIRST LOAD: a pulse leaves the latched keycap and reaches every
       same digit on the board, nearest first, pinging each on arrival */
    loadPulse(d) {
      const cap = digitKeys[d].el.querySelector('.cap').getBoundingClientRect(), sx = cap.left + cap.width / 2, sy = cap.top + 2;
      const list = [];
      for (let i = 0; i < 81; i++) if (S.values[i] === d) { const o = centerOf(cells[i].el); list.push({ i, x: o.x, y: o.y, L: Math.hypot(o.x - sx, o.y - sy) }); }
      list.sort((a, b) => a.L - b.L);
      list.forEach((it, k) => {
        if (rm()) { animPing(it.i, 0, .55); return; }
        const delay = k * 22, life = Math.min(220 + it.L * 0.5, 520), dx = it.x - sx, dy = it.y - sy, L = it.L || 1;
        const p = get(MOTE, sx, sy, life, delay, C.accent, 1.5);
        p.tx = it.x; p.ty = it.y; p.nx = -dy / L; p.ny = dx / L; p.curve = rnd(-0.06, 0.06) * L; p.a = 0.9;
        animPing(it.i, delay + life - 40);
      });
      wake();
    },

    /* UNDO: what the undo removes lifts back up into the Undo key.
       items = [{i, txt, small, color}]. `target` (shell addition): another
       keycap to fly into, e.g. Rewind. */
    undoLift(items, target = keys.undo) {
      if (rm() || !items.length) return;
      const cap = target.querySelector('.cap').getBoundingClientRect(), tx = cap.left + cap.width / 2, ty = cap.top + cap.height / 2;
      items.forEach((it, k) => {
        const el = it.small ? cells[it.i].n[+it.txt - 1] : cells[it.i].v, o = centerOf(el);
        const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
        const dx = tx - o.x, dy = ty - o.y, L = Math.hypot(dx, dy) || 1;
        const p = get(GLYPH, o.x, o.y, Math.min(300 + L * 0.35, 520), k * 30, it.color, fs * 0.6);
        p.txt = it.txt; p.font = `${it.small ? 520 : 450} ${fs}px ${family}`;
        p.tx = tx; p.ty = ty; p.nx = -dy / L; p.ny = dx / L; p.curve = -0.12 * L * Math.sign(dx || 1); p.a = 0.95;
      });
      wake();
    },

    /* MISTAKE: one chip from the offending cell flies into the Mistakes
       counter; returns flight time (ms) so the counter can tick on arrival */
    toCounter(i) {
      if (rm()) return 0;
      const o = centerOf(cells[i].el), r = mistEl.getBoundingClientRect(), tx = r.left + 8, ty = r.top + r.height / 2;
      const dx = tx - o.x, dy = ty - o.y, L = Math.hypot(dx, dy) || 1, delay = 140, life = Math.min(260 + L * 0.5, 520);
      const p = get(MOTE, o.x, o.y, life, delay, C.err, 1.9);
      p.tx = tx; p.ty = ty; p.nx = -dy / L; p.ny = dx / L; p.curve = 0.18 * L; p.a = 0.85;
      wake();
      return delay + life;
    },

    /* 1. Pen digit lands cleanly: the click made visible — 5 short streaks
          snap off the cell outline */
    spark(i) {
      if (rm()) return;                       // the cell flash already marks it
      const o = centerOf(cells[i].el), n = 5, base = Math.random() * TAU;
      for (let k = 0; k < n; k++) {
        const ang = base + k * TAU / n + rnd(-0.25, 0.25), c = Math.cos(ang), s = Math.sin(ang), m = edgeK(c, s, o.h) * 0.92;
        const p = get(STREAK, o.x + c * m, o.y + s * m, rnd(170, 230), 0, C.accent, 1.4);
        const sp = rnd(0.13, 0.19); p.vx = c * sp; p.vy = s * sp; p.drag = 0.988; p.len = rnd(4, 6.5); p.a = 0.95;
      }
      wake();
    },

    /* 2. Auto-cleanup: each removed note becomes a mote pulled into the
          digit that made it impossible. items = [{j, d, delay}] */
    absorb(i, items) {
      const t = centerOf(cells[i].el);
      for (const it of items) {
        const s = centerOf(cells[it.j].n[it.d - 1]);
        if (rm()) { const p = get(DOT, s.x, s.y, 170, it.delay, C.note, 1.6); p.a = 0.7; continue; }
        const dx = t.x - s.x, dy = t.y - s.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
        const p = get(MOTE, s.x, s.y, Math.min(230 + L * 0.9, 560), it.delay, C.note, 1.5);
        p.tx = t.x; p.ty = t.y; p.nx = -dy / L; p.ny = dx / L; p.curve = rnd(-0.12, 0.12) * L; p.a = 0.9;
      }
      wake();
    },

    /* 3. Unit closed: as the sweep light passes each cell of the unit, that
          cell releases a mote that travels back along the unit and gathers
          in the cell that completed it */
    gather(unit, origin, startDelay, step) {
      if (rm()) return;                       // the opacity sweep carries it
      const order = unit.slice().sort((a, b) => dist(a, origin) - dist(b, origin) || a - b);
      const t = centerOf(cells[origin].el);
      const line = unit.every(j => rowOf(j) === rowOf(origin)) || unit.every(j => colOf(j) === colOf(origin));
      order.forEach((j, k) => {
        if (j === origin) return;
        const s = centerOf(cells[j].el), dx = t.x - s.x, dy = t.y - s.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
        const p = get(MOTE, s.x, s.y, Math.min(240 + L * 0.75, 560), startDelay + k * step + 90, C.accent, 1.6);
        p.tx = t.x; p.ty = t.y; p.nx = -dy / L; p.ny = dx / L; p.curve = line ? 0 : rnd(-0.15, 0.15) * L;
      });
      wake();
    },

    /* 4. Conflict: dull chips knocked off the offending cell toward what it
          clashes with; heavy, falling, short */
    chips(i, clashes) {
      if (rm() || !clashes.length) return;   // shake + blink carry it
      const o = centerOf(cells[i].el);
      for (let k = 0; k < 3; k++) {
        const tgt = centerOf(cells[clashes[k % clashes.length]].el);
        const ang = Math.atan2(tgt.y - o.y, tgt.x - o.x) + rnd(-0.3, 0.3), c = Math.cos(ang), s = Math.sin(ang), m = edgeK(c, s, o.h) * 0.85;
        const p = get(CHIP, o.x + c * m, o.y + s * m, rnd(420, 540), 10 + k * 14, C.err, rnd(2.2, 3.2));
        const sp = rnd(0.24, 0.32); p.vx = c * sp; p.vy = s * sp - 0.05;
        p.grav = 0.00035; p.drag = 0.994; p.rot = Math.random() * TAU; p.vr = rnd(-0.03, 0.03); p.a = 0.72;
      }
      wake();
    },

    /* 5. Digit fully used: its keycap lets go of a few particles upward as it
          locks */
    release(d) {
      const cap = digitKeys[d].el.querySelector('.cap').getBoundingClientRect();
      if (rm()) { const p = get(DOT, cap.left + cap.width / 2, cap.top + 4, 220, 0, C.accent, 1.8); p.a = 0.8; wake(); return; }
      for (let k = 0; k < 5; k++) {
        const x = cap.left + cap.width * (0.22 + 0.56 * k / 4) + rnd(-2, 2);
        const p = get(STREAK, x, cap.top + 3, rnd(420, 620), Math.abs(k - 2) * 22, C.accent, 1.6);
        p.vx = rnd(-0.012, 0.012); p.vy = -rnd(0.11, 0.16); p.drag = 0.993; p.len = rnd(4, 6); p.a = 0.9;
      }
      wake();
    },

    /* --- hints: CAUSE -> EFFECT. Thin motes leave the pattern cells and travel
          to what the pattern decides: each eliminated candidate (a note
          position) or the target cell. links = [{from, to, d}] where d is the
          note digit at `to` (0 = the cell centre). Returns the longest flight
          (ms) so the caller can land an effect on arrival. --- */
    hintTrace(links, startDelay = 0) {
      if (rm() || !links.length) return 0;
      let far = 0;
      links.forEach((ln, k) => {
        const s = centerOf(cells[ln.from].el), t = centerOf(ln.d ? cells[ln.to].n[ln.d - 1] : cells[ln.to].el);
        const dx = t.x - s.x, dy = t.y - s.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
        const delay = startDelay + k * 26, life = Math.min(260 + L * 0.8, 600);
        const p = get(MOTE, s.x, s.y, life, delay, ln.err ? C.err : C.accent, 1.0);
        p.tx = t.x; p.ty = t.y; p.nx = -dy / L; p.ny = dx / L; p.curve = rnd(-0.08, 0.08) * L; p.a = 0.8;
        if (delay + life > far) far = delay + life;
      });
      wake();
      return far;
    },
    /* --- end hints --- */

    /* --- step10: BACKUP COPY — three accent motes carry the code from the Copy key into
          the code box (what was copied). Returns the flight time (ms); 0 with reduced motion. --- */
    carry(from, to) {
      if (rm()) return 0;
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      const sx = a.left + a.width / 2, sy = a.top + a.height * 0.4, tx = b.left + b.width / 2, ty = b.top + b.height / 2;
      const dx = tx - sx, dy = ty - sy, L = Math.hypot(dx, dy) || 1, life = Math.min(240 + L * 0.8, 420);
      for (let k = 0; k < 3; k++) {
        const p = get(MOTE, sx + (k - 1) * 12, sy, life, k * 45, C.accent, 1.5);
        p.tx = tx + (k - 1) * b.width * 0.22; p.ty = ty; p.nx = -dy / L; p.ny = dx / L; p.curve = (k - 1) * 0.12 * L; p.a = 0.9;
      }
      wake();
      return life + 90;
    },
    /* --- end step10 --- */

    /* 6. Solved: one wave born at the winning cell, riding the cascade
          outward — a single short streak per cell, pointing away from it */
    wave(origin, step) {
      if (rm()) return;                       // the cascade flash carries it
      const o = centerOf(cells[origin].el);
      for (let i = 0; i < 81; i++) {
        if (i === origin) continue;
        const s = centerOf(cells[i].el), dx = s.x - o.x, dy = s.y - o.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
        const p = get(STREAK, s.x, s.y, 360, dist(i, origin) * step + 60, C.accent, 1.4);
        p.vx = dx / L * 0.075; p.vy = dy / L * 0.075; p.drag = 0.992; p.len = 4; p.a = 0.75;
      }
      wake();
    }
  };
})();
