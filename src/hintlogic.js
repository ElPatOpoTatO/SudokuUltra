// hintlogic.js — the hint ladder and "check my thinking", logic only (no DOM).
// Runs in Node too (tools/test-hints.mjs imports it).
//
// The `unlocked` rule: a hint may only use (and name) techniques in `unlocked`.
// Default: ALLOW[w] for campaign items (ids w<w>-spot/use/master-..), ALLOW[4]
// for everything else (Quick Play, Daily, the prototype puzzle, dev).
import {
  TECHNIQUES, TECH_INFO, computeCands, nextStep, allSteps, applyStep, checkClaim,
  cellName, unitName, bit, digitsOf, BOXES, boxOf
} from './solver.js';
import { ALLOW } from './shared.js';

/** Techniques a hint may use for a puzzle id. */
export function unlockedFor(id) {
  const m = /^w(\d)-/.exec(id || '');
  const w = m ? Math.min(+m[1], ALLOW.length - 1) : ALLOW.length - 1;
  return ALLOW[w].slice();
}

/** Display names used in hint text (the solver's names carry box/line detail). */
export const HINT_NAME = {
  'full-house': 'Full House',
  'hidden-single-box': 'Hidden Single',
  'hidden-single-line': 'Hidden Single',
  'naked-single': 'Naked Single',
  pointing: 'Pointing pattern',
  claiming: 'Claiming pattern',
  'naked-pair': 'Naked Pair',
  'hidden-pair': 'Hidden Pair'
};

/**
 * Candidates as the player sees the board: in a cell with notes, the notes
 * intersected with the computed candidates; in a cell without notes, the
 * computed candidates. Filled cells are 0.
 */
export function hintCands(values, notes) {
  const comp = computeCands(values);
  const c = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    if (values[i]) continue;
    c[i] = notes[i] ? (notes[i] & comp[i]) : comp[i];
  }
  return c;
}

/** First placed (non-given) digit that differs from the solution, or -1. */
export function firstWrong(values, given, sol) {
  for (let i = 0; i < 81; i++) if (values[i] && !given[i] && values[i] !== sol[i]) return i;
  return -1;
}

/** First cell whose notes are missing its solution digit: {cell, digit} or null. */
export function firstMissingNote(values, notes, sol) {
  for (let i = 0; i < 81; i++) {
    if (values[i] || !notes[i]) continue;
    if (!(notes[i] & bit(sol[i]))) return { cell: i, digit: sol[i] };
  }
  return null;
}

const sameStep = (a, b) => a && b && a.tech === b.tech &&
  JSON.stringify(a.place) === JSON.stringify(b.place) &&
  JSON.stringify(a.pattern) === JSON.stringify(b.pattern) &&
  JSON.stringify(a.eliminate) === JSON.stringify(b.eliminate);

/**
 * What the next hint is about. ctx = { values, notes, given, sol, unlocked,
 * mode ('free'|'spot'), solved, spot: {steps, step} }.
 * Returns one of:
 *   {kind:'solved'}
 *   {kind:'wrong', cell, digit}             a placed digit that doesn't match the solution
 *   {kind:'missing', cell, digit}           notes lack the cell's solution digit
 *   {kind:'step', step, cands}              the easiest step within `unlocked`
 *   {kind:'none'}                           nothing within `unlocked`
 */
