// switches.js — synthesized mechanical switch sounds, one voice per keycap style.
//
// Replaces the generic key click (sfx.pen / pencil / mod / release) while a
// keycap style is active: audio.js routes those calls to sfx.sw(kind) when
// sfx.keyStyle is set (settings.js sets it; it stays null in the debug-only
// 'classic' look, so the parity test hears the prototype's clicks).
//
//   press   = (tactile bump | click-jacket transient) + stem bottom-out + housing knock
//   release = top-out (stem hitting the top housing) + a faint, slightly random spring ping
//
//   sa     — linear, tall thick ABS caps: deep, marbly "thock", low-mid body
//   cherry — brown tactile: soft bump, then a mid "thock"
//   lp     — low-profile clicky: sharp click jacket on the way down AND up, short and light
//
// Pencil = the "silent" version of the same switch (dampened, no click/bump
// transient, lowpassed). Mods = the same switch on a bigger cap (a touch lower).
// Every voice uses the engine's pj() (±5% pitch) plus gain and timing jitter.
// Everything starts at ctx.currentTime (the pointerdown), like the old click.
import { sfx } from './audio.js';

const P = sfx.prims;             // shared engine internals (ctx, noise, pj, jit, ...)
let bus = null, vol = 0.8;       // switch-sound bus (the "Switch sound" volume)
let lastKind = 'pen';            // the release mirrors the press it follows

function out() {
  const ctx = P.ctx;
  if (!bus || bus.context !== ctx) { bus = ctx.createGain(); bus.gain.value = vol; bus.connect(P.master); }
  return bus;
}
export function setSwitchVolume(v) {
  vol = Math.max(0, Math.min(1, +v || 0));
  if (bus) bus.gain.setTargetAtTime(vol, P.ctx.currentTime, 0.01);
}

/* local copies of the engine's burst/tone that play into the switch bus */
function env(g, t, peak, attack, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
}
function burst(t, { type = 'bandpass', f = 2000, q = 1, gain = 0.3, dur = 0.02, attack = 0.0006 }) {
  const ctx = P.ctx, src = ctx.createBufferSource(); src.buffer = P.noise;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ctx.createGain(); env(g, t, gain, attack, dur);
  src.connect(fl); fl.connect(g); g.connect(out());
  src.start(t, Math.random() * 0.9); src.stop(t + attack + dur + 0.03);
}
function tone(t, { type = 'sine', f0 = 440, f1 = f0, dur = 0.05, gain = 0.2, attack = 0.001, glide = dur }) {
  const ctx = P.ctx, o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  const g = ctx.createGain(); env(g, t, gain, attack, dur);
  o.connect(g); g.connect(out());
  o.start(t); o.stop(t + attack + dur + 0.04);
}

/* The spring: a very quiet, short, inharmonic ring, a little different every time */
function ping(t, f, gain) {
  const j = P.jit, ff = f * j(0.08), g = gain * j(0.45), d = 0.07 * j(0.35);
  tone(t, { f0: ff, f1: ff * 0.985, dur: d, gain: g, attack: 0.0015 });
  tone(t + 0.0007, { f0: ff * 1.47, dur: d * 0.55, gain: g * 0.45, attack: 0.0012 });
}

