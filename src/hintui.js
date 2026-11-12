// hintui.js — the HINT LADDER and CHECK MY THINKING (DOM, effects, sounds).
// Logic lives in hintlogic.js. See docs/hints.md.
//
// Hint ladder: each tap of Hint goes one level deeper on the SAME hint:
//   1 Name it (free) · 2 Where: tint the unit (free) · 3 Show it: pattern +
//   removed candidates / target cell (paid) · 4 Do it: apply + reason (paid).
// Any change of the board (values or notes) resets the ladder.
// Check my thinking: pick cells, then what you think; solver.checkClaim answers.
// Free, never changes the board, never a mistake.
import { $, div, bit, reducedMotion, dist, haptic, rowOf, colOf, boxOf } from './util.js';
import { sfx } from './audio.js';
import { S, UI, hintHooks, pushUndo } from './state.js';
import { boardEl, cells, renderCell, refresh, animNoteIn, animNoteFlick, animPing } from './board.js';
import { makeKey } from './pad.js';
import { FX } from './particles.js';
import { placeProvisional, finalizePending, clearCell, notesRemoved } from './actions.js';
import { bindPress, pressStart, cancelAllPresses } from './input.js';
import { findHint, maxLevel, isPaid, hintUnit, hintText, unlockedFor, claimsFor, runClaim } from './hintlogic.js';
import { cellName } from './solver.js';

const ICON_HINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="m8 11 2 2 4-4"/></svg>';

/** Options. `unlocked`: techniques a hint may use; null = from the puzzle id
    (ALLOW[w] for campaign items, ALLOW[4] for Quick Play / Daily / dev). */
export const hintOpts = { unlocked: null };
export const currentUnlocked = () => hintOpts.unlocked || unlockedFor(S.id);

let app, wrap, bar, coach, ctext, pipsEl, ctEl, keysBar, hdrSlot, hintKey, checkKey, ckBg, ckSheet;
const HL = new Array(81), HX = new Array(81);

/* ---- ladder state ------------------------------------------------------ */
let L = null;             // { h, level, sig, faded }
let seenSig = '', seenId = '', busy = false, fadeTimer = 0;
const sig = () => S.values.join('') + '|' + S.notes.join(',');

/* ---- check mode state -------------------------------------------------- */
const CK = { on: false, cells: [], claim: null, digits: [] };

/* =========================================================================
   COACH TEXT
   ========================================================================= */
function setCoach(html, opts = {}) {
  coach.classList.toggle('show', !!html);
  coach.classList.toggle('ck', !!opts.check);
  coach.classList.toggle('ok', opts.ok === true);
  coach.classList.toggle('no', opts.ok === false);
  ctEl.innerHTML = html || '';
  const lv = opts.level || 0;
  pipsEl.querySelectorAll('i').forEach((p, k) => p.classList.toggle('on', k < lv));
  if (html && !reducedMotion()) ctext.animate([{ opacity: 0, transform: coachShift(4) }, { opacity: 1, transform: coachShift(0) }], { duration: 160, easing: 'ease-out' });
  fitCoach();
}
const coachShift = y => (coach.classList.contains('over') || app.classList.contains('hb-hdr') ? `translateY(${y}px)` : `translateY(calc(-50% + ${y}px))`);
/* Fit the text in the space between board and pad: shrink a little, then
   (still too long) let it grow upward as a bubble over the board's edge. */
function fitCoach() {
  coach.classList.remove('over', 'top'); ctext.style.top = '';
  if (app.classList.contains('hb-hdr')) { ctext.style.fontSize = ''; bar.classList.toggle('top', focusLow()); return; }
  bar.classList.remove('top');
  for (const fs of [12, 11.5, 11, 10.5]) {
    ctext.style.fontSize = fs + 'px';
    if (ctext.scrollHeight <= coach.clientHeight + 1) return;
  }
  ctext.style.fontSize = '';
  coach.classList.add('over');
  // the bubble covers the board's bottom edge: if the hint is about the bottom
  // half, float it at the top of the board instead
  const low = focusLow();
  coach.classList.toggle('top', low);
  ctext.style.top = low ? `${-(wrap.clientHeight - bar.clientHeight) + 3}px` : '';
}
function focusLow() {
  const f = focusCells();
  return f.length > 0 && f.reduce((a, c) => a + rowOf(c), 0) / f.length >= 4.5;
}
function focusCells() {
  const v = visuals(), out = [...v.pattern, ...v.elim.keys()];
  if (v.target >= 0) out.push(v.target);
  if (v.fill >= 0) out.push(v.fill);
  if (!out.length) out.push(...v.unit);
  if (CK.on) out.push(...CK.cells);
  return out;
}