export function findHint(ctx) {
  const { values, notes, given, sol, mode, solved } = ctx;
  const unlocked = ctx.unlocked || ALLOW[ALLOW.length - 1];
  if (solved) return { kind: 'solved' };
  let full = true;
  for (let i = 0; i < 81; i++) if (!values[i]) { full = false; break; }
  const w = firstWrong(values, given, sol);
  if (w >= 0) return { kind: 'wrong', cell: w, digit: values[w] };
  if (full) return { kind: 'solved' };
  const miss = firstMissingNote(values, notes, sol);
  if (miss) return { kind: 'missing', ...miss };
  const cands = hintCands(values, notes);
  if (mode === 'spot' && ctx.spot && ctx.spot.steps && ctx.spot.steps.length) {
    // Spot it: straight to the target technique (the stored step if it is valid)
    const allowed = new Set(unlocked);
    const valid = ctx.spot.steps.filter(st => allowed.has(st.tech));
    const st = valid.find(s => sameStep(s, ctx.spot.step)) || valid[0];
    if (st) return { kind: 'step', step: st, cands };
  }
  const step = nextStep(values, cands, unlocked);
  if (!step) return { kind: 'none' };
  return { kind: 'step', step, cands };
}

/** Max ladder level per hint kind. */
export function maxLevel(h) {
  switch (h.kind) {
    case 'step': return 4;
    case 'wrong': return 4;
    case 'missing': return 3;
    default: return 1;
  }
}
/** Levels that cost the "no hints" unit. */
export const isPaid = (h, level) => (h.kind === 'step' || h.kind === 'wrong' || h.kind === 'missing') && level >= 3;

/** Unit cells a hint tints at level 2 (and keeps tinted after). */
export function hintUnit(h) {
  if (h.kind === 'step') {
    const st = h.step;
    if (st.unit) return { ...st.unit, cells: unitCells(st.unit) };
    const c = st.place ? st.place.cell : st.pattern[0];
    return { type: 'box', index: boxOf(c), cells: BOXES[boxOf(c)].slice() };
  }
  if (h.kind === 'wrong' || h.kind === 'missing') {
    const b = boxOf(h.cell);
    return { type: 'box', index: b, cells: BOXES[b].slice() };
  }
  return null;
}
function unitCells(u) {
  const out = [];
  for (let k = 0; k < 9; k++) {
    if (u.type === 'row') out.push(u.index * 9 + k);
    else if (u.type === 'col') out.push(k * 9 + u.index);
    else out.push(BOXES[u.index][k]);
  }
  return out;
}

/** Coach text for a hint at a level. Plain text plus <b> for the key term. */
export function hintText(h, level) {
  const esc = s => String(s);
  switch (h.kind) {
    case 'solved': return 'Nothing left to hint: the puzzle is solved.';
    case 'none': return "No move with the techniques you've learned. Check your notes or try a guess-free scan.";
    case 'missing':
      if (level === 1) return `Your notes are missing a <b>${h.digit}</b> in ${cellName(h.cell)}.`;
      if (level === 2) return `Here: ${cellName(h.cell)} can still be ${h.digit}.`;
      return `Put back: ${h.digit} is a candidate in ${cellName(h.cell)} again.`;
    case 'wrong':
      if (level === 1) return 'One of your digits doesn\'t match the solution.';
      if (level === 2) return `It's in <b>box ${boxOf(h.cell) + 1}</b>.`;
      if (level === 3) return `It's the ${h.digit} in <b>${cellName(h.cell)}</b>.`;
      return `Erased the ${h.digit} in ${cellName(h.cell)}: it doesn't match the solution.`;
    case 'step': {
      const st = h.step, name = HINT_NAME[st.tech] || TECH_INFO[st.tech].name;
      if (level === 1) return `There's a <b>${esc(name)}</b> you can use.`;
      if (level === 2) {
        const u = hintUnit(h);
        return `Look in <b>${unitName(u)}</b>.`;
      }
      if (level === 3) {
        if (st.place) return `Look at <b>${cellName(st.place.cell)}</b>: only one digit fits there.`;
        const ds = [...new Set(st.eliminate.map(e => e[1]))].sort((a, b) => a - b);
        const n = st.eliminate.length;
        return `The outlined cells make the pattern. ${n === 1 ? 'The red candidate goes' : `The red ${ds.length === 1 ? ds[0] + 's' : 'candidates'} go`}.`;
      }
      return esc(st.text);
    }
  }
  return '';
}

