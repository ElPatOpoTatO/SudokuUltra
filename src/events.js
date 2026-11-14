// events.js — the cross-module game events (step 7). See docs/progression.md.
//
//   sudoku:solved  — emitted ONCE whenever any puzzle is solved (campaign or free),
//                    from the single solve point in actions.js:
//     detail = { id, mode: 'campaign'|'free', kind, world, mistakes, paidHints,
//                silentWrong, ms, charges /* 0-3 */, clean /* charges === 3 */, cell }
//   sudoku:nav     — document.dispatchEvent(new CustomEvent('sudoku:nav',
//                    { detail: { to: 'home'|'campaign'|'free'|'settings' } }))
//                    (home.js listens for home / campaign / settings; Free Mode for free)
import { S } from './state.js';
import { entry } from './puzzles.js';
import { CHARGES_PER_LEVEL, MISTAKE_LIMIT, BAND_WORLD } from './progcfg.js';

const CAMPAIGN_KINDS = new Set(['spotIt', 'useIt', 'master', 'level0']);

/* The power-charge rule. Level 0 is guided: no charges. */
export function chargesFor({ kind, solved = true, paidHints = 0, mistakes = 0 }) {
  if (kind === 'level0' || !solved) return 0;
  let c = 1;                                   // 1) solved
  if (paidHints === 0) c++;                    // 2) no paid hints (hint levels 3-4)
  if (mistakes <= MISTAKE_LIMIT) c++;          // 3) few mistakes (a dead-end rewind counts 1)
  return Math.min(CHARGES_PER_LEVEL, c);
}

/* World a solve is weighted by: the campaign world, or the Free Mode band's world. */
export function worldOf(id) {
  const e = entry(id);
  if (e && e.world != null && e.world >= 0) return e.world;
  const band = e && (e.band || (e.item && e.item.band));
  if (band && BAND_WORLD[band] != null) return BAND_WORLD[band];
  const m = /^w(\d)-l0$/.exec(id || '');
  return m ? +m[1] : 0;
}

let t0 = performance.now(), t0id = '';
/** Called when a puzzle starts (progress.js hooks gameHooks.start). */
export function startClock(id) { if (id !== t0id) { t0 = performance.now(); t0id = id; } }

let lastSolved = null;
export const getLastSolved = () => lastSolved;

/** Build the detail for the puzzle that was just solved (reads S). */
export function solvedDetail(cell = -1) {
  const kind = S.kind || (entry(S.id) ? entry(S.id).kind : '');
  const mode = CAMPAIGN_KINDS.has(kind) ? 'campaign' : 'free';
  const r = { kind, solved: true, paidHints: S.paidHints | 0, mistakes: S.mistakes | 0 };
  const charges = chargesFor(r);
  return {
    id: S.id, mode, kind, world: worldOf(S.id),
    mistakes: r.mistakes, paidHints: r.paidHints, silentWrong: S.silentWrong | 0,
    ms: Math.round(performance.now() - (t0id === S.id ? t0 : performance.now())),
    charges, clean: charges === CHARGES_PER_LEVEL, cell
  };
}

export function emitSolved(detail) {
  lastSolved = detail;
  try { document.dispatchEvent(new CustomEvent('sudoku:solved', { detail })); } catch (e) { console.error(e); }
  return detail;
}

export function nav(to) {
  document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to } }));
}