/* Voices. p = pitch factor, v = gain factor, s = 1 (pen) or the silent damping (pencil), m = mod */
const VOICES = {
  sa: {
    down(t, p, v, s, m) {
      const dt = 0.0055 * P.jit(0.2), lo = m ? 0.9 : 1;
      if (!s.silent) burst(t, { type: 'highpass', f: 5200 * p, q: 0.7, gain: 0.035 * v, dur: 0.003, attack: 0.0003 });
      const tb = t + dt;   // bottom-out: dense, low and round
      burst(tb, { type: 'bandpass', f: 1050 * p * s.f, q: 0.95, gain: 0.30 * v * s.g, dur: 0.022, attack: s.a });
      burst(tb, { type: 'lowpass', f: 620 * p * s.f, q: 0.7, gain: 0.20 * v * s.g, dur: 0.05, attack: s.a * 1.6 });
      tone(tb, { f0: 205 * p * lo, f1: 108 * p * lo, dur: 0.075, gain: 0.30 * v * s.g, glide: 0.04, attack: s.a });
      // marble: a second, short resonance of the thick cap
      tone(tb + 0.001, { f0: 540 * p, f1: 470 * p, dur: 0.028, gain: 0.07 * v * s.g * s.g, attack: s.a });
      // housing knock (the top housing rattling on the bottom one)
      tone(tb + 0.002, { type: 'triangle', f0: 350 * p, f1: 245 * p, dur: 0.022, gain: 0.07 * v * s.g });
      if (m) tone(tb, { f0: 92 * p, f1: 64 * p, dur: 0.07, gain: 0.12 * v * s.g, attack: 0.002 });
    },
    up(t, p, v, s) {
      burst(t, { type: 'bandpass', f: 1500 * p * s.f, q: 1.6, gain: 0.075 * v * s.g, dur: 0.012, attack: s.a });
      tone(t, { f0: 265 * p, f1: 205 * p, dur: 0.022, gain: 0.05 * v * s.g });
      if (!s.silent) ping(t + 0.004, 3900 * p, 0.0075 * v);
    }
  },
  cherry: {
    down(t, p, v, s, m) {
      const lo = m ? 0.9 : 1;
      // tactile bump: a soft, dull "tk" as the leaf passes the bump
      if (!s.silent) {
        burst(t, { type: 'bandpass', f: 1900 * p, q: 1.3, gain: 0.085 * v, dur: 0.008, attack: 0.0005 });
        tone(t, { f0: 330 * p, f1: 260 * p, dur: 0.012, gain: 0.035 * v });
      }
      const tb = t + 0.0075 * P.jit(0.2);   // bottom-out: mid thock
      burst(tb, { type: 'bandpass', f: 1650 * p * s.f, q: 1.25, gain: 0.30 * v * s.g, dur: 0.02, attack: s.a });
      burst(tb, { type: 'lowpass', f: 850 * p * s.f, q: 0.7, gain: 0.12 * v * s.g, dur: 0.032, attack: s.a * 1.6 });
      tone(tb, { f0: 245 * p * lo, f1: 140 * p * lo, dur: 0.055, gain: 0.25 * v * s.g, glide: 0.032, attack: s.a });
      // housing knock: a little brighter and thinner than SA
      burst(tb + 0.0015, { type: 'bandpass', f: 3200 * p * s.f, q: 2.5, gain: 0.09 * v * s.g, dur: 0.008 });
      tone(tb + 0.002, { type: 'triangle', f0: 640 * p, f1: 420 * p, dur: 0.016, gain: 0.04 * v * s.g });
      if (m) tone(tb, { f0: 110 * p, f1: 74 * p, dur: 0.06, gain: 0.10 * v * s.g, attack: 0.002 });
    },
    up(t, p, v, s) {
      burst(t, { type: 'bandpass', f: 2200 * p * s.f, q: 1.8, gain: 0.08 * v * s.g, dur: 0.01, attack: s.a });
      tone(t, { f0: 390 * p, f1: 300 * p, dur: 0.016, gain: 0.035 * v * s.g });
      if (!s.silent) ping(t + 0.0035, 4700 * p, 0.0065 * v);
    }
  },
  lp: {
    down(t, p, v, s, m) {
      // click jacket: sharp, bright, short (missing on the silent version)
      if (!s.silent) {
        burst(t, { type: 'highpass', f: 7200 * p, q: 0.7, gain: 0.30 * v, dur: 0.0028, attack: 0.0002 });
        burst(t, { type: 'bandpass', f: 4300 * p, q: 4.2, gain: 0.62 * v, dur: 0.010, attack: 0.00025 });
        tone(t, { type: 'triangle', f0: 2300 * p, f1: 1850 * p, dur: 0.006, gain: 0.05 * v });
      }
      const tb = t + 0.004 * P.jit(0.2);   // short travel: light, thin bottom-out
      burst(tb, { type: 'bandpass', f: 2600 * p * s.f, q: 1.4, gain: 0.26 * v * s.g, dur: 0.012, attack: s.a });
      tone(tb, { f0: 360 * p * (m ? 0.88 : 1), f1: 250 * p, dur: 0.032, gain: 0.24 * v * s.g, glide: 0.02, attack: s.a });
      burst(tb + 0.001, { type: 'lowpass', f: 1300 * p * s.f, q: 0.7, gain: 0.11 * v * s.g, dur: 0.018 });
    },
    up(t, p, v, s) {
      // the click jacket snaps back on the way up
      if (!s.silent) {
        burst(t, { type: 'bandpass', f: 4700 * p, q: 3.6, gain: 0.15 * v, dur: 0.007, attack: 0.00025 });
        burst(t, { type: 'highpass', f: 7600 * p, q: 0.7, gain: 0.07 * v, dur: 0.002, attack: 0.0002 });
      }
      tone(t + 0.001, { f0: 430 * p, f1: 360 * p, dur: 0.01, gain: 0.03 * v * s.g });
      if (!s.silent) ping(t + 0.003, 5400 * p, 0.0055 * v);
    }
  }
};
const PEN = { silent: false, g: 1, f: 1, a: 0.0006 };
const SILENT = { silent: true, g: 0.55, f: 0.62, a: 0.0018 };

/* sfx.sw(kind): kind = 'pen' | 'pencil' | 'mod' | 'up'. Called by audio.js
   (pen/pencil/mod/release) only while sfx.keyStyle is set. */
sfx.sw = function (kind) {
  if (!P.ready()) return;
  const voice = VOICES[sfx.keyStyle] || VOICES.sa;
  const t = P.now(), p = P.pj(), v = P.jit(0.12);
  if (kind === 'up') {
    voice.up(t, p, v, lastKind === 'pencil' ? SILENT : PEN);
    return;
  }
  lastKind = kind;
  voice.down(t, p, v, kind === 'pencil' ? SILENT : PEN, kind === 'mod');
};
export const SWITCH_NAMES = { sa: 'Linear · thock', cherry: 'Brown tactile', lp: 'Clicky' };

/* --- step10: a key-like moment away from the pad (the Home title keys settling, a
   week-strip day latching): the player's own switch, press + release, at `gain` of
   its volume. Same voices, same ±5 % pitch jitter (pj). Silent in the classic look. --- */
export function swPress(gain = 0.3, kind = 'pen') {
  if (!P.ready() || !sfx.keyStyle) return;
  const voice = VOICES[sfx.keyStyle] || VOICES.sa;
  const t = P.now(), p = P.pj(), v = P.jit(0.12) * gain;
  voice.down(t, p, v, PEN, kind === 'mod');
  voice.up(t + 0.075 * P.jit(0.2), P.pj(), v * 0.8, PEN);
}
/* --- end step10 --- */
