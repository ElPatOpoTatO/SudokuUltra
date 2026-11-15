// audio.js — Web Audio sound engine, moved verbatim from the feel prototype
// (section 4). Every sound is synthesized; ±5% pitch jitter on every call.

/* =========================================================================
   4. AUDIO ENGINE (Web Audio, fully synthesized)
   ========================================================================= */
const engine = (() => {
  let ctx = null, master = null, noise = null, muted = false;

  // iOS 17+ audio session: 'ambient' = game sound effects that MIX with music or
  // podcasts already playing (they keep playing) and follow the ringer switch.
  // ('playback' would pause the user's music, which is wrong for a game.)
  // Set it at load, before any audio exists, so iOS never picks another type.
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) {}

  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (muted) return;   // sound off: never create or wake the audio context
    if (!ctx) {
      ctx = new AC({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 4;
      comp.attack.value = 0.001; comp.release.value = 0.1;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(comp); comp.connect(ctx.destination);
      // 1s of white noise, reused by every burst at a random offset
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const ch = noise.getChannelData(0);
      for (let k = 0; k < ch.length; k++) ch[k] = Math.random() * 2 - 1;
      // silent kick — completes the iOS unlock
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
    }
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
  }
  const ready = () => ctx && !muted;
  const now = () => ctx.currentTime + 0.002;
  const jit = a => 1 + (Math.random() * 2 - 1) * a;   // ±a variation
  const PITCH_JITTER = 0.05;                           // ±5% pitch on every sound
  const pj = () => jit(PITCH_JITTER);
  // Musical chains (cleanup ticks, unit chimes) share ONE offset per move so the melody stays in tune
  let tickP = 1, latchP = 1;
  // major pentatonic ladder (semitones): chains climb it, so they always sound consonant
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const pent = (base, k) => base * Math.pow(2, PENTA[Math.min(Math.max(k, 0), PENTA.length - 1)] / 12);

  function env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  }
  // filtered noise burst
  function burst(t, { type = 'bandpass', f = 2000, q = 1, gain = 0.3, dur = 0.02, attack = 0.0006 }) {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); env(g, t, gain, attack, dur);
    src.connect(fl); fl.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.9); src.stop(t + attack + dur + 0.03);
  }
  // pitched tone with optional glide
  function tone(t, { type = 'sine', f0 = 440, f1 = f0, dur = 0.05, gain = 0.2, attack = 0.001, glide = dur }) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    const g = ctx.createGain(); env(g, t, gain, attack, dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + attack + dur + 0.04);
  }

  return {
    unlock,
    get muted() { return muted; },
    /* --- keys: switch sounds (switches.js). keyStyle = active keycap style, or
       null for the original clicks; prims = engine internals for new voices
       (data properties, so the parity test's sfx wrapper leaves them alone) --- */
    keyStyle: null,
    prims: { get ctx() { return ctx; }, get master() { return master; }, get noise() { return noise; }, ready, now, jit, pj },
    /* --- end keys --- */
    setMuted(m) {
      muted = m;
      if (!ctx) return;   // created later, on the first tap with sound on
      master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.01);
      // sound off: put the audio context to sleep so the game holds no audio at all;
      // sound on: wake it (also happens on the next tap via unlock)
      try { if (m) setTimeout(() => { if (muted && ctx.state === 'running') ctx.suspend(); }, 60); else if (ctx.state !== 'running') ctx.resume(); } catch (e) {}
    },

    /* Clicky switch: sharp high transient + bandpassed leaf click + low thock,
       then a soft low "seat" ~15ms later (the cap bottoming out on the plate) */
    pen() {
      /* --- keys --- */ if (engine.keyStyle) return engine.sw('pen'); /* --- end keys --- */
      if (!ready()) return; const t = now(), p = pj(), v = jit(0.15);
      burst(t,          { type: 'highpass', f: 7800 * p, q: 0.7, gain: 0.27 * v, dur: 0.0035, attack: 0.0002 });
      burst(t,          { type: 'bandpass', f: 3700 * p, q: 3.4, gain: 0.55 * v, dur: 0.018, attack: 0.00025 });
      burst(t + 0.003,  { type: 'bandpass', f: 1600 * p, q: 1.1, gain: 0.15 * v, dur: 0.028 });
      tone(t + 0.002,   { f0: 240 * p, f1: 118 * p, dur: 0.048, gain: 0.29 * v, glide: 0.03 });
      tone(t + 0.001,   { type: 'triangle', f0: 600 * p, f1: 340 * p, dur: 0.016, gain: 0.05 * v });
      // seat thock
      const ts = t + 0.015 * jit(0.12);
      burst(ts,         { type: 'lowpass', f: 420 * p, q: 0.7, gain: 0.09 * v, dur: 0.03, attack: 0.0015 });
      tone(ts,          { f0: 96 * p, f1: 62 * p, dur: 0.055, gain: 0.15 * v, attack: 0.0015, glide: 0.04 });
    },
    /* Silent switch: muted, lowpassed thock */
    pencil() {
      /* --- keys --- */ if (engine.keyStyle) return engine.sw('pencil'); /* --- end keys --- */
      if (!ready()) return; const t = now(), p = pj(), v = jit(0.15);
      burst(t,         { type: 'lowpass', f: 1150 * p, q: 0.8, gain: 0.32 * v, dur: 0.034, attack: 0.002 });
      tone(t + 0.002,  { f0: 175 * p, f1: 96 * p, dur: 0.056, gain: 0.28 * v, attack: 0.002, glide: 0.035 });
    },
    /* Modifier key: a slightly deeper, broader clack */
    mod() {
      /* --- keys --- */ if (engine.keyStyle) return engine.sw('mod'); /* --- end keys --- */
      if (!ready()) return; const t = now(), p = pj(), v = jit(0.12);
      burst(t,         { type: 'highpass', f: 6000 * p, q: 0.7, gain: 0.12 * v, dur: 0.004 });
      burst(t,         { type: 'bandpass', f: 2500 * p, q: 2.2, gain: 0.40 * v, dur: 0.024 });
      tone(t + 0.002,  { f0: 200 * p, f1: 100 * p, dur: 0.06, gain: 0.32 * v, glide: 0.035 });
    },
    /* Upstroke: barely there */
    release() {
      /* --- keys --- */ if (engine.keyStyle) return engine.sw('up'); /* --- end keys --- */
      if (!ready()) return; const t = now(), p = pj(), v = jit(0.2);
      burst(t, { type: 'highpass', f: 4600 * p, q: 0.9, gain: 0.045 * v, dur: 0.007 });
      tone(t,  { f0: 950 * p, f1: 800 * p, dur: 0.010, gain: 0.014 * v });
    },
    /* Cell select: soft tick */
    select() {
      if (!ready()) return; const t = now(), p = pj(), v = jit(0.15);
      tone(t,  { f0: 1550 * p, f1: 1300 * p, dur: 0.016, gain: 0.05 * v });
      burst(t, { type: 'bandpass', f: 5200 * p, q: 4, gain: 0.03 * v, dur: 0.006 });
    },
    /* Auto-cleanup tick, scheduled `delay` seconds ahead; the k-th tick of a
       chain climbs the pentatonic ladder so long cleanups sound rewarding */
    noteTick(delay, k = 0) {
      if (!ready()) return; if (k === 0) tickP = pj();
      const t = now() + delay, f = pent(1568, k) * tickP;
      tone(t,  { f0: f, f1: f * 0.86, dur: 0.014, gain: 0.034 * (1 - Math.min(k, 10) * 0.035) });
      burst(t, { type: 'highpass', f: 6500 * tickP, q: 0.8, gain: 0.018, dur: 0.004 });
    },
    /* Pressing into something that won't take it (given cell, locked digit) */
    blocked() {
      if (!ready()) return; const t = now(), v = jit(0.1), p = pj();
      burst(t, { type: 'lowpass', f: 600 * p, q: 0.8, gain: 0.24 * v, dur: 0.04, attack: 0.002 });
      tone(t,  { f0: 115 * p, f1: 82 * p, dur: 0.06, gain: 0.18 * v });
    },
    /* Error: low, dull double clunk — not a buzzer */
    error() {
      if (!ready()) return; const t = now() + 0.01, p = pj();
      tone(t,         { type: 'triangle', f0: 125 * p, f1: 70 * p, dur: 0.14, gain: 0.32, glide: 0.09 });
      tone(t + 0.004, { f0: 64 * p, f1: 52 * p, dur: 0.18, gain: 0.30 });
      burst(t,        { type: 'lowpass', f: 520 * p, q: 0.9, gain: 0.38, dur: 0.07, attack: 0.002 });
      tone(t + 0.075, { type: 'triangle', f0: 96 * p, f1: 60 * p, dur: 0.11, gain: 0.18 });
      burst(t + 0.075,{ type: 'lowpass', f: 380 * p, q: 0.8, gain: 0.22, dur: 0.06, attack: 0.002 });
    },
    /* Unit complete: ratchet ticks → latch clack → soft chime.
       `step` = position in this move's chain (0,1,2): the chime climbs C → E → A */
    latch(delay = 0, step = 0) {
      if (!ready()) return; const t0 = now() + delay;
      if (step === 0) latchP = pj();
      const p = latchP;
      [0, 0.042, 0.084].forEach((dt, k) => {
        burst(t0 + dt, { type: 'bandpass', f: (2700 + k * 450) * p, q: 3, gain: 0.16, dur: 0.011 });
        tone(t0 + dt,  { f0: pent(1318.5, step + k) * p, dur: 0.01, gain: 0.03 });
      });
      const t = t0 + 0.15;
      burst(t, { type: 'highpass', f: 6500 * p, q: 0.7, gain: 0.14, dur: 0.005 });
      burst(t, { type: 'bandpass', f: 1450 * p, q: 1.5, gain: 0.42, dur: 0.05 });
      tone(t,  { f0: 165 * p, f1: 88 * p, dur: 0.085, gain: 0.32, glide: 0.05 });
      tone(t + 0.012, { f0: pent(1046.5, step * 2) * p, dur: 0.55, gain: 0.055, attack: 0.004 });
      tone(t + 0.012, { f0: pent(1046.5, step * 2 + 3) * p, dur: 0.42, gain: 0.03, attack: 0.004 });
    },
    /* ERASE — rubber scrubbing paper: band-passed noise, one soft swell per
       wipe stroke, filter sweeping with the stroke direction. No transient. */
    erase(dir = 1, soft = false) {
      if (!ready()) return;
      const t0 = now() + 0.012, base = soft ? 0.7 : 1, p = pj();
      [0, 0.072, 0.144].forEach((dt, k) => {
        const t = t0 + dt * jit(0.07), up = (k % 2 === 0) === (dir > 0);
        const lo = 1500 * p, hi = 2900 * p, d = 0.066 * jit(0.12);
        const src = ctx.createBufferSource(); src.buffer = noise;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.65 * jit(0.2);
        bp.frequency.setValueAtTime(up ? lo : hi, t);
        bp.frequency.exponentialRampToValueAtTime(up ? hi : lo, t + d);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4800; lp.Q.value = 0.5;
        const g = ctx.createGain(), pk = 0.30 * base * jit(0.15) * (1 - k * 0.14);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(pk, t + d * 0.35);
        g.gain.linearRampToValueAtTime(pk * 0.55, t + d * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(master);
        src.start(t, Math.random() * 0.9); src.stop(t + d + 0.03);
      });
    },
    /* NOTE WRITTEN — graphite on paper: tiny pitched tick, then a short dry
       high-passed scratch. Lighter and drier than any key. */
    scratch(delay = 0.01) {
      if (!ready()) return; const t = now() + delay, p = pj(), v = jit(0.18), d = 0.025 + Math.random() * 0.015;
      tone(t,          { f0: 3700 * p, f1: 3000 * p, dur: 0.006, gain: 0.02 * v, attack: 0.0008 });
      burst(t + 0.001, { type: 'highpass', f: 3900 * p, q: 0.7, gain: 0.075 * v, dur: d, attack: 0.004 });
      burst(t + 0.003, { type: 'bandpass', f: 5600 * p, q: 1.4, gain: 0.035 * v, dur: d * 0.8, attack: 0.003 });
    },
    /* NOTE REMOVED — a reversed-feeling flick: swells in, cuts off */
    flick(delay = 0.01) {
      if (!ready()) return; const t = now() + delay, v = jit(0.18), p = pj();
      const src = ctx.createBufferSource(); src.buffer = noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.7;
      hp.frequency.setValueAtTime(5200 * p, t); hp.frequency.exponentialRampToValueAtTime(3000 * p, t + 0.016);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * v, t + 0.013);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.017);
      src.connect(hp); hp.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.9); src.stop(t + 0.04);
    },
    /* UNDO — reverse whoosh: a rising band of air that swells and cuts */
    whoosh() {
      if (!ready()) return; const t = now() + 0.01, d = 0.13 * jit(0.1), p = pj();
      const src = ctx.createBufferSource(); src.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(800 * p, t); bp.frequency.exponentialRampToValueAtTime(2600 * p, t + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14 * jit(0.12), t + d);
      g.gain.linearRampToValueAtTime(0.0001, t + d + 0.02);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.8); src.stop(t + d + 0.05);
    },
    /* --- hints: sounds for the hint ladder and check my thinking --- */
    /* HINT — a soft glassy "ding", no click transient (so it never reads as a
       key). Each ladder level sits one step higher on the pentatonic ladder. */
    hint(level = 1) {
      if (!ready()) return; const t = now() + 0.008, p = pj(), v = jit(0.1);
      const f = pent(880, Math.max(0, level - 1)) * p;
      burst(t, { type: 'lowpass', f: 2400 * p, q: 0.6, gain: 0.018 * v, dur: 0.05, attack: 0.012 });
      tone(t, { f0: f, dur: 0.42, gain: 0.05 * v, attack: 0.008 });
      tone(t + 0.006, { f0: f * 2, dur: 0.22, gain: 0.014 * v, attack: 0.006 });
      tone(t + 0.07, { f0: f * 1.5, dur: 0.34, gain: 0.022 * v, attack: 0.01 });
    },
    /* CHECK, right — latch-ish: one soft ratchet tick, then a small rising chime */
    checkYes() {
      if (!ready()) return; const t = now() + 0.006, p = pj();
      burst(t, { type: 'bandpass', f: 2900 * p, q: 3, gain: 0.09, dur: 0.01 });
      tone(t + 0.04, { f0: pent(1046.5, 0) * p, dur: 0.3, gain: 0.04, attack: 0.004 });
      tone(t + 0.11, { f0: pent(1046.5, 2) * p, dur: 0.42, gain: 0.04, attack: 0.004 });
    },
    /* CHECK, not quite — gentle low two-note fall (not the error clunk: it's not a mistake) */
    checkNo() {
      if (!ready()) return; const t = now() + 0.006, p = pj();
      tone(t, { type: 'triangle', f0: 392 * p, dur: 0.16, gain: 0.04, attack: 0.006 });
      tone(t + 0.12, { type: 'triangle', f0: 330 * p, f1: 311 * p, dur: 0.26, gain: 0.035, attack: 0.006 });
    },
    /* --- end hints --- */
    /* Puzzle complete: rising mechanical cascade + chord */
    complete() {
      if (!ready()) return; const t0 = now() + 0.05, p = pj();
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
      notes.forEach((f, k) => {
        const t = t0 + k * 0.085;
        burst(t, { type: 'bandpass', f: (3000 + k * 180) * p, q: 2.8, gain: 0.18, dur: 0.014 });
        tone(t,  { f0: 210 * p, f1: 120 * p, dur: 0.04, gain: 0.14 });
        tone(t + 0.004, { type: 'triangle', f0: f * p, dur: 0.32, gain: 0.07, attack: 0.003 });
      });
      const tc = t0 + notes.length * 0.085 + 0.08;
      burst(tc, { type: 'bandpass', f: 1400 * p, q: 1.4, gain: 0.45, dur: 0.06 });
      tone(tc,  { f0: 150 * p, f1: 80 * p, dur: 0.1, gain: 0.34 });
      [523.25, 659.25, 783.99, 1046.5].forEach(f => tone(tc + 0.02, { f0: f * p, dur: 1.3, gain: 0.045, attack: 0.01 }));
    }
  };
})();

/* Public object. Callers always go through `sfx.x()`, so the parity test can
   wrap the methods (window.__debug.sfx, exposed by main.js only with ?debug=1). */
export const sfx = engine;
