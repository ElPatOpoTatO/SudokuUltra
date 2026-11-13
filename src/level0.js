// level0.js — the Level 0 engine: plays a scripted, guided board (format and
// validator in level0-script.js, reference in docs/level0.md).
//
// Level 0 is never a pop-up. The board stays playable; a coach line under the
// board says what to do, everything but the focus is dimmed (opacity only),
// the target is outlined, and the player DOES the move with the normal input
// system (same keycaps, sounds, particles). How it hooks in:
//   - input.js asks inputGuard.fn(action) before any input changes state. The
//     engine judges the action against the current step: 'ok' (it is the
//     move), 'neutral' (selecting, loading a digit, toggling Pencil while
//     getting there) or wrong. Wrong actions are blocked (blocked sound + a
//     gentle nudge in the coach line): never a mistake.
//   - 3 wrong tries in a row on a step -> "show me": the engine performs the
//     move slowly with the real actions (select ring, key press, placement
//     spark / note stroke / erase rub), puts the board back, and the player
//     repeats it.
//   - board.js hooks.afterRefresh tells the engine to check whether the step
//     is done (after the placement is released). Done -> soft rising tick
//     (sfx.noteTick, climbs with the step number), next step.
//   - S.mode is 'l0': no mistakes, no dead end; finishing the board runs the
//     normal solve cascade, and actions.js toastHooks.before shows the outro in
//     the coach instead of the toast.
import { $, div, reducedMotion } from './util.js';
import { sfx } from './audio.js';
import { S } from './state.js';
import { cells, renderCell, refresh, markGivens, animReach, animNoteIn, animPing, hooks } from './board.js';
import { digitKeys, keys, makeKey } from './pad.js';
import { FX } from './particles.js';
import {
  resetGame, placeProvisional, finalizePending, toggleNote, clearCell, togglePencil, toastHooks
} from './actions.js';
import { inputGuard, bindPress, cancelAllPresses } from './input.js';
import { flushSave } from './token.js';
import { gameHooks, updatePid } from './game.js';
import { parseGrid, computeCands, allSteps, peers as PEER_LIST } from './solver.js';
import { ALLOW } from './shared.js';
import {
  validateScript, expectType, focusCells, focusUnitCells, highlightCells, dimMode, hasShow,
  startNotes, scriptSolution
} from './level0-script.js';
import { SCRIPTS } from './level0-data.js';

const appEl = $('app'), coachEl = $('coach');
const bit = d => 1 << (d - 1);
const KEY_NAMES = { pencil: 'Pencil', erase: 'Erase', undo: 'Undo' };

/* engine state (one script at a time) */
const L = {
  active: false, script: null, opts: {}, k: 0,
  wrong: 0,            // wrong tries in a row on this step
  demo: false,         // "show me" running
  advancing: false,    // step done, next step not shown yet
  done: false,         // outro reached
  tapped: new Set(), pressed: false, starting: false,
  shows: 0, nudges: 0, // counters for tests
  timers: new Set(), nudgeTimer: 0, checkQueued: false
};
const step = () => L.script.steps[L.k];
function later(fn, ms) {
  const t = setTimeout(() => { L.timers.delete(t); fn(); }, ms);
  L.timers.add(t);
  return t;
}
const pace = ms => (reducedMotion() ? ms * 0.6 : ms) | 0;

/* ---- coach DOM ------------------------------------------------------- */
let dotsEl, sayEl, gotKey, skipKey, gotLbl;
function buildCoach() {
  coachEl.textContent = '';
  dotsEl = div('cdots', coachEl);
  sayEl = document.createElement('p'); sayEl.className = 'csay'; coachEl.appendChild(sayEl);
  const ck = div('ckeys', coachEl);
  gotKey = makeKey('mod ck', '<span class="lbl">Got it</span>', ck);
  gotKey.setAttribute('aria-label', 'Got it');
  gotLbl = gotKey.querySelector('.lbl');
  skipKey = makeKey('mod ck skip', '<span class="lbl">Skip</span>', ck);
  skipKey.setAttribute('aria-label', 'Skip Level 0');
  bindPress(gotKey, onGot);
  bindPress(skipKey, onSkip);
}
function setText(text, cls = '') {
  sayEl.textContent = text;
  sayEl.className = 'csay' + (cls ? ' ' + cls : '');
  sayEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reducedMotion() ? 90 : 160, easing: 'ease-out' });
}
function renderDots() {
  const n = L.script.steps.length;
  if (dotsEl.childElementCount !== n) { dotsEl.textContent = ''; for (let k = 0; k < n; k++) div('dot', dotsEl); }
  [...dotsEl.children].forEach((d, k) => {
    d.classList.toggle('done', L.done || k < L.k || (k === L.k && L.advancing));
    d.classList.toggle('cur', !L.done && k === L.k);
  });
}
function showKeys() {
  const st = step();
  const got = L.done || (st && expectType(st) === 'continue');
  gotLbl.textContent = L.done ? (L.opts.onNext ? 'Next' : 'Again') : 'Got it';
  gotKey.classList.toggle('show', !!got);
  skipKey.classList.toggle('show', !!L.opts.canSkip && !L.done);
  coachEl.classList.toggle('keys', !!got || (!!L.opts.canSkip && !L.done));
}

