// fm-progress.js — the ONLY place Free Mode learns which worlds are mastered.
//
// masteredWorlds(): sorted world numbers, straight from the progression
//   profile (profile.js getProfile().mastered, step 7). The profile loads when
//   its module is evaluated (and migrates the old 'sudoku.camp.v1' store once),
//   so it is always ready by the time Free Mode asks. Safe fallback: if reading
//   it throws, nothing is mastered (Gentle only), never a crash.
// learnedTechniques(): what Free Mode hints may use. Gentle (full house +
//   hidden singles, ALLOW[1]) is always learned, plus every mastered world's
//   techniques. Returned in the solver's order (easiest first).
import { TECHNIQUES } from './solver.js';
import { ALLOW, WORLD_TECHS } from './shared.js';
import { getProfile } from './profile.js';

export function masteredWorlds() {
  let list = [];
  try {
    const m = getProfile().mastered;
    if (Array.isArray(m)) list = m.map(Number).filter(w => Number.isInteger(w));
  } catch (e) { list = []; }
  return [...new Set(list)].sort((a, b) => a - b);
}
export const isMastered = w => masteredWorlds().includes(w);

export function learnedTechniques() {
  const set = new Set(ALLOW[1]);
  for (const w of masteredWorlds()) for (const t of WORLD_TECHS[w] || []) set.add(t);
  return TECHNIQUES.filter(t => set.has(t));
}