/* =========================================================================
   BOARD VISUALS (derived from the ladder state + check selection)
   ========================================================================= */
function visuals() {
  const v = { unit: new Set(), pattern: new Set(), target: -1, fill: -1, elim: new Map(), keep: new Map() };
  if (L && !L.faded) {
    const { h, level } = L;
    if (h.kind === 'step') {
      const st = h.step;
      if (level >= 2 && level <= 3) hintUnit(h).cells.forEach(c => v.unit.add(c));
      if (level === 3) {
        if (st.place) v.target = st.place.cell;
        else {
          st.pattern.forEach(c => v.pattern.add(c));
          for (const [c, d] of st.eliminate) v.elim.set(c, (v.elim.get(c) || 0) | bit(d));
          // the pattern's own digits, shown in accent in the pattern cells (the "cause")
          for (const c of st.pattern) for (const d of st.digits) if (h.cands[c] & bit(d)) v.keep.set(c, (v.keep.get(c) || 0) | bit(d));
        }
      }
      if (level === 4) {
        if (st.place) v.fill = st.place.cell;
        else st.pattern.forEach(c => v.pattern.add(c));
      }
    } else if (h.kind === 'wrong') {
      if (level === 2 || level === 3) hintUnit(h).cells.forEach(c => v.unit.add(c));
      if (level === 3) v.target = h.cell;
    } else if (h.kind === 'missing') {
      if (level >= 2) v.target = h.cell;
    }
  }
  return v;
}
function paint(anim = null) {
  const v = visuals();
  for (let i = 0; i < 81; i++) {
    let cls = 'hl';
    if (v.unit.has(i)) cls += ' u';
    if (v.pattern.has(i)) cls += ' p';
    if (v.target === i) cls += ' t';
    if (v.fill === i) cls += ' f';
    if (CK.on && CK.cells.includes(i)) cls += ' ck';
    if (HL[i].className !== cls) HL[i].className = cls;
    const m = v.elim.get(i) || 0, kp = v.keep.get(i) || 0;
    for (let d = 1; d <= 9; d++) {
      const on = !!(m & bit(d)), keep = !on && !!(kp & bit(d)), sp = HX[i].children[d - 1];
      sp.classList.toggle('on', on);
      sp.classList.toggle('keep', keep);
      cells[i].n[d - 1].classList.toggle('hxk', on || keep);
    }
  }
  if (anim) anim(v);
}
function clearCellAnims() { for (let i = 0; i < 81; i++) { HL[i].getAnimations().forEach(a => a.cancel()); for (const s of HX[i].children) s.getAnimations().forEach(a => a.cancel()); } }

/* Level 2: the unit's tint sweeps in along the unit (the "where"). */
function animUnit(v) {
  if (reducedMotion() || !v.unit.size) return;
  const list = [...v.unit].sort((a, b) => a - b);
  list.forEach((c, k) => HL[c].animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: k * 18, easing: 'ease-out', fill: 'backwards' }));
}
/* Traces FROM the pattern cells TO what they decide (cause -> effect). */
function traceLinks(st) {
  const links = [];
  if (st.place) {
    for (const c of st.pattern) if (c !== st.place.cell) links.push({ from: c, to: st.place.cell, d: 0 });
    return links;
  }
  const shares = (a, b) => rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b);
  for (const [c, d] of st.eliminate) {
    let src = st.pattern.filter(p => p !== c && shares(p, c));
    if (!src.length) src = st.pattern.filter(p => p !== c);
    for (const p of src) links.push({ from: p, to: c, d });
  }
  return links.sort((a, b) => dist(a.from, a.to) - dist(b.from, b.to)).slice(0, 32);
}
/* Level 3: pattern outlines pop in, motes travel to each removed candidate,
   which turns red and struck through as its mote lands. */
