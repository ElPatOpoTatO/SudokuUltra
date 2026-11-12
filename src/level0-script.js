// level0-script.js — Level 0 script format: schema check, validator, and the
// small pure helpers the engine (level0.js) shares with it. No DOM, so the
// same file runs in the browser bundle, in tools/build.mjs and in
// tools/validate-level0.mjs. Format reference: docs/level0.md.
//
// A script is data:
//   { id, world, title, board, showCands?, steps: [ step… ], outro }
//   step = { say, focus?, dim?, highlight?, expect, nudge?, show? }
//   expect = exactly one of
//     {tap: [cells], mode?: 'any'|'all'}   {place: {cell, digit}}
//     {note: {cell, digit}}                {eliminate: [[cell, digit], …]}
//     {loadDigit: d}                       {press: 'pencil'|'erase'|'undo'}
//     {continue: true}
// validateScript() rejects unknown fields and simulates the whole script on
// the board: every expected action must be legal at its step (placements must
// match the unique solution AND be found by the solver with the techniques of
// worlds 0..script.world; notes need Pencil on; erased notes must not be the
// cell's answer; …).
import {
  parseGrid, computeCands, findConflicts, countSolutions, findSolution,
  allSteps, ROWS, COLS, BOXES, peers, bit
} from './solver.js';
import { ALLOW } from './shared.js';

export const EXPECT_TYPES = ['tap', 'place', 'note', 'eliminate', 'loadDigit', 'press', 'continue'];
export const PRESS_KEYS = ['pencil', 'erase', 'undo'];
const TOP_KEYS = ['id', 'world', 'title', 'board', 'showCands', 'steps', 'outro'];
const STEP_KEYS = ['say', 'focus', 'dim', 'highlight', 'expect', 'nudge', 'show'];
const FOCUS_KEYS = ['cells', 'row', 'col', 'box'];
const HL_KEYS = ['cells', 'digits'];
export const SAY_MAX = 140;          // characters (warning above this)

const isCell = (c) => Number.isInteger(c) && c >= 0 && c < 81;
const isDigit = (d) => Number.isInteger(d) && d >= 1 && d <= 9;
const isIdx = (n) => Number.isInteger(n) && n >= 0 && n < 9;
const name = (i) => `r${((i / 9) | 0) + 1}c${(i % 9) + 1}`;

/** The expect type of a step ('place', 'tap', …). */
export const expectType = (step) => EXPECT_TYPES.find((t) => step.expect && t in step.expect);

/** Cells a step focuses (undimmed): focus.cells/row/col/box, else highlight.cells, else the expect's cells. */
export function focusCells(step) {
  const f = step.focus || {}, out = new Set();
  (f.cells || []).forEach((c) => out.add(c));
  if (f.row != null) ROWS[f.row].forEach((c) => out.add(c));
  if (f.col != null) COLS[f.col].forEach((c) => out.add(c));
  if (f.box != null) BOXES[f.box].forEach((c) => out.add(c));
  if (!out.size) (highlightCells(step)).forEach((c) => out.add(c));
  return [...out];
}
/** Unit cells of the focus (these get the unit tint). */
export function focusUnitCells(step) {
  const f = step.focus || {}, out = new Set();
  if (f.row != null) ROWS[f.row].forEach((c) => out.add(c));
  if (f.col != null) COLS[f.col].forEach((c) => out.add(c));
  if (f.box != null) BOXES[f.box].forEach((c) => out.add(c));
  return [...out];
}
/** Cells to outline: highlight.cells, else the cells the expect acts on. */
export function highlightCells(step) {
  if (step.highlight && step.highlight.cells) return step.highlight.cells.slice();
  return expectCells(step);
}
export function expectCells(step) {
  const e = step.expect || {};
  if (e.tap) return e.tap.slice();
  if (e.place) return [e.place.cell];
  if (e.note) return [e.note.cell];
  if (e.eliminate) return [...new Set(e.eliminate.map((x) => x[0]))];
  return [];
}
/** dim mode: explicit, else 'all-but' when there is something to focus, else 'none'. */
export function dimMode(step) {
  if (step.dim) return step.dim;
  const t = expectType(step);
  return focusCells(step).length || t === 'press' ? 'all-but' : 'none';
}
/** Does this step have a "show me" demo? (continue never; show:false opts out) */
export const hasShow = (step) => step.show !== false && expectType(step) !== 'continue';

/* ---------------------------------------------------------------------------
   Schema (unknown fields are errors)
   --------------------------------------------------------------------------- */
