// actions.js — game actions: placement and its consequences, notes, erase,
// undo, release, reset, toast. Moved verbatim from the feel prototype
// (section 8 + modifier keys). Shell additions, all marked "rules": silent
// wrong digits, dead end + Rewind, Spot it feedback and success.
import { $, PEERS, unitsOf, bit, reducedMotion, dist, haptic, RIPPLE_MS, ROWS, COLS, BOXES } from './util.js';
import { sfx } from './audio.js';
import {
  S, UI, pushUndo, restore, countOf, isLocked, isSolvedBoard, checkDeadEnd,
  rewindTarget, rewindNotes, spotPlacementHit, spotEliminationHit
} from './state.js';
/* --- step8 --- */
import { feedbackMode } from './state.js';
/* --- end step8 --- */
import {
  cells, mistEl, toastEl, toastMsg, renderCell, renderAll, refresh,
  animPop, animFlash, animNoteIn, animNoteFlick, animErase, animModeShimmer, animPing, bumpCounter,
  animNoteOut, animShake, animBlink, animSweep, animCascade, CASCADE_STEP, SWEEP_STEP
} from './board.js';
import { FX } from './particles.js';
/* --- step7: the single solve point emits sudoku:solved --- */
import { emitSolved, solvedDetail } from './events.js';
/* --- end step7 --- */

const toastTitle = $('toastTitle'), againLbl = document.querySelector('#againKey .lbl');
export const deadEl = $('dead');
export const shell = { rewindKey: null };   // set by main.js once the banner key is built
/* --- level0: toast hooks (level0.js shows its outro instead; campaign.js relabels the keycap) --- */
export const toastHooks = { before: null, after: null };
/* --- end level0 --- */

/* =========================================================================
   8. GAME ACTIONS
   ========================================================================= */

/* Toggle a pencil mark (never a mistake). Returns true if applied. */
export function toggleNote(i, d) {
  if (S.given[i] || S.values[i]) return false;
  pushUndo();
  S.notes[i] ^= bit(d);
  renderCell(i);
  if (S.notes[i] & bit(d)) {            // written
    animNoteIn(cells[i].n[d - 1]); FX.flecks(i, d); sfx.scratch(0.01);
  } else {                              // flicked off
    const dir = Math.random() < .5 ? -1 : 1;
    animNoteFlick(cells[i].n[d - 1], dir); FX.flickOff(i, d, dir); sfx.flick(0.01);
  }
  refresh();
  if (!(S.notes[i] & bit(d))) afterErase([[i, d]], i);   // rules: Spot it erasures
  return true;
}

/* Place a digit immediately (zero latency). Consequences — cleanup ripple,
   conflict check, completions — run on release so that a long-press can
   convert the placement into a note without side effects. */
export function placeProvisional(i, d, pressId) {
  pushUndo();
  S.values[i] = d;
  S.notes[i] = 0;
  renderCell(i);
  animPop(cells[i].v);
  animFlash(i);
  if (!PEERS[i].some(j => S.values[j] === d)) FX.spark(i);   // only clean-looking placements spark
  refresh();
  haptic(6);
  S.pending = { i, d, pressId };
}

/* Clear a player cell (value or notes). */
export function clearCell(i) {
  if (S.given[i] || (!S.values[i] && !S.notes[i])) return false;
  pushUndo();
  const val = S.values[i], notes = S.notes[i], color = val ? getComputedStyle(cells[i].v).color : '';
  S.values[i] = 0; S.notes[i] = 0;
  renderCell(i);
  const dir = animErase(i, val, notes, color);   // rubbed out, not vanished
  FX.crumbs(i, dir, !val);
  sfx.erase(dir, !val);
  refresh();
  if (!val) { const list = []; for (let d = 1; d <= 9; d++) if (notes & bit(d)) list.push([i, d]); afterErase(list, i); }
  else afterErase([], i);
  return true;
}

/* Run the consequences of the pending placement (called on release). */
export function finalizePending() {
  if (!S.pending) return;
  const { i, d } = S.pending;
  S.pending = null;
  consequences(i, d);
}