function animShow(v) {
  if (reducedMotion()) return;
  const st = L.h.step;
  const pats = st ? (st.place ? [st.place.cell] : st.pattern) : [L.h.cell];
  pats.forEach((c, k) => {
    HL[c].animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: k * 40, easing: 'ease-out', fill: 'backwards' });
    for (const sp of HX[c].children) if (sp.classList.contains('keep')) sp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: k * 40, easing: 'ease-out', fill: 'backwards' });
  });
  if (!st) return;
  const links = traceLinks(st);
  if (st.place) { if (links.length) FX.hintTrace(links, 120); else FX.ring(st.place.cell); return; }
  const far = FX.hintTrace(links, 120);
  const land = Math.max(200, far * 0.85);
  for (const [c, m] of v.elim) for (let d = 1; d <= 9; d++) {
    if (m & bit(d)) HX[c].children[d - 1].animate([{ opacity: 0, transform: 'scale(1.4)' }, { opacity: 1, transform: 'none' }], { duration: 160, delay: land, easing: 'ease-out', fill: 'backwards' });
  }
}

/* =========================================================================
   HINT LADDER
   ========================================================================= */
function ctx() {
  return {
    values: S.values, notes: S.notes, given: S.given, sol: S.sol, mode: S.mode, solved: S.solved,
    unlocked: currentUnlocked(), spot: S.spot ? { steps: S.spot.steps, step: S.spot.step } : null
  };
}

/** One tap of the Hint key. Exposed for tests: returns {kind, level, paid}. */
export function hintTap() {
  if (CK.on) exitCheck(false);
  const s = sig();
  if (!L || L.sig !== s || L.level >= maxLevel(L.h)) L = { h: findHint(ctx()), level: 0, sig: s, faded: false };
  clearTimeout(fadeTimer);
  L.level++; L.faded = false;
  const { h, level } = L;
  const paid = isPaid(h, level);
  if (paid) S.paidHints++;
  clearCellAnims();
  setCoach(hintText(h, level), { level });
  if (level === 4 && h.kind === 'step') doStep(h);
  else if (level === 4 && h.kind === 'wrong') doErase(h);
  else if (level === 3 && h.kind === 'missing') doRestore(h);
  else {
    paint(level === 2 ? animUnit : level === 3 ? animShow : null);
    sfx.hint(Math.min(level, 3));
    if (level === 2 && h.kind === 'missing' && !reducedMotion()) HL[h.cell].animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  }
  haptic(4);
  refresh();                      // paidHints is saved with the meta (autosave hook)
  return { kind: h.kind, level, paid };
}

function fadeLater() {
  clearTimeout(fadeTimer);
  const mine = L;
  fadeTimer = setTimeout(() => {
    if (L !== mine) return;
    L.faded = true;
    const done = () => { if (L === mine && L.faded) paint(); };
    if (reducedMotion()) { done(); return; }
    let n = 0;
    for (let i = 0; i < 81; i++) if (HL[i].className !== 'hl' && !HL[i].classList.contains('ck')) {
      n++; HL[i].animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    }
    setTimeout(done, n ? 250 : 0);
  }, 1500);
}

/* Level 4, step: apply the move with the normal placement / elimination
   sounds and effects; the reason stays in the coach line. */
function doStep(h) {
  const st = h.step;
  busy = true;
  S.selected = -1; S.loaded = 0; S.loadedNote = false;
  if (st.place) {
    const { cell, digit } = st.place;
    const links = traceLinks(st);
    if (links.length) FX.hintTrace(links);
    sfx.pen();
    placeProvisional(cell, digit, 'hint');
    finalizePending();
    paint();
  } else {
    pushUndo();
    const byCell = new Map();
    for (const [c, d] of st.eliminate) byCell.set(c, (byCell.get(c) || 0) | bit(d));
    const list = [];
    let k = 0, wrote = false;
    // positions are read for the traces before any note re-renders
    FX.hintTrace(traceLinks(st));
    for (const [c, m] of byCell) {
      if (S.values[c]) continue;
      const had = S.notes[c];
      if (had) {
        S.notes[c] = had & ~m;
        renderCell(c);
        for (let d = 1; d <= 9; d++) if ((had & m) & bit(d)) {
          const dir = (c + d) % 2 ? 1 : -1;
          animNoteFlick(cells[c].n[d - 1], dir); FX.flickOff(c, d, dir);
          sfx.flick(0.01 + Math.min(k, 8) * 0.03); k++;
          list.push([c, d]);
        }
      } else {
        // no notes in this cell: write the candidates that survive, so the
        // elimination becomes visible and sticks
        S.notes[c] = h.cands[c] & ~m;
        renderCell(c);
        for (let d = 1; d <= 9; d++) if (S.notes[c] & bit(d)) animNoteIn(cells[c].n[d - 1]);
        wrote = true;
        for (let d = 1; d <= 9; d++) if (m & bit(d)) list.push([c, d]);
      }
    }
    if (wrote) sfx.scratch(0.01);
    paint();
    refresh();
    if (S.mode === 'spot' && list.length) notesRemoved(list, st.pattern[0]);
  }
  busy = false; seenSig = sig();
  fadeLater();
}