function checkKeys(obj, allowed, where, errors) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errors.push(`${where}: must be an object`); return false; }
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}: unknown field "${k}"`);
  return true;
}
function checkText(v, where, errors, warnings, required = true) {
  if (v == null) { if (required) errors.push(`${where}: missing`); return; }
  if (typeof v !== 'string' || !v.trim()) { errors.push(`${where}: must be a non-empty string`); return; }
  if (warnings) {
    if (v.length > SAY_MAX) warnings.push(`${where}: ${v.length} characters (keep it under ${SAY_MAX})`);
    const sentences = v.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length;
    if (sentences > 2) warnings.push(`${where}: ${sentences} sentences (keep it to 2)`);
  }
}
function checkCells(v, where, errors) {
  if (!Array.isArray(v) || !v.length || !v.every(isCell)) errors.push(`${where}: must be a non-empty array of cells 0-80`);
}
function checkCellDigit(v, where, errors) {
  if (!checkKeys(v, ['cell', 'digit'], where, errors)) return;
  if (!isCell(v.cell)) errors.push(`${where}.cell: must be a cell 0-80`);
  if (!isDigit(v.digit)) errors.push(`${where}.digit: must be a digit 1-9`);
}

function checkSchema(s, errors, warnings) {
  if (!checkKeys(s, TOP_KEYS, 'script', errors)) return;
  if (typeof s.id !== 'string' || !/^w\d+-l0$/.test(s.id)) errors.push('id: must look like "w0-l0"');
  if (!Number.isInteger(s.world) || !ALLOW[s.world]) errors.push(`world: must be 0-${ALLOW.length - 1}`);
  else if (typeof s.id === 'string' && s.id !== `w${s.world}-l0`) errors.push(`id: must be "w${s.world}-l0" for world ${s.world}`);
  checkText(s.title, 'title', errors);
  if (typeof s.board !== 'string' || !/^[0-9]{81}$/.test(s.board)) errors.push('board: must be 81 digits (0 = empty)');
  if (s.showCands != null && s.showCands !== true && s.showCands !== false && s.showCands !== 'computed') errors.push('showCands: must be true, false or "computed"');
  checkText(s.outro, 'outro', errors, warnings);
  if (!Array.isArray(s.steps) || !s.steps.length) { errors.push('steps: must be a non-empty array'); return; }
  if (s.steps.length > 30) errors.push('steps: at most 30');
  s.steps.forEach((st, k) => {
    const w = `steps[${k}]`;
    if (!checkKeys(st, STEP_KEYS, w, errors)) return;
    checkText(st.say, `${w}.say`, errors, warnings);
    checkText(st.nudge, `${w}.nudge`, errors, warnings, false);
    if (st.show != null && typeof st.show !== 'boolean') errors.push(`${w}.show: must be true or false`);
    if (st.dim != null && st.dim !== 'all-but' && st.dim !== 'none') errors.push(`${w}.dim: must be "all-but" or "none"`);
    if (st.focus != null && checkKeys(st.focus, FOCUS_KEYS, `${w}.focus`, errors)) {
      if (st.focus.cells != null) checkCells(st.focus.cells, `${w}.focus.cells`, errors);
      for (const u of ['row', 'col', 'box']) if (st.focus[u] != null && !isIdx(st.focus[u])) errors.push(`${w}.focus.${u}: must be 0-8`);
      if (!Object.keys(st.focus).length) errors.push(`${w}.focus: empty`);
    }
    if (st.highlight != null && checkKeys(st.highlight, HL_KEYS, `${w}.highlight`, errors)) {
      if (st.highlight.cells != null) checkCells(st.highlight.cells, `${w}.highlight.cells`, errors);
      if (st.highlight.digits != null && (!Array.isArray(st.highlight.digits) || !st.highlight.digits.length || !st.highlight.digits.every(isDigit)))
        errors.push(`${w}.highlight.digits: must be a non-empty array of digits 1-9`);
    }
    const e = st.expect, we = `${w}.expect`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${we}: missing`); return; }
    const types = Object.keys(e).filter((x) => EXPECT_TYPES.includes(x));
    for (const x of Object.keys(e)) if (!EXPECT_TYPES.includes(x) && x !== 'mode') errors.push(`${we}: unknown field "${x}"`);
    if (types.length !== 1) { errors.push(`${we}: needs exactly one of ${EXPECT_TYPES.join(', ')} (got ${types.length})`); return; }
    const t = types[0];
    if ('mode' in e && t !== 'tap') errors.push(`${we}.mode: only allowed with tap`);
    if (t === 'tap') {
      checkCells(e.tap, `${we}.tap`, errors);
      if (e.mode != null && e.mode !== 'any' && e.mode !== 'all') errors.push(`${we}.mode: must be "any" or "all"`);
    } else if (t === 'place' || t === 'note') checkCellDigit(e[t], `${we}.${t}`, errors);
    else if (t === 'eliminate') {
      if (!Array.isArray(e.eliminate) || !e.eliminate.length) errors.push(`${we}.eliminate: must be a non-empty array of [cell, digit]`);
      else e.eliminate.forEach((x, j) => {
        if (!Array.isArray(x) || x.length !== 2 || !isCell(x[0]) || !isDigit(x[1])) errors.push(`${we}.eliminate[${j}]: must be [cell 0-80, digit 1-9]`);
      });
    } else if (t === 'loadDigit') { if (!isDigit(e.loadDigit)) errors.push(`${we}.loadDigit: must be a digit 1-9`); }
    else if (t === 'press') { if (!PRESS_KEYS.includes(e.press)) errors.push(`${we}.press: must be one of ${PRESS_KEYS.join(', ')}`); }
    else if (t === 'continue') { if (e.continue !== true) errors.push(`${we}.continue: must be true`); }
  });
}