/* Long-press reached while a placement is pending → turn it into a note. */
export function convertPendingToNote() {
  const { i, d } = S.pending;
  S.pending = null;
  restore(S.undo.pop());
  renderCell(i);
  toggleNote(i, d);
  sfx.pencil();
  haptic(4);
}

function consequences(i, d) {
  // 1) Auto-cleanup ripple: remove d from notes of peers, nearest first
  const hits = PEERS[i].filter(j => !S.values[j] && (S.notes[j] & bit(d)))
                       .sort((a, b) => dist(a, i) - dist(b, i) || a - b);
  const step = reducedMotion() ? 15 : RIPPLE_MS;
  // motes leave each note at the peak of its pop (25% of the 190ms note-out)
  FX.absorb(i, hits.map((j, k) => ({ j, d, delay: 40 + k * step + (reducedMotion() ? 0 : 45) })));
  hits.forEach((j, k) => {
    S.notes[j] &= ~bit(d);
    const span = cells[j].n[d - 1];
    // class is dropped when the animation ends (avoids any first-frame flicker)
    animNoteOut(span, 40 + k * step, () => {
      if (S.values[j] || !(S.notes[j] & bit(d))) span.classList.remove('on');
    });
    sfx.noteTick(0.04 + (k * step) / 1000, k);
  });

  // 2) Conflicts (only visible clashes count as mistakes; Spot it also shows
  //    a wrong digit at once). A wrong digit with no visible clash is silent.
  const clashes = PEERS[i].filter(j => S.values[j] === d);
  const wrong = d !== S.sol[i];
  /* --- step8: Free Mode feedback ('instant' flags any wrong digit, 'nothing' shows nothing) --- */
  const fb = feedbackMode();
  if (fb === 'nothing' && S.mode === 'free') {
    if (wrong) S.silentWrong++;
  } else
  /* --- end step8 --- */
  if (clashes.length || (wrong && (S.mode === 'spot' /* --- step8 --- */ || fb === 'instant' /* --- end step8 --- */))) {
    mistake(i, clashes);
  } else if (wrong) S.silentWrong++;

  // 3) Completions
  const solved = (S.mode === 'free' /* --- level0 --- */ || S.mode === 'l0' /* --- end level0 --- */) && isSolvedBoard();
  const spotHit = S.mode === 'spot' && !wrong && !S.solved ? spotPlacementHit(i, d) : null;
  if (spotHit) spotSuccess(spotHit, i);
  else if (solved) {
    S.solved = true;
    /* --- step7 --- */ emitSolved(solvedDetail(i)); /* --- end step7 --- */
    S.selected = -1; S.loaded = 0; S.loadedNote = false;
    const total = animCascade(i);
    FX.wave(i, CASCADE_STEP());
    sfx.complete();
    haptic([0, 20, 60, 20, 60, 40]);
    setTimeout(showToast, Math.min(total, 1100));
  } else if (!clashes.length) {
    let n = 0;
    for (const u of unitsOf(i)) {
      if (u.every(j => S.values[j] === S.sol[j])) {
        const delay = n * 180;
        animSweep(u, i, 120 + delay);
        FX.gather(u, i, 120 + delay, SWEEP_STEP());
        sfx.latch(delay / 1000, n);
        haptic(12);
        n++;
      }
    }
  }

  // 4) A digit just ran out: its keycap releases as it locks
  if (countOf(d) === 9) FX.release(d);

  // 5) Release a loaded digit once all nine are placed
  if (S.loaded && isLocked(S.loaded)) { S.loaded = 0; S.loadedNote = false; }

  // 6) Dead end (free play): the board can no longer be completed
  if (!clashes.length && checkDeadEnd()) showDeadEnd();
  refresh();
}