/* Level 4, wrong digit: erase it (the normal erase). */
function doErase(h) {
  busy = true;
  S.selected = -1; S.loaded = 0; S.loadedNote = false;
  clearCell(h.cell);
  paint();
  busy = false; seenSig = sig();
}

/* Level 3, missing note: the note is written back with the pencil effect. */
function doRestore(h) {
  busy = true;
  pushUndo();
  S.notes[h.cell] |= bit(h.digit);
  renderCell(h.cell);
  animNoteIn(cells[h.cell].n[h.digit - 1]); FX.flecks(h.cell, h.digit);
  sfx.scratch(0.01); sfx.hint(3);
  paint();
  refresh();
  busy = false; seenSig = sig();
  fadeLater();
}

/* Board changed (any placement / note / erase / undo / new puzzle). */
function onRefresh() {
  if (S.id !== seenId) { seenId = S.id; seenSig = sig(); L = null; if (CK.on) exitCheck(false); setCoach(''); clearCellAnims(); paint(); return; }
  if (CK.on && S.solved) exitCheck(false);
  if (busy) return;
  const s = sig();
  if (s === seenSig) return;
  seenSig = s;
  clearTimeout(fadeTimer);
  if (L) { L = null; clearCellAnims(); if (!CK.on) setCoach(''); }
  if (CK.on) {
    CK.cells = CK.cells.filter(i => !S.values[i]);
    if (!CK.claim) checkPrompt();
  }
  paint();
}

/* =========================================================================
   CHECK MY THINKING
   ========================================================================= */
function checkPrompt() {
  const n = CK.cells.length;
  if (CK.claim) {
    const need = CK.claim.digits - CK.digits.length;
    const got = CK.digits.length ? ` (${CK.digits.join(', ')})` : '';
    setCoach(`<b>${CK.claim.label}</b>: press ${need === 2 ? 'the two digits' : CK.claim.digits === 2 ? 'the second digit' : 'the digit'} on the keypad${got}.`, { check: true });
  } else if (!n) setCoach('<b>Check</b>: tap the cells you\'re thinking about, then press Check.', { check: true });
  else setCoach(`<b>${CK.cells.map(cellName).join(', ')}</b> · press Check to say what you see.`, { check: true });
}
export function enterCheck() {
  if (CK.on) return;
  cancelAllPresses();
  CK.on = true; CK.cells = []; CK.claim = null; CK.digits = [];
  S.selected = -1; S.loaded = 0; S.loadedNote = false;
  if (L) { L.faded = true; }
  checkKey.classList.add('latched');
  clearCellAnims(); paint(); checkPrompt();
  refresh();
}
export function exitCheck(clearText = true) {
  if (!CK.on) return;
  CK.on = false; CK.cells = []; CK.claim = null; CK.digits = [];
  checkKey.classList.remove('latched');
  closeSheet();
  if (clearText) setCoach('');
  paint();
}
function onCheckKey() {
  sfx.mod();
  if (S.solved && !CK.on) { sfx.blocked(); return; }
  if (!CK.on) { enterCheck(); return; }
  if (CK.claim) { CK.claim = null; CK.digits = []; checkPrompt(); return; }
  if (CK.cells.length) openSheet();
  else exitCheck();
}
function onCheckCell(i) {
  if (!CK.on) return false;
  if (S.values[i]) { sfx.blocked(); return true; }
  const k = CK.cells.indexOf(i);
  if (k >= 0) CK.cells.splice(k, 1); else { CK.cells.push(i); if (CK.cells.length > 4) CK.cells.shift(); }
  sfx.select();
  paint();
  if (k < 0 && !reducedMotion()) HL[i].animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
  if (CK.claim && (CK.cells.length < CK.claim.cells[0] || CK.cells.length > CK.claim.cells[1])) { CK.claim = null; CK.digits = []; }
  checkPrompt();
  return true;
}
function onCheckDigit(d) {
  if (!CK.on) return false;
  if (!CK.claim) {
    sfx.blocked();
    setCoach(CK.cells.length ? 'Press Check first, then say what you see.' : '<b>Check</b>: tap the cells you\'re thinking about first.', { check: true });
    return true;
  }
  sfx.pencil();
  if (!CK.digits.includes(d)) CK.digits.push(d);
  if (CK.digits.length >= CK.claim.digits) evaluate();
  else checkPrompt();
  return true;
}