/* ---------------------------------------------------------------------------
   Board helpers shared with the engine
   --------------------------------------------------------------------------- */
/** Starting notes for a script board. */
export function startNotes(script, values) {
  return script.showCands ? computeCands(values) : new Uint16Array(81);
}
/** Unique solution of the script board, or null. */
export function scriptSolution(board) {
  const v = parseGrid(board);
  if (countSolutions(v) !== 1) return null;
  return Int8Array.from(findSolution(v));
}

/* ---------------------------------------------------------------------------
   Validation: schema + a full simulation of the script on its board
   --------------------------------------------------------------------------- */
export function validateScript(script) {
  const errors = [], warnings = [];
  checkSchema(script, errors, warnings);
  if (errors.length) return { ok: false, errors, warnings };

  const values = Int8Array.from(parseGrid(script.board));
  if (findConflicts(values).length) return { ok: false, errors: ['board: has conflicts'], warnings };
  const sol = scriptSolution(script.board);
  if (!sol) return { ok: false, errors: ['board: must have exactly one solution'], warnings };
  const notes = startNotes(script, values);
  const allow = ALLOW[script.world];
  const sim = { pencil: false, selected: -1, loaded: 0 };
  const history = [];
  const snap = () => ({ v: values.slice(), n: notes.slice() });
  const count = (d) => values.reduce((n, x) => n + (x === d), 0);

  script.steps.forEach((st, k) => {
    const w = `steps[${k}]`, e = st.expect, t = expectType(st);
    const err = (m) => errors.push(`${w} (${t}): ${m}`);
    for (const c of highlightCells(st)) if (!isCell(c)) err('bad highlight cell');
    if (t === 'tap') {
      sim.selected = e.tap.length === 1 ? e.tap[0] : -2;   // -2: some cell, not known
      sim.loaded = 0;
    } else if (t === 'place') {
      const { cell, digit } = e.place;
      if (sim.pencil) err('Pencil is on here, so a digit would become a note (add a press: "pencil" step first)');
      if (values[cell]) err(`${name(cell)} is not empty`);
      else if (sol[cell] !== digit) err(`${name(cell)} is ${sol[cell]} in the solution, not ${digit}`);
      else if (peers[cell].some((j) => values[j] === digit)) err(`${digit} clashes with a peer of ${name(cell)}`);
      else {
        const cands = computeCands(values);
        let found = null;
        for (const s of allSteps(values, cands, allow)) if (s.place && s.place.cell === cell && s.place.digit === digit) { found = s; break; }
        if (!found) err(`the solver cannot justify ${digit} in ${name(cell)} with the techniques of worlds 0-${script.world} (${allow.join(', ')}) on this board`);
      }
      history.push(snap());
      values[cell] = digit; notes[cell] = 0;
      for (const j of peers[cell]) notes[j] &= ~bit(digit);
      sim.selected = cell;
    } else if (t === 'note') {
      const { cell, digit } = e.note;
      if (!sim.pencil) err('Pencil is off here (add a press: "pencil" step first)');
      if (values[cell]) err(`${name(cell)} is not empty`);
      else if (notes[cell] & bit(digit)) err(`${name(cell)} already has the note ${digit}`);
      else if (peers[cell].some((j) => values[j] === digit)) err(`${digit} is already in a peer of ${name(cell)}, so it is not a candidate`);
      history.push(snap());
      notes[cell] |= bit(digit);
      sim.selected = cell;
    } else if (t === 'eliminate') {
      history.push(snap());
      for (const [cell, digit] of e.eliminate) {
        if (values[cell]) err(`${name(cell)} is not empty`);
        else if (!(notes[cell] & bit(digit))) err(`${name(cell)} has no note ${digit} to erase`);
        else if (sol[cell] === digit) err(`${digit} is the answer of ${name(cell)}; erasing it teaches the wrong thing`);
        notes[cell] &= ~bit(digit);
      }
    } else if (t === 'loadDigit') {
      if (count(e.loadDigit) >= 9) err(`all nine ${e.loadDigit}s are placed, the key is locked`);
      sim.loaded = e.loadDigit; sim.selected = -1;
    } else if (t === 'press') {
      if (e.press === 'pencil') sim.pencil = !sim.pencil;
      else if (e.press === 'erase') {
        const c = sim.selected;
        if (c < 0) err('Erase needs a known selected cell (put a tap/place/note step on one cell first)');
        else {
          const given = parseGrid(script.board)[c];
          if (given) err(`${name(c)} is a given and cannot be erased`);
          else if (!values[c] && !notes[c]) err(`${name(c)} is already empty`);
          history.push(snap());
          values[c] = 0; notes[c] = 0;
        }
      } else if (e.press === 'undo') {
        const h = history.pop();
        if (!h) err('nothing to undo');
        else { values.set(h.v); notes.set(h.n); }
      }
    }
  });
  const complete = values.every((v, i) => v === sol[i]);
  if (!complete) warnings.push('the board is not complete after the last step (no finishing cascade)');
  return { ok: errors.length === 0, errors, warnings, complete, steps: script.steps.length };
}