/* MISTAKE feedback (verbatim from the prototype's conflict branch). */
function mistake(i, clashes) {
  S.mistakes++;
  const fly = FX.toCounter(i);
  if (fly > 0) {
    UI.mistHeld++; const gen = UI.mistGen;
    setTimeout(() => { if (gen !== UI.mistGen) return; UI.mistHeld = Math.max(0, UI.mistHeld - 1); refresh(); bumpCounter(); }, fly);
  } else bumpCounter();
  animShake(i);
  clashes.forEach(animBlink);
  FX.chips(i, clashes);
  sfx.error();
  haptic([0, 30, 40, 30]);
}

/* =========================================================================
   rules: after the player removed notes / a digit
   ========================================================================= */
function afterErase(list, i) {
  if (S.deadEnd && !checkDeadEnd()) { hideDeadEnd(); refresh(); }
  if (S.mode !== 'spot' || S.solved || !list.length) return;
  let bad = null;
  for (const [c, d] of list) {
    if (S.sol[c] === d) bad = bad || [c, d];
    else S.spot.erased.add(c * 10 + d);
  }
  if (bad) {
    // erasing the cell's true digit: instant feedback, then the note comes back
    const [c, d] = bad, gen = UI.mistGen;
    mistake(c, []);
    refresh();
    setTimeout(() => {
      if (gen !== UI.mistGen || S.values[c] || (S.notes[c] & bit(d))) return;
      S.notes[c] |= bit(d);
      renderCell(c); animNoteIn(cells[c].n[d - 1]); sfx.scratch(0.01);
      refresh();
    }, 360);
    return;
  }
  const hit = spotEliminationHit();
  if (hit) { spotSuccess(hit, i); refresh(); }
}

/* --- hints: the hint ladder removes notes through the same rules path --- */
export function notesRemoved(list, i) { afterErase(list, i); }
/* --- end hints --- */

/* =========================================================================
   rules: Spot it success — the latch/sweep language of a closed unit, then
   the toast with a Next keycap
   ========================================================================= */
const UNIT_CELLS = { row: ROWS, col: COLS, box: BOXES };
function spotSuccess(step, origin) {
  S.solved = true;
  S.spot.found = step;
  /* --- step7 --- */ emitSolved(solvedDetail(origin)); /* --- end step7 --- */
  S.selected = -1; S.loaded = 0; S.loadedNote = false;
  const unit = step.unit ? UNIT_CELLS[step.unit.type][step.unit.index] : unitsOf(origin)[0];
  const o = unit.includes(origin) ? origin : unit.slice().sort((a, b) => dist(a, origin) - dist(b, origin))[0];
  animSweep(unit, o, 120);
  FX.gather(unit, o, 120, SWEEP_STEP());
  const marks = new Set([...(step.pattern || []), ...(step.place ? [step.place.cell] : []), ...step.eliminate.map(e => e[0])]);
  [...marks].forEach(j => animPing(j, 380 + dist(j, o) * SWEEP_STEP(), .55));
  sfx.latch(0, 0);
  sfx.latch(0.18, 1);
  haptic([0, 12, 60, 12]);
  setTimeout(showToast, reducedMotion() ? 450 : 900);
}

/* =========================================================================
   rules: dead end banner + Rewind
   ========================================================================= */
export function showDeadEnd() {
  if (S.deadEnd) return;
  S.deadEnd = true;
  deadEl.classList.add('show');
}
export function hideDeadEnd() {
  S.deadEnd = false;
  deadEl.classList.remove('show');
}
export function doRewind() {
  sfx.mod();
  if (!S.deadEnd) return;
  const tgt = rewindTarget();
  const notes = rewindNotes(tgt.values, tgt.notes);
  // the wrong digits lift back into the Rewind key (undo language); the correct ones that return pop in
  const lift = [], back = [];
  for (let i = 0; i < 81; i++) {
    const v0 = S.values[i], v1 = tgt.values[i];
    if (v0 && v0 !== v1 && lift.length < 12) lift.push({ i, txt: String(v0), small: false, color: getComputedStyle(cells[i].v).color });
    if (v1 && v1 !== v0) back.push(i);
  }
  FX.undoLift(lift, shell.rewindKey);
  S.pending = null;
  S.values.set(tgt.values); S.notes.set(notes); S.solved = false;
  S.undo.length = Math.max(0, tgt.index);
  S.selected = -1; S.loaded = 0; S.loadedNote = false;
  S.mistakes++;                      // the dead end counts once
  hideDeadEnd();
  renderAll();
  back.forEach(i => animPop(cells[i].v));
  sfx.whoosh();
  refresh();
  bumpCounter();
  haptic(5);
}