/** Run the current claim (exposed for tests through checkClaimNow). */
function evaluate() {
  const claim = CK.claim, cells_ = CK.cells.slice().sort((a, b) => a - b), digits = CK.digits.slice();
  CK.claim = null; CK.digits = [];
  const r = runClaim({ values: S.values, notes: S.notes, sol: S.sol }, claim.id, cells_, digits);
  CK.last = { claim: claim.id, cells: cells_, digits, ...r };
  setCoach(escapeHtml(r.text), { check: true, ok: r.ok });
  if (r.ok) {
    sfx.checkYes(); haptic(8);
    cells_.forEach((c, k) => { animPing(c, k * 40, .5); FX.ring(c); });
  } else {
    sfx.checkNo();
    if (!reducedMotion()) cells_.forEach(c => cells[c].el.animate([{ transform: 'none' }, { transform: 'translateX(-1.5px)' }, { transform: 'translateX(1.5px)' }, { transform: 'none' }], { duration: 220, easing: 'ease-out' }));
  }
  return r;
}
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---- the claim sheet (token sheet styling) ---------------------------- */
function openSheet() {
  cancelAllPresses();
  const n = CK.cells.length;
  ckSheet.textContent = '';
  const h = document.createElement('h2'); h.textContent = 'Check my thinking'; ckSheet.appendChild(h);
  const sub = document.createElement('p'); sub.className = 'sub';
  sub.textContent = `${CK.cells.map(cellName).join(', ')} · What do you see? Checking is free and never changes the board.`;
  ckSheet.appendChild(sub);
  const grid = div('ckgrid', ckSheet);
  for (const c of claimsFor(currentUnlocked())) {
    const fits = n >= c.cells[0] && n <= c.cells[1];
    const req = `${c.cells[0] === c.cells[1] ? c.cells[0] : c.cells[0] + '-' + c.cells[1]} cell${c.cells[1] > 1 ? 's' : ''}${c.digits ? ` + ${c.digits === 2 ? '2 digits' : 'digit'}` : ''}`;
    const k = makeKey('mod', `<span class="lbl">${c.label}</span><span class="req">${req}</span>`, grid);
    k.dataset.claim = c.id;
    k.classList.toggle('off', !fits);
    bindPress(k, () => {
      if (!fits) { sfx.blocked(); return; }
      sfx.mod();
      closeSheet();
      CK.claim = c; CK.digits = [];
      if (c.digits) checkPrompt(); else evaluate();
    });
  }
  const row = div('row', ckSheet);
  const stop = makeKey('mod', '<span class="lbl">Stop checking</span>', row);
  stop.dataset.act = 'stop';
  bindPress(stop, () => { sfx.mod(); exitCheck(); });
  const cancel = makeKey('mod', '<span class="lbl">Back</span>', row);
  cancel.dataset.act = 'back';
  bindPress(cancel, () => { sfx.mod(); closeSheet(); });
  UI.sheetOpen = true;
  ckSheet.classList.add('show'); ckBg.classList.add('show');
}
function closeSheet() {
  if (!ckSheet.classList.contains('show')) return;
  UI.sheetOpen = false;
  ckSheet.classList.remove('show'); ckBg.classList.remove('show');
}

/* =========================================================================
   LAYOUT: Hint / Check live in the free band between board and pad (the
   board never moves). If that band is too thin (wide or short screens),
   the keys move into the header and the coach floats over the board's edge.
   ========================================================================= */
