// quickplay.js — Quick Play logic (no DOM): bands, what each needs, when it
// is offered, and the random pick without repeats.
//
// Difficulty = the hardest technique the puzzle needs (puzzles.json `hardest`).
//   Gentle  full house, hidden single   always
//   Easy    naked single                World 2 mastered
//   Medium  pointing / claiming         World 3 mastered
//   Tricky  pairs                       World 4 mastered
// "Challenge me" opens every band; hints still only use learned techniques.
import { BANDS } from './shared.js';
import { quick } from './puzzles.js';

export const BAND_INFO = {
  gentle: { name: 'Gentle', needs: 'Hidden Singles', world: 0, techs: ['full-house', 'hidden-single-box', 'hidden-single-line'] },
  easy:   { name: 'Easy',   needs: 'Naked Singles',  world: 2, techs: ['naked-single'] },
  medium: { name: 'Medium', needs: 'Pointing',       world: 3, techs: ['pointing', 'claiming'] },
  tricky: { name: 'Tricky', needs: 'Pairs',          world: 4, techs: ['naked-pair', 'hidden-pair'] }
};

/** Is the band offered? mastered = array of mastered worlds. */
export const bandOffered = (band, mastered) => BAND_INFO[band].world === 0 || mastered.includes(BAND_INFO[band].world);
export const bandOpen = (band, mastered, challenge) => challenge || bandOffered(band, mastered);

/** Pick a random puzzle of the band that was not handed out since the last
    reshuffle (mutates state.played). When every puzzle has been played, the
    band reshuffles; the puzzle just played is not picked again first. */
export function pickPuzzle(state, band, rand = Math.random) {
  const list = quick[band] || [];
  if (!list.length) return null;
  let played = new Set(state.played[band] || []);
  let pool = list.filter(p => !played.has(p.id));
  if (!pool.length) {
    const last = (state.played[band] || []).slice(-1)[0];
    state.played[band] = [];
    played = new Set();
    pool = list.filter(p => p.id !== last);
    if (!pool.length) pool = list.slice();
  }
  const pick = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  state.played[band] = [...(state.played[band] || []), pick.id];
  return pick.id;
}

/** Band of a Quick Play id ('q-medium-012' → 'medium'), or null. */
export function bandOfId(id) {
  const m = /^q-(\w+)-\d+$/.exec(id || '');
  return m && BAND_INFO[m[1]] ? m[1] : null;
}

/** Per-band stats for the cards. */
export function bandStats(state, band) {
  return { solved: (state.solved[band] || []).length, best: state.best[band] ?? null, total: (quick[band] || []).length };
}

/** "4:07" / "1:02:03" */
export function fmtTime(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
