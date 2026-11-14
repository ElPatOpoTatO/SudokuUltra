// fm-progress.js — the ONLY place Free Mode learns which worlds are mastered.
//
// masteredWorlds(): sorted world numbers.
//   1. the progression profile, when step 7 exposes it as
//      window.__sudokuProfile.getProfile() → { mastered: [w…] | { <w>: true } }
//   2. fallback: the campaign runner's store 'sudoku.camp.v1' — a world counts
//      as mastered once its Master level is done ({ done: { <master id>: true } })
//   3. nothing readable → no world mastered.
// learnedTechniques(): what Free Mode hints may use. Gentle (full house +
//   hidden singles, ALLOW[1]) is always learned, plus every mastered world's
//   techniques. Returned in the solver's order (easiest first).
import { TECHNIQUES } from './solver.js';
import { ALLOW, WORLD_TECHS } from './shared.js';
import { worlds } from './puzzles.js';

function fromProfile() {
  try {
    const p = window.__sudokuProfile && window.__sudokuProfile.getProfile && window.__sudokuProfile.getProfile();
    if (!p || p.mastered == null) return null;
    const m = p.mastered;
    if (Array.isArray(m)) return m.map(Number).filter(w => Number.isInteger(w));
    if (typeof m === 'object') return Object.keys(m).filter(k => m[k]).map(Number).filter(w => Number.isInteger(w));
  } catch (e) {}
  return null;
}
function fromCampaign() {
  try {
    const o = JSON.parse(localStorage.getItem('sudoku.camp.v1') || 'null');
    if (!o || typeof o !== 'object' || !o.done) return [];
    return worlds.filter(W => W.master[0] && o.done[W.master[0].id]).map(W => W.world);
  } catch (e) { return []; }
}

export function masteredWorlds() {
  const list = fromProfile() || fromCampaign();
  return [...new Set(list)].sort((a, b) => a - b);
}
export const isMastered = w => masteredWorlds().includes(w);

export function learnedTechniques() {
  const set = new Set(ALLOW[1]);
  for (const w of masteredWorlds()) for (const t of WORLD_TECHS[w] || []) set.add(t);
  return TECHNIQUES.filter(t => set.has(t));
}