/* ---- Modifier keys --------------------------------------------------- */
export function togglePencil() {
  S.pencil = !S.pencil;
  if (S.loaded) S.loadedNote = false;
  sfx.mod(); haptic(5);
  refresh();
  animModeShimmer(S.pencil);
}
export function doErase() {
  sfx.mod();
  if (S.selected >= 0 && !S.solved && clearCell(S.selected)) { haptic(5); return; }
}
export function doUndo() {
  sfx.mod();
  const snap = S.undo.pop();
  if (!snap) return;
  const wasSolved = S.solved;
  // what is about to be taken back (lifts to the Undo key) and what returns (pops back in)
  const lift = [], back = [], noteBack = [];
  for (let i = 0; i < 81; i++) {
    const v0 = S.values[i], v1 = snap.v[i], n0 = v0 ? 0 : S.notes[i], n1 = v1 ? 0 : snap.n[i];
    if (v0 && v0 !== v1) lift.push({ i, txt: String(v0), small: false, color: getComputedStyle(cells[i].v).color });
    if (v1 && v1 !== v0) back.push(i);
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      if ((n0 & b) && !(n1 & b) && lift.length < 6) lift.push({ i, txt: String(d), small: true, color: getComputedStyle(cells[i].n[d - 1]).color });
      if ((n1 & b) && !(n0 & b)) noteBack.push([i, d]);
    }
  }
  FX.undoLift(lift);      // positions read before the board re-renders
  restore(snap);
  if (wasSolved && !S.solved) hideToast();
  renderAll();
  back.forEach(i => animPop(cells[i].v));
  noteBack.forEach(([i, d]) => animNoteIn(cells[i].n[d - 1]));
  sfx.whoosh();
  if (S.deadEnd && !checkDeadEnd()) hideDeadEnd();
  refresh();
  haptic(5);
}
export function release() {
  if (!S.loaded && S.selected < 0) return;
  S.loaded = 0; S.loadedNote = false; S.selected = -1;
  sfx.select();
  refresh();
}
export function resetGame() {
  S.pending = null;
  S.values.set(S.given); S.notes.set(S.startNotes);
  S.selected = -1; S.loaded = 0; S.loadedNote = false; S.pencil = false;
  S.mistakes = 0; S.solved = false; S.undo = [];
  S.silentWrong = 0; if (S.spot) S.spot.erased.clear();
  /* --- hints: a restart is a fresh attempt --- */ S.paidHints = 0; /* --- end hints --- */
  UI.mistHeld = 0; UI.mistGen++;
  hideToast(); hideDeadEnd(); FX.clear();
  renderAll(); refresh();
}
export function showToast() {
  if (!S.solved) return;
  /* --- level0 --- */ if (toastHooks.before && toastHooks.before()) return; /* --- end level0 --- */
  if (S.mode === 'spot') {
    toastTitle.textContent = 'Spotted it';
    toastMsg.textContent = S.spot.found ? S.spot.found.text : '';
    againLbl.textContent = 'Next';
  } else {
    toastTitle.textContent = 'Solved';
    toastMsg.textContent = S.mistakes === 0 ? 'Clean solve — no mistakes.' : `${S.mistakes} mistake${S.mistakes === 1 ? '' : 's'} along the way.`;
    againLbl.textContent = 'Play again';
  }
  toastEl.classList.add('show');
  /* --- level0 --- */ if (toastHooks.after) toastHooks.after(); /* --- end level0 --- */
}
export function hideToast() { toastEl.classList.remove('show'); }
