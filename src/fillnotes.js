// fillnotes.js — the "Fill all candidates" mod key (step 7). Unlocked by
// finishing World 2's Level 0 (profile unlocks.fillNotes, set by campaign.js).
// A compact keycap left of Hint / Check: one press writes every empty cell's
// candidates (basic peer elimination, solver.computeCands) as notes — one undo
// step, free, never a mistake. Effect: a pencil-write wave across the board
// that starts nearest the key (its SOURCE) and sweeps outward (PURPOSE: the
// key is writing the notes). Hidden before the unlock, in Level 0 and in Spot it
// (Spot it boards come with their candidates already written).
import { bit, reducedMotion, haptic } from './util.js';
import { sfx } from './audio.js';
import { S, pushUndo } from './state.js';
import { cells, renderCell, refresh, hooks } from './board.js';
import { makeKey } from './pad.js';
import { FX } from './particles.js';
import { bindPress } from './input.js';
import { computeCands } from './solver.js';
import { getProfile, onProfile } from './profile.js';

const ICON_FILL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M7.5 8h.01M12 8h.01M16.5 8h.01M7.5 12h.01M12 12h.01M16.5 12h.01M7.5 16h.01M12 16h.01"/><path d="m15 15.5 1.4 1.4 2.6-2.8"/></svg>';
let key = null, timers = [];

export const fillUnlocked = () => { const p = getProfile(); return !!(p.unlocks.fillNotes || p.flags.devUnlockAll); };
export const fillVisible = () => fillUnlocked() && (S.mode === 'free') && !S.solved;

/** Fill every empty cell's notes with its computed candidates. Returns the number of cells changed. */
export function fillAll(origin = key) {
  if (!fillVisible()) return 0;
  const cand = computeCands(S.values);
  const list = [];
  for (let i = 0; i < 81; i++) if (!S.values[i] && S.notes[i] !== cand[i]) list.push(i);
  sfx.mod();
  if (!list.length) { sfx.blocked(); return 0; }
  pushUndo();                                  // one undo step for the whole fill
  const before = new Map(list.map(i => [i, S.notes[i]]));
  for (const i of list) S.notes[i] = cand[i];
  for (const t of timers) clearTimeout(t);
  timers = [];
  // the wave: nearest the key first
  const o = origin && origin.getBoundingClientRect ? origin.getBoundingClientRect() : null;
  const ox = o ? o.left + o.width / 2 : innerWidth / 2, oy = o ? o.top + o.height / 2 : innerHeight;
  const pos = i => { const r = cells[i].el.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - ox, r.top + r.height / 2 - oy); };
  const order = list.map(i => [i, pos(i)]).sort((a, b) => a[1] - b[1]);
  const d0 = order.length ? order[0][1] : 0, rm = reducedMotion();
  let sounds = 0, lastSound = -1e9;
  for (const [i, dpx] of order) {
    const delay = rm ? 0 : Math.round((dpx - d0) * 0.9);
    const added = cand[i] & ~before.get(i);
    timers.push(setTimeout(() => {
      renderCell(i, false);
      if (S.values[i]) return;
      let first = 0;
      for (let d = 1; d <= 9; d++) if (added & bit(d) && S.notes[i] & bit(d)) {
        if (!first) first = d;
        const span = cells[i].n[d - 1];
        if (rm) span.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90 });
        else span.animate([
          { transform: 'translate(-28%, 28%) scale(.2) rotate(-18deg)', opacity: 0 },
          { transform: 'translate(4%, -4%) scale(1.12) rotate(3deg)', opacity: 1, offset: .65 },
          { transform: 'none', opacity: 1 }
        ], { duration: 120, delay: d * 9, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'backwards' });
      }
      if (first && !rm) FX.flecks(i, first);
      if (delay - lastSound > 55 && sounds < 10) { sfx.scratch(0.005); sounds++; lastSound = delay; }
    }, delay));
  }
  refresh();                                    // autosave, hint ladder reset, status
  haptic(6);
  return list.length;
}

function place() {
  if (!key) return;
  const hk = document.querySelector('.key.hk:not(.wk):not(.lt)');
  const host = [...document.querySelectorAll('.hkeys')].find(h => h.querySelector(':scope > .key.hk'));
  if (host && key.parentNode !== host) host.insertBefore(key, host.querySelector(':scope > .key.hk'));
  void hk;
  const vis = fillVisible();
  key.classList.toggle('gone', !vis);
  key.setAttribute('aria-hidden', String(!vis));
}

export function initFillNotes() {
  const host = [...document.querySelectorAll('.hkeys')].find(h => h.querySelector(':scope > .key.hk'));
  if (!host) return;
  key = makeKey('mod fk', `${ICON_FILL}<span class="lbl">Fill</span>`, host);
  key.setAttribute('aria-label', 'Fill all candidates'); key.title = 'Fill all candidates (F)';
  host.insertBefore(key, host.querySelector(':scope > .key.hk'));
  bindPress(key, () => fillAll(key));
  const prev = hooks.afterRefresh;
  hooks.afterRefresh = () => { if (prev) prev(); place(); };
  onProfile(place);
  new ResizeObserver(place).observe(document.querySelector('.board-wrap'));
  window.addEventListener('resize', () => setTimeout(place, 0));
  place();
}
export const fillKey = () => key;