/* ---- focus / dim / highlight ----------------------------------------- */
function ensureOverlays() {
  for (let i = 0; i < 81; i++) if (!cells[i].l0d) cells[i].l0d = div('l0d', cells[i].el);
}
function relevantKeys(st) {
  const t = expectType(st), e = st.expect, hd = st.highlight && st.highlight.digits;
  const digits = new Set(), mods = new Set(), ring = new Set(hd || []), ringMods = new Set();
  const all = () => { for (let d = 1; d <= 9; d++) digits.add(d); };
  if (t === 'place') all();
  if (t === 'note' || t === 'notes' || t === 'eliminate' || t === 'loadDigit') { if (hd) hd.forEach(d => digits.add(d)); else all(); }
  if (t === 'fill') all();                                       /* step6 */
  if (t === 'note' || t === 'notes') mods.add('pencil');
  if (t === 'eliminate') { mods.add('pencil'); mods.add('erase'); }
  if (t === 'press') { mods.add(e.press); ringMods.add(e.press); }
  return { digits, mods, ring, ringMods };
}
function applyVisuals(st) {
  const dim = !L.done && st && dimMode(st) === 'all-but';
  const focus = new Set(st && !L.done ? focusCells(st) : []);
  const unit = new Set(st && !L.done ? focusUnitCells(st) : []);
  const hl = new Set(st && !L.done ? highlightCells(st) : []);
  for (let i = 0; i < 81; i++) {
    const cl = cells[i].el.classList;
    cl.toggle('l0-dim', dim && !focus.has(i));
    cl.toggle('l0-f', unit.has(i));
    cl.toggle('l0-hl', hl.has(i));
  }
  const r = st && !L.done ? relevantKeys(st) : { digits: new Set(), mods: new Set(), ring: new Set(), ringMods: new Set() };
  for (let d = 1; d <= 9; d++) {
    const cl = digitKeys[d].el.classList;
    cl.toggle('l0-dim', dim && !r.digits.has(d));
    cl.toggle('l0-hk', r.ring.has(d));
  }
  for (const m of ['pencil', 'erase', 'undo']) {
    keys[m].classList.toggle('l0-dim', dim && !r.mods.has(m));
    keys[m].classList.toggle('l0-hk', r.ringMods.has(m));
  }
}
function clearVisuals() {
  for (let i = 0; i < 81; i++) cells[i].el.classList.remove('l0-dim', 'l0-f', 'l0-hl');
  for (let d = 1; d <= 9; d++) digitKeys[d].el.classList.remove('l0-dim', 'l0-hk');
  for (const m of ['pencil', 'erase', 'undo']) keys[m].classList.remove('l0-dim', 'l0-hk');
}
/* the eye goes to the target: the outlined cells (or keys) ping once */
function pingTargets(st) {
  const hl = highlightCells(st);
  hl.forEach((i, k) => animPing(i, k * 40, .6));
  if (!hl.length && expectType(st) === 'press') keyPing(keys[st.expect.press]);
}
function keyPing(el) {
  el.animate([{ opacity: 1 }, { opacity: .55, offset: .3 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
}

/* ---- steps ------------------------------------------------------------ */
function enterStep(k) {
  L.k = k; L.wrong = 0; L.tapped.clear(); L.pressed = false;
  const st = step(), prev = L.script.steps[k - 1], prevType = prev && expectType(prev);
  // keep a selection only when it is where this step acts; keep a loaded digit only after loadDigit
  let changed = false;
  if (S.selected >= 0 && !highlightCells(st).includes(S.selected)) { S.selected = -1; changed = true; }
  /* --- step6: a loaded digit also carries into a step that uses only that digit (number-first chains) --- */
  if (S.loaded && prevType !== 'loadDigit' && !usesOnly(st, S.loaded)) { S.loaded = 0; S.loadedNote = false; changed = true; }
  /* --- end step6 --- */
  if (changed) refresh();
  clearTimeout(L.nudgeTimer);
  setText(st.say);
  renderDots(); showKeys(); applyVisuals(st);
}
/* --- step6 --- */
function usesOnly(st, d) {
  const e = st.expect;
  if (e.place) return e.place.digit === d;
  if (e.note) return e.note.digit === d;
  if (e.eliminate) return e.eliminate.every(x => x[1] === d);
  return false;
}
/* --- end step6 --- */
function stepComplete(st) {
  const e = st.expect;
  switch (expectType(st)) {
    case 'tap': return e.mode === 'all' ? e.tap.every(c => L.tapped.has(c)) : L.tapped.has(S.selected);
    case 'place': return S.values[e.place.cell] === e.place.digit;
    case 'note': return !S.values[e.note.cell] && !!(S.notes[e.note.cell] & bit(e.note.digit));
    /* --- step6 --- */
    case 'notes': return !S.values[e.notes.cell] && e.notes.digits.every(d => S.notes[e.notes.cell] & bit(d));
    case 'fill': return e.fill.every(c => S.values[c] === S.sol[c]);
    /* --- end step6 --- */
    case 'eliminate': return e.eliminate.every(([c, d]) => !(S.notes[c] & bit(d)));
    case 'loadDigit': return S.loaded === e.loadDigit;
    default: return L.pressed;            // press, continue
  }
}
function queueCheck() {
  if (L.checkQueued) return;
  L.checkQueued = true;
  later(() => { L.checkQueued = false; check(); }, 0);
}
function check() {
  if (!L.active || L.demo || L.advancing || L.done || S.pending) return;
  if (stepComplete(step())) stepDone();
}
function stepDone() {
  const st = step(), last = L.k === L.script.steps.length - 1;
  L.advancing = true;
  clearTimeout(L.nudgeTimer);
  renderDots();
  if (!(last && S.solved)) sfx.noteTick(0.09, L.k);   // soft, climbs the ladder step by step
  const t = expectType(st), fast = t === 'place' && L.script.steps[L.k + 1] && expectType(L.script.steps[L.k + 1]) === 'place';
  later(() => {
    L.advancing = false;
    if (last) finish(); else enterStep(L.k + 1);
  }, last ? 0 : pace(fast ? 300 : 420));
}
function finish() {
  // a complete board runs the normal solve cascade; its toast becomes the outro (toastHooks.before)
  if (!S.solved) showOutro();
  else { applyVisuals(null); renderDots(); }   // input is already closed (S.solved)
}
function showOutro() {
  L.done = true; S.solved = true;
  S.selected = -1; S.loaded = 0; S.loadedNote = false;
  clearTimeout(L.nudgeTimer);
  setText(L.script.outro, 'outro');
  applyVisuals(null); renderDots(); showKeys(); refresh();
  if (L.opts.onDone) L.opts.onDone();
}

/* ---- judging an input action ------------------------------------------ */
const NEUTRAL_MOVES = ['select', 'deselect', 'load', 'unload', 'loadNote'];
function judge(st, a) {
  const t = expectType(st), e = st.expect;
  const isPencil = a.type === 'press' && a.key === 'pencil';
  switch (t) {
    case 'continue':
      return { r: 'wrong', count: false, text: 'Tap Got it when you’re ready.' };
    case 'tap':
      if (a.type === 'select' && e.tap.includes(a.cell)) return { r: 'ok' };
      if (a.type === 'deselect') return { r: 'neutral' };
      return { r: 'wrong', text: st.nudge || 'Tap the outlined cell.' };
    case 'place': {
      const { cell, digit } = e.place;
      if (NEUTRAL_MOVES.includes(a.type) || isPencil) return { r: 'neutral' };
      if (a.type === 'place' && a.cell === cell && a.digit === digit) return { r: 'ok' };
      if (a.type === 'convert') return { r: 'wrong', count: false, silent: true };
      if (a.type === 'note') return { r: 'wrong', text: 'Pencil is on, so that would be a note. Tap Pencil to write answers.' };
      /* --- step6: several outlined cells (or none): say why that cell is out --- */
      if (a.type === 'place' && a.cell !== cell) {
        const hl = highlightCells(st);
        if (hl.length === 1 && hl[0] === cell) return { r: 'wrong', text: 'Use the outlined cell.' };
        return { r: 'wrong', text: seenText(a.cell, a.digit) || st.nudge || 'Not that cell. Look again.' };
      }
      /* --- end step6 --- */
      return { r: 'wrong', text: st.nudge || 'Not that one. Which number is missing?' };
    }
    /* --- step6 --- */
    case 'notes': {
      const { cell, digits } = e.notes;
      if (NEUTRAL_MOVES.includes(a.type) || isPencil) return { r: 'neutral' };
      if (a.type === 'note' && a.cell === cell && digits.includes(a.digit)) return { r: a.on ? 'ok' : 'neutral' };
      if (a.type === 'convert' && a.cell === cell && digits.includes(a.digit)) return { r: 'ok' };
      if (a.type === 'place' && !S.pencil) return { r: 'wrong', text: 'Turn Pencil on first, then write the notes.' };
      if ((a.type === 'note' || a.type === 'place') && a.cell !== cell) return { r: 'wrong', text: 'Use the outlined cell.' };
      if (a.type === 'note' || a.type === 'convert') return { r: 'wrong', text: seenText(cell, a.digit) || st.nudge || 'That one can’t go here.' };
      return { r: 'wrong', text: st.nudge || 'Write the numbers this cell can still be.' };
    }
    case 'fill': {
      if (NEUTRAL_MOVES.includes(a.type) || isPencil) return { r: 'neutral' };
      if (a.type === 'place' && e.fill.includes(a.cell) && a.digit === S.sol[a.cell]) return { r: 'ok' };
      if (a.type === 'convert') return { r: 'wrong', count: false, silent: true };
      if (a.type === 'note') return { r: 'neutral' };            // the player's own notes are fine here
      if (a.type === 'place' && !e.fill.includes(a.cell)) return { r: 'wrong', text: 'Use one of the outlined cells.' };
      if (a.type === 'place') return { r: 'wrong', text: seenText(a.cell, a.digit) || st.nudge || 'Not that one. Look at its notes.' };
      return { r: 'wrong', text: st.nudge || 'Fill the outlined cells.' };
    }
    /* --- end step6 --- */
    case 'note': {
      const { cell, digit } = e.note;
      if (NEUTRAL_MOVES.includes(a.type) || isPencil) return { r: 'neutral' };
      if (a.type === 'note' && a.on && a.cell === cell && a.digit === digit) return { r: 'ok' };
      if (a.type === 'convert' && a.cell === cell && a.digit === digit) return { r: 'ok' };
      if (a.type === 'place' && !S.pencil) return { r: 'wrong', text: `Turn Pencil on first, then press ${digit}.` };
      if ((a.type === 'note' || a.type === 'place') && a.cell !== cell) return { r: 'wrong', text: 'Use the outlined cell.' };
      return { r: 'wrong', text: st.nudge || `Write a small ${digit} in the outlined cell.` };
    }
    case 'eliminate': {
      const left = e.eliminate.filter(([c, d]) => S.notes[c] & bit(d));
      if (NEUTRAL_MOVES.includes(a.type) || isPencil) return { r: 'neutral' };
      if (a.type === 'note' && !a.on && left.some(([c, d]) => c === a.cell && d === a.digit)) return { r: 'ok' };
      /* --- step6 --- */ if (a.type === 'place' && !S.pencil && left.some(([c, d]) => c === a.cell && d === a.digit)) return { r: 'wrong', text: `Turn Pencil on first, then press ${a.digit} to rub it out.` }; /* --- end step6 --- */
      if (a.type === 'press' && a.key === 'erase') {
        const c = a.cell, mine = left.filter(x => x[0] === c);
        if (c >= 0 && !S.values[c] && mine.length && mine.reduce((m, x) => m | bit(x[1]), 0) === S.notes[c]) return { r: 'ok' };
        if (c < 0) return { r: 'wrong', text: 'Select the outlined cell first.' };
      }
      return { r: 'wrong', text: st.nudge || 'Rub out the outlined note.' };
    }
    case 'loadDigit':
      if (a.type === 'load' && a.digit === e.loadDigit) return { r: 'ok' };
      if (a.type === 'unload' || isPencil) return { r: 'neutral' };
      if (a.type === 'select' || a.type === 'deselect') return { r: 'wrong', text: `Press ${e.loadDigit} first, before any cell.` };
      return { r: 'wrong', text: st.nudge || `Press the ${e.loadDigit} key.` };
    case 'press':
      if (a.type === 'press' && a.key === e.press) return { r: 'ok' };
      if (NEUTRAL_MOVES.includes(a.type)) return { r: 'neutral' };
      return { r: 'wrong', text: st.nudge || `Tap ${KEY_NAMES[e.press]}.` };
  }
  return { r: 'neutral' };
}

/* --- step6: "This row already has a 6." for a digit a peer already holds --- */
function seenText(cell, d) {
  const r = (cell / 9) | 0, c = cell % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
  for (const j of PEER_LIST[cell]) {
    if (S.values[j] !== d) continue;
    const jr = (j / 9) | 0, jc = j % 9;
    const where = jr === r ? 'row' : jc === c ? 'column' : 'box';
    return `This ${where} already has a ${d}.`;
  }
  return '';
}
/* --- end step6 --- */
function guard(a) {
  if (!L.active) return true;
  if (L.done) return false;
  if (L.demo) { if (a.type !== 'convert') sfx.blocked(); return false; }
  if (L.advancing) {
    if (a.type === 'select' || a.type === 'deselect') return true;
    if (a.type !== 'convert') sfx.blocked();
    return false;
  }
  const st = step(), j = judge(st, a);
  if (j.r === 'ok') {
    const t = expectType(st);
    if (t === 'tap') L.tapped.add(a.cell);
    if (t === 'press') L.pressed = true;
    L.wrong = 0;
    queueCheck();
    return true;
  }
  if (j.r === 'neutral') return true;
  if (!j.silent) wrong(st, j.text, j.count !== false);
  return false;
}
function wrong(st, text, counted) {
  sfx.blocked();
  L.nudges++;
  if (counted) L.wrong++;
  if (counted && L.wrong >= 3 && hasShow(st)) {
    L.demo = true;                       // input waits from now on; the demo starts after the nudge is read
    clearTimeout(L.nudgeTimer);
    setText(text, 'nudge');
    later(showMe, pace(650));
    return;
  }
  setText(text, 'nudge');
  pingTargets(st);
  clearTimeout(L.nudgeTimer);
  L.nudgeTimer = later(() => { if (L.active && !L.demo && !L.done && step() === st) setText(st.say); }, 3400);
}

/* ---- "show me": perform the move slowly with the real actions, then undo it */
function keyTap(el, sound) {
  el.classList.add('down');
  if (sound) sound();
  later(() => { el.classList.remove('down'); sfx.release(); }, 140);
}
function demoSelect(c) {
  S.selected = c; S.loaded = 0; S.loadedNote = false;
  sfx.select(); refresh();
  animReach(c); FX.ring(c, null, null);
}
function showMe() {
  if (!L.active || L.done) return;
  const st = step(), t = expectType(st), e = st.expect;
  cancelAllPresses();
  L.demo = true; L.wrong = 0; L.shows++;
  clearTimeout(L.nudgeTimer);
  setText('Watch.', 'demo');
  const snap = { v: S.values.slice(), n: S.notes.slice(), undo: S.undo.length, pencil: S.pencil };
  S.mode = 'l0demo';                     // a demo placement never "solves" the board
  if (S.selected >= 0 || S.loaded) { S.selected = -1; S.loaded = 0; S.loadedNote = false; refresh(); }
  const seq = [];                        // [ms, fn]
  let at = 350;
  const add = (gap, fn) => { at += gap; seq.push([at, fn]); };
  const pencilTo = on => { if (S.pencil !== on) add(500, () => keyTap(keys.pencil, () => togglePencil())); };
  if (t === 'tap') {
    add(0, () => demoSelect(e.tap[0]));
    add(1100, () => { S.selected = -1; sfx.select(); refresh(); });
  } else if (t === 'place') {
    const { cell, digit } = e.place;
    pencilTo(false);
    add(0, () => demoSelect(cell));
    add(800, () => keyTap(digitKeys[digit].el, () => { sfx.pen(); placeProvisional(cell, digit, 'l0demo'); }));
    add(140, () => finalizePending());
    add(1100, () => { S.selected = cell; refresh(); keyTap(keys.erase, () => { sfx.mod(); clearCell(cell); }); });
  } else if (t === 'note') {
    const { cell, digit } = e.note;
    pencilTo(true);
    add(0, () => demoSelect(cell));
    add(800, () => keyTap(digitKeys[digit].el, () => { if (toggleNote(cell, digit)) sfx.pencil(); }));
    add(1200, () => keyTap(digitKeys[digit].el, () => { if (toggleNote(cell, digit)) sfx.pencil(); }));
  } else if (t === 'eliminate') {
    const byCell = new Map();
    for (const [c, d] of e.eliminate) if (S.notes[c] & bit(d)) (byCell.get(c) || byCell.set(c, []).get(c)).push(d);
    for (const [c, ds] of byCell) {
      add(0, () => demoSelect(c));
      if (ds.reduce((m, d) => m | bit(d), 0) === S.notes[c]) add(800, () => keyTap(keys.erase, () => { sfx.mod(); clearCell(c); }));
      else {
        pencilTo(true);
        ds.forEach((d, k) => add(k ? 450 : 800, () => keyTap(digitKeys[d].el, () => { if (toggleNote(c, d)) sfx.pencil(); })));
      }
      add(700, () => {});
    }
  /* --- step6 --- */
  } else if (t === 'notes') {
    const { cell, digits } = e.notes, todo = digits.filter(d => !(S.notes[cell] & bit(d)));
    pencilTo(true);
    add(0, () => demoSelect(cell));
    todo.forEach((d, k) => add(k ? 450 : 800, () => keyTap(digitKeys[d].el, () => { if (toggleNote(cell, d)) sfx.pencil(); })));
    add(1100, () => {});
  } else if (t === 'fill') {
    // play the next cell that follows from the board (endShow puts it back)
    const c = nextFillCell(e.fill);
    if (c >= 0) {
      pencilTo(false);
      add(0, () => demoSelect(c));
      add(800, () => keyTap(digitKeys[S.sol[c]].el, () => { sfx.pen(); placeProvisional(c, S.sol[c], 'l0demo'); }));
      add(140, () => finalizePending());
      add(1100, () => { S.selected = c; refresh(); keyTap(keys.erase, () => { sfx.mod(); clearCell(c); }); });
    }
  /* --- end step6 --- */
  } else if (t === 'loadDigit') {
    const d = e.loadDigit;
    add(0, () => keyTap(digitKeys[d].el, () => { S.loaded = d; S.loadedNote = false; S.selected = -1; S.pencil ? sfx.pencil() : sfx.pen(); refresh(); FX.loadPulse(d); }));
    add(1200, () => { S.loaded = 0; S.pencil ? sfx.pencil() : sfx.pen(); refresh(); });
  } else if (t === 'press') {
    const el = keys[e.press];
    if (e.press === 'pencil') {
      add(0, () => keyTap(el, () => togglePencil()));
      add(1100, () => keyTap(el, () => togglePencil()));
    } else add(0, () => keyTap(el, () => { sfx.mod(); keyPing(el); }));
  }
  add(900, () => endShow(st, snap));
  for (const [ms, fn] of seq) later(() => { if (L.active && L.demo) fn(); }, pace(ms));
}
/* --- step6: the first listed empty cell the solver can fill right now (else the first empty one) --- */
function nextFillCell(list) {
  const left = list.filter(c => !S.values[c]);
  if (!left.length) return -1;
  const cands = computeCands(S.values);
  if (L.script.showCands) for (let i = 0; i < 81; i++) if (!S.values[i] && S.notes[i]) cands[i] &= S.notes[i];
  for (const s of allSteps(S.values, cands, ALLOW[S.world])) if (s.place && left.includes(s.place.cell) && s.place.digit === S.sol[s.place.cell]) return s.place.cell;
  return left[0];
}
/* --- end step6 --- */
function endShow(st, snap) {
  // put the board back exactly as it was before the demo (notes that return are drawn back in)
  for (let i = 0; i < 81; i++) {
    const shown = S.values[i] ? 0 : S.notes[i], back = snap.v[i] ? 0 : snap.n[i] & ~shown;
    if (S.values[i] !== snap.v[i] || S.notes[i] !== snap.n[i]) {
      S.values[i] = snap.v[i]; S.notes[i] = snap.n[i];
      renderCell(i);
      for (let d = 1; d <= 9; d++) if (back & bit(d)) animNoteIn(cells[i].n[d - 1]);
    }
  }
  S.undo.length = Math.min(S.undo.length, snap.undo);
  S.mode = 'l0'; S.solved = false; S.pending = null;
  S.selected = -1; S.loaded = 0; S.loadedNote = false;
  // the demo may have switched Pencil; leave it where this step needs it (note/eliminate: on)
  const t = expectType(st);
  if (t === 'press' && st.expect.press === 'pencil') { if (S.pencil !== snap.pencil) togglePencil(); }
  /* --- step6: a fill demo leaves Pencil off, as the step needs --- */
  if (t === 'fill' && S.pencil) togglePencil();
  /* --- end step6 --- */
  refresh();
  L.demo = false; L.wrong = 0;
  setText(st.say, '');
  pingTargets(st);
}

/* ---- coach keys --------------------------------------------------------- */
function onGot() {
  sfx.mod();
  if (!L.active) return;
  if (L.done) {
    if (L.opts.onNext) L.opts.onNext();
    else startLevel0(L.script, L.opts);
    return;
  }
  if (L.demo || L.advancing) return;
  if (expectType(step()) === 'continue') { L.pressed = true; check(); }
}
function onSkip() {
  sfx.mod();
  if (!L.active || !L.opts.canSkip) return;
  const next = L.opts.onSkip || L.opts.onNext;
  if (next) next();
}

/* ---- public ------------------------------------------------------------- */
/** Start a script. opts: { onNext(), onDone(), onSkip(), canSkip } */
export function startLevel0(script, opts = {}) {
  const v = validateScript(script);
  if (!v.ok) { console.error('level0: invalid script ' + (script && script.id) + ':\n  ' + v.errors.join('\n  ')); return false; }
  cancelAllPresses();
  L.starting = true;
  try { for (const f of gameHooks.start) f(script.id); } finally { L.starting = false; }
  if (S.id && S.id !== script.id) flushSave();
  stopTimers();
  const values = Int8Array.from(parseGrid(script.board));
  S.id = script.id; S.mode = 'l0'; S.kind = 'level0'; S.world = script.world;
  S.given.set(values); S.sol.set(scriptSolution(script.board)); S.startNotes.set(startNotes(script, values));
  S.spot = null;
  markGivens();
  resetGame();
  Object.assign(L, { active: true, script, opts, k: 0, wrong: 0, demo: false, advancing: false, done: false, shows: 0, nudges: 0 });
  if (!sayEl) buildCoach();
  ensureOverlays();
  appEl.classList.add('l0');
  inputGuard.fn = guard;
  inputGuard.reset = () => { if (!L.active) return false; startLevel0(L.script, L.opts); return true; };
  enterStep(0);
  updatePid();
  return true;
}
function stopTimers() {
  for (const t of L.timers) clearTimeout(t);
  L.timers.clear(); clearTimeout(L.nudgeTimer); L.checkQueued = false;
}
export function stopLevel0() {
  if (!L.active) return;
  stopTimers();
  L.active = false; L.demo = false;
  if (S.mode === 'l0demo') S.mode = 'l0';
  inputGuard.fn = null; inputGuard.reset = null;
  clearVisuals();
  appEl.classList.remove('l0');
}
export const level0Active = () => L.active;
export const level0Scripts = SCRIPTS;

export function initLevel0() {
  const prev = hooks.afterRefresh;
  hooks.afterRefresh = () => { if (prev) prev(); if (L.active) queueCheck(); };
  // any other puzzle starting ends the script
  gameHooks.start.push(() => { if (L.active && !L.starting) stopLevel0(); });
  // the solve cascade's toast becomes the outro
  toastHooks.before = () => {
    if (!L.active || S.mode !== 'l0') return false;
    showOutro();
    return true;
  };
}

/* Test / DEV view of the engine (exposed on window.__debug.L0 with ?debug=1). */
export const L0 = {
  state: () => ({ active: L.active, id: L.script && L.script.id, k: L.k, n: L.script ? L.script.steps.length : 0,
    wrong: L.wrong, demo: L.demo, advancing: L.advancing, done: L.done, shows: L.shows, nudges: L.nudges,
    say: sayEl ? sayEl.textContent : '', sayClass: sayEl ? sayEl.className : '',
    got: !!(gotKey && gotKey.classList.contains('show')), skip: !!(skipKey && skipKey.classList.contains('show')) }),
  step: () => (L.script ? step() : null),
  validate: validateScript, scripts: SCRIPTS, start: startLevel0, stop: stopLevel0
};