/** Copy of the board with the step applied (for checks and tests). */
export function applied(values, cands, step) {
  const v = Int8Array.from(values), c = Uint16Array.from(cands);
  applyStep(v, c, step);
  return { values: v, cands: c };
}

/** Does a step agree with the solution? (placement correct, no solution digit removed) */
export function stepAgrees(step, sol) {
  if (step.place && sol[step.place.cell] !== step.place.digit) return false;
  for (const [c, d] of step.eliminate || []) if (sol[c] === d) return false;
  return true;
}

/** Rank of a technique (lower = easier). */
export const techRank = t => TECHNIQUES.indexOf(t);

/** Is `step` the easiest available within `unlocked`? (used by tests) */
export function isEasiest(values, cands, unlocked, step) {
  const first = allSteps(values, cands, unlocked).next();
  return !first.done && techRank(first.value.tech) === techRank(step.tech);
}

/* =========================================================================
   CHECK MY THINKING
   ========================================================================= */
/** Claim types. `cells`: [min, max]; `digits`: how many digits the keypad asks for;
    `needs`: offered only when one of these techniques is unlocked (none = always). */
export const CLAIMS = [
  { id: 'place', label: 'This digit goes here', cells: [1, 1], digits: 1, needs: null },
  { id: 'eliminate', label: 'This candidate can go', cells: [1, 1], digits: 1, needs: null },
  { id: 'naked-single', label: 'Naked single', cells: [1, 1], digits: 0, needs: ['naked-single'] },
  { id: 'hidden-single', label: 'Hidden single', cells: [1, 1], digits: 1, needs: ['hidden-single-box', 'hidden-single-line'] },
  { id: 'locked', label: 'Pointing / Claiming', cells: [2, 3], digits: 1, needs: ['pointing', 'claiming'] },
  { id: 'naked-pair', label: 'Naked pair', cells: [2, 2], digits: 0, needs: ['naked-pair'] },
  { id: 'hidden-pair', label: 'Hidden pair', cells: [2, 2], digits: 2, needs: ['hidden-pair'] }
];

/** Claim types the player may use (same `unlocked` rule as hints). */
export function claimsFor(unlocked) {
  const set = new Set(unlocked);
  return CLAIMS.filter(c => !c.needs || c.needs.some(t => set.has(t)));
}

/** Candidates for a check: what the player sees, with each cell's solution
    digit put back where the notes lost it (so a claim is judged soundly). */
export function checkCands(values, notes, sol) {
  const c = hintCands(values, notes);
  for (let i = 0; i < 81; i++) if (!values[i] && sol && sol[i]) c[i] |= bit(sol[i]);
  return c;
}

/**
 * Run a claim. claimId from CLAIMS, cells = [cell...], digits = [d...].
 * Returns {ok, text}. Never changes anything.
 */
export function runClaim({ values, notes, sol }, claimId, cells, digits = []) {
  const cands = checkCands(values, notes, sol);
  let r;
  if (claimId === 'place' || claimId === 'eliminate') {
    r = checkClaim(values, cands, { type: claimId, cell: cells[0], digit: digits[0] }, sol);
  } else if (claimId === 'locked') {
    const a = checkClaim(values, cands, { type: 'pattern', tech: 'pointing', cells, digits }, sol);
    const b = a.ok ? a : checkClaim(values, cands, { type: 'pattern', tech: 'claiming', cells, digits }, sol);
    r = a.ok ? a : b.ok ? b : a;
  } else {
    r = checkClaim(values, cands, { type: 'pattern', tech: claimId, cells, digits: digits.length ? digits : undefined }, sol);
  }
  // the player's notes lost a candidate that is still the answer in a selected cell
  const lost = cells.filter(i => !values[i] && notes[i] && sol && !(notes[i] & bit(sol[i])));
  if (lost.length) r = { ok: r.ok, text: `${r.text} (Careful: your notes in ${lost.map(cellName).join(' and ')} are missing a candidate.)` };
  return r;
}