function layout() {
  const wr = wrap.getBoundingClientRect(), br = boardEl.getBoundingClientRect();
  const slack = Math.floor((wr.height - br.height) / 2);
  const inBar = slack >= 30;
  app.classList.toggle('hb-hdr', !inBar);
  const target = inBar ? keysBar : hdrSlot;
  if (hintKey.parentNode !== target) target.append(hintKey, checkKey);
  bar.style.height = inBar ? slack + 'px' : '';
  bar.style.setProperty('--hkh', Math.min(40, Math.max(28, slack - 4)) + 'px');
  fitCoach();
}

/* =========================================================================
   INIT
   ========================================================================= */
export function initHints() {
  app = $('app'); wrap = document.querySelector('.board-wrap');
  bar = div('hintbar', wrap);
  coach = div('coach', bar);
  coach.setAttribute('role', 'status'); coach.setAttribute('aria-live', 'polite');
  ctext = div('ctext', coach);
  pipsEl = document.createElement('span'); pipsEl.className = 'pips'; pipsEl.innerHTML = '<i></i><i></i><i></i><i></i>';
  pipsEl.setAttribute('aria-hidden', 'true');
  ctEl = document.createElement('span'); ctEl.className = 'ct';
  ctext.append(pipsEl, ctEl);
  keysBar = div('hkeys', bar);
  hdrSlot = div('hkeys hdr-slot');
  const hdr = document.querySelector('.hdr');
  hdr.insertBefore(hdrSlot, hdr.querySelector('.hbtns'));
  hintKey = makeKey('mod hk', `${ICON_HINT}<span class="lbl">Hint</span>`, keysBar);
  hintKey.setAttribute('aria-label', 'Hint'); hintKey.title = 'Hint (H)';
  checkKey = makeKey('mod ckk', `${ICON_CHECK}<span class="lbl">Check</span><i class="led"></i>`, keysBar);
  checkKey.setAttribute('aria-label', 'Check my thinking'); checkKey.title = 'Check my thinking (C)';
  bindPress(hintKey, () => { sfx.mod(); hintTap(); });
  bindPress(checkKey, onCheckKey);

  for (let i = 0; i < 81; i++) {
    const c = cells[i];
    const hl = document.createElement('div'); hl.className = 'hl';
    c.el.insertBefore(hl, c.el.querySelector('.notes'));
    const hx = div('hx', c.el);
    for (let d = 1; d <= 9; d++) { const s = document.createElement('span'); s.textContent = d; hx.appendChild(s); }
    HL[i] = hl; HX[i] = hx;
  }

  ckBg = div('sheet-bg ckbg', document.body);
  ckSheet = div('sheet ck', document.body);
  ckSheet.setAttribute('role', 'dialog'); ckSheet.setAttribute('aria-label', 'Check my thinking');
  ckBg.addEventListener('pointerdown', e => { e.preventDefault(); closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ckSheet.classList.contains('show')) closeSheet(); });

  hintHooks.cell = onCheckCell;
  hintHooks.digit = onCheckDigit;
  hintHooks.refresh = onRefresh;
  hintHooks.key = (k, id) => {
    if (k === 'h' || k === 'H') { pressStart(id, hintKey, () => { sfx.mod(); hintTap(); }, null); return true; }
    if (k === 'c' || k === 'C') { pressStart(id, checkKey, onCheckKey, null); return true; }
    if (k === 'Escape' && CK.on) { sfx.mod(); exitCheck(); return true; }
    return false;
  };

  seenId = S.id; seenSig = sig();
  const ro = new ResizeObserver(layout);
  ro.observe(wrap); ro.observe(boardEl);
  window.addEventListener('resize', layout);
  layout();
}

/** For tests and step 7 scoring. */
export function hintState() {
  return {
    paidHints: S.paidHints,
    level: L ? L.level : 0,
    kind: L ? L.h.kind : null,
    step: L && L.h.step ? { tech: L.h.step.tech, place: L.h.step.place, eliminate: L.h.step.eliminate, pattern: L.h.step.pattern, unit: L.h.step.unit } : null,
    cell: L && L.h.cell != null ? L.h.cell : null,
    coach: ctEl ? ctEl.textContent : '',
    check: { on: CK.on, cells: CK.cells.slice(), claim: CK.claim ? CK.claim.id : null, last: CK.last || null },
    unlocked: currentUnlocked(),
    layout: app && app.classList.contains('hb-hdr') ? 'header' : 'bar'
  };
}
