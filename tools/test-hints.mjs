// test-hints.mjs — logic tests for src/hintlogic.js (hint ladder + check my thinking).
//   node tools/test-hints.mjs
// Prints PASS/FAIL per test and exits 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TECHNIQUES, computeCands, nextStep, allSteps, applyStep, solveLogically, parseGrid, bit, digitsOf
} from '../src/solver.js';
import { ALLOW } from '../src/shared.js';
import {
  unlockedFor, findHint, hintCands, hintText, stepAgrees, isEasiest, maxLevel, isPaid,
  claimsFor, runClaim, CLAIMS
} from '../src/hintlogic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/puzzles.json'), 'utf8'));

const results = [];
function test(name, fn) {
  try { const info = fn(); results.push(true); console.log(`PASS  ${name}${info ? '  (' + info + ')' : ''}`); }
  catch (e) { results.push(false); console.log(`FAIL  ${name}\n      ${e && e.message}`); }
}
function assert(c, m = 'assertion failed') { if (!c) throw new Error(m); }

// seeded rng (mulberry32)
let seed = 20261112;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[(rnd() * a.length) | 0];

const arr = s => Int8Array.from(parseGrid(s));
const items = [];
for (const w of DATA.worlds) for (const it of [...w.useIt, ...w.master]) items.push({ id: it.id, world: w.world, givens: it.givens, solution: it.solution });
for (const b of Object.keys(DATA.quick)) for (const it of DATA.quick[b].slice(0, 30)) items.push({ id: it.id, world: 4, givens: it.givens, solution: it.solution });

/* A position: the puzzle after the first k steps of a full logical solve.
   notesMode: 'none' | 'full' (the solver's cands, incl. earlier eliminations) | 'partial'. */
function position(it, frac, notesMode, atTech = null) {
  const given = arr(it.givens), sol = arr(it.solution);
  const r = solveLogically(given);
  let k = Math.floor(r.steps.length * frac);
  if (atTech) {                     // right before a step of one of these techniques
    const ks = r.steps.map((st, j) => atTech.includes(st.tech) ? j : -1).filter(j => j >= 0);
    if (ks.length) k = pick(ks);
  }
  const values = Int8Array.from(given), cands = computeCands(values);
  for (let s = 0; s < k; s++) applyStep(values, cands, r.steps[s]);
  const notes = new Uint16Array(81);
  if (notesMode === 'full') notes.set(cands);
  if (notesMode === 'partial') for (let i = 0; i < 81; i++) if (!values[i] && rnd() < 0.4) notes[i] = cands[i];
  return { given, sol, values, notes };
}

const BANNED_W1 = /pair|pointing|claiming|naked/i;

test('unlockedFor: campaign ids use ALLOW[w], others ALLOW[4]', () => {
  assert(JSON.stringify(unlockedFor('w1-use-03')) === JSON.stringify(ALLOW[1]));
  assert(JSON.stringify(unlockedFor('w3-spot-01')) === JSON.stringify(ALLOW[3]));
  assert(JSON.stringify(unlockedFor('w0-master-02')) === JSON.stringify(ALLOW[0]));
  for (const id of ['q-easy-001', 'd-0311', 'proto', '', null]) assert(JSON.stringify(unlockedFor(id)) === JSON.stringify(ALLOW[4]), id);
});

test('200 sampled positions x 5 worlds: hint step within unlocked, easiest, agrees with the solution', () => {
  let n = 0, steps = 0, none = 0;
  const techSeen = {};
  for (let s = 0; s < 200; s++) {
    // half the samples: a W2-W4 item right before one of its world's steps (so
    // naked singles, pointing/claiming and pairs really come up)
    const hard = s % 2 === 1;
    const it = hard ? pick(items.filter(x => x.world >= 2)) : pick(items);
    const frac = pick([0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95]);
    const atTech = hard ? TECHNIQUES.filter(t => ALLOW[it.world].includes(t) && !ALLOW[it.world - 1].includes(t)) : null;
    const pos = position(it, frac, hard ? pick(['none', 'full']) : pick(['none', 'full', 'partial']), atTech);
    for (let w = 0; w <= 4; w++) {
      const unlocked = ALLOW[w];
      const h = findHint({ ...pos, mode: 'free', solved: false, unlocked });
      n++;
      if (h.kind === 'none') {
        none++;
        assert(!nextStep(pos.values, hintCands(pos.values, pos.notes), unlocked), `${it.id}: "none" but a step exists`);
        continue;
      }
      if (h.kind === 'solved') continue;
      assert(h.kind === 'step', `${it.id} w${w}: unexpected ${h.kind}`);
      const st = h.step;
      steps++; techSeen[st.tech] = (techSeen[st.tech] || 0) + 1;
      assert(unlocked.includes(st.tech), `${it.id} w${w}: ${st.tech} is locked`);
      const cands = hintCands(pos.values, pos.notes);
      const ref = nextStep(pos.values, cands, unlocked);
      assert(ref && JSON.stringify(ref) === JSON.stringify(st), `${it.id} w${w}: not the solver's easiest step`);
      assert(isEasiest(pos.values, cands, unlocked, st), `${it.id} w${w}: an easier technique is available`);
      assert(stepAgrees(st, pos.sol), `${it.id} w${w}: ${st.tech} contradicts the solution`);
      if (w <= 1) for (let lv = 1; lv <= 4; lv++) assert(!BANNED_W1.test(hintText(h, lv)), `${it.id} W${w} level ${lv} names a locked technique: ${hintText(h, lv)}`);
      // level-4 application never contradicts the solution
      const v = Int8Array.from(pos.values), c = Uint16Array.from(cands);
      applyStep(v, c, st);
      for (let i = 0; i < 81; i++) {
        if (v[i]) assert(v[i] === pos.sol[i], `${it.id}: applying ${st.tech} puts a wrong digit in ${i}`);
        else assert(c[i] & bit(pos.sol[i]), `${it.id}: applying ${st.tech} removes the solution digit from ${i}`);
      }
    }
  }
  return `${n} hint queries, ${steps} steps, ${none} none; ${JSON.stringify(techSeen)}`;
});

/* Replays what hintui does at level 4, including writing the surviving
   candidates as notes in cells that had none. */
function applyLikeUI(values, notes, h) {
  const st = h.step;
  if (st.place) {
    const { cell, digit } = st.place;
    values[cell] = digit; notes[cell] = 0;
    for (let j = 0; j < 81; j++) if (j !== cell && (((j / 9) | 0) === ((cell / 9) | 0) || j % 9 === cell % 9 ||
      (((j / 27) | 0) === ((cell / 27) | 0) && (((j % 9) / 3) | 0) === (((cell % 9) / 3) | 0)))) notes[j] &= ~bit(digit);
  } else {
    const byCell = new Map();
    for (const [c, d] of st.eliminate) byCell.set(c, (byCell.get(c) || 0) | bit(d));
    for (const [c, m] of byCell) notes[c] = notes[c] ? notes[c] & ~m : h.cands[c] & ~m;
  }
}

test('hint-driven solve: every Use it / Master puzzle solved by tapping hint level 4 only, within its world', () => {
  let solved = 0, total = 0, maxSteps = 0;
  for (const w of DATA.worlds) for (const it of [...w.useIt, ...w.master]) {
    total++;
    const values = arr(it.givens), sol = arr(it.solution), notes = new Uint16Array(81), given = arr(it.givens);
    const unlocked = ALLOW[Math.max(w.world, 1)];   // W0 puzzles need W0+W1 (pipeline rule)
    let k = 0;
    for (; k < 400; k++) {
      const h = findHint({ values, notes, given, sol, mode: 'free', solved: false, unlocked });
      if (h.kind === 'solved') break;
      assert(h.kind === 'step', `${it.id}: stuck with "${h.kind}" after ${k} hints`);
      assert(unlocked.includes(h.step.tech) && stepAgrees(h.step, sol), `${it.id}: bad step ${h.step.tech}`);
      applyLikeUI(values, notes, h);
    }
    assert(values.every((d, i) => d === sol[i]), `${it.id}: not solved`);
    maxSteps = Math.max(maxSteps, k); solved++;
  }
  return `${solved}/${total} solved, longest ${maxSteps} hints`;
});

test('W0 Use it with ALLOW[0] only: never names a hidden single; "none" is honest', () => {
  let none = 0;
  for (const it of DATA.worlds[0].useIt) {
    const values = arr(it.givens), sol = arr(it.solution), notes = new Uint16Array(81), given = arr(it.givens);
    for (let k = 0; k < 100; k++) {
      const h = findHint({ values, notes, given, sol, mode: 'free', solved: false, unlocked: ALLOW[0] });
      if (h.kind === 'none') { none++; assert(/No move with the techniques you've learned/.test(hintText(h, 1))); break; }
      if (h.kind === 'solved') break;
      assert(h.step.tech === 'full-house', h.step.tech);
      applyLikeUI(values, notes, h);
    }
  }
  return `${none} of ${DATA.worlds[0].useIt.length} reach "no move" before the end`;
});

test('missing note: an erased true candidate is reported first (and levels 1-3, paid at 3)', () => {
  let n = 0;
  for (let s = 0; s < 60; s++) {
    const it = pick(items), pos = position(it, pick([0.1, 0.3, 0.5]), 'full');
    const empties = []; for (let i = 0; i < 81; i++) if (!pos.values[i]) empties.push(i);
    if (!empties.length) continue;
    const c = pick(empties);
    pos.notes[c] &= ~bit(pos.sol[c]);
    if (!pos.notes[c]) pos.notes[c] = bit(pos.sol[c] % 9 + 1) & ~0;   // keep the cell "noted"
    if (pos.notes[c] & bit(pos.sol[c])) continue;
    const h = findHint({ ...pos, mode: 'free', solved: false, unlocked: ALLOW[4] });
    assert(h.kind === 'missing', `expected missing, got ${h.kind}`);
    // the first noted cell missing its digit in reading order
    assert(h.cell <= c && h.digit === pos.sol[h.cell], 'wrong cell/digit');
    assert(hintText(h, 1) === `Your notes are missing a <b>${h.digit}</b> in r${((h.cell / 9) | 0) + 1}c${h.cell % 9 + 1}.`, hintText(h, 1));
    assert(maxLevel(h) === 3 && !isPaid(h, 1) && !isPaid(h, 2) && isPaid(h, 3));
    n++;
  }
  return `${n} positions`;
});

test('wrong digit: reported before anything else; ladder erases it at level 4', () => {
  let n = 0;
  for (let s = 0; s < 40; s++) {
    const it = pick(items), pos = position(it, 0.3, 'none');
    const empties = []; for (let i = 0; i < 81; i++) if (!pos.values[i]) empties.push(i);
    const c = pick(empties);
    pos.values[c] = pos.sol[c] % 9 + 1;
    const h = findHint({ ...pos, mode: 'free', solved: false, unlocked: ALLOW[4] });
    assert(h.kind === 'wrong' && h.cell === c, `expected wrong at ${c}, got ${h.kind} ${h.cell}`);
    assert(maxLevel(h) === 4 && isPaid(h, 3) && isPaid(h, 4) && !isPaid(h, 2));
    n++;
  }
  return `${n} positions`;
});

test('levels: step ladder is 4 deep, paid only at 3 and 4; none/solved are 1 deep and free', () => {
  const h = { kind: 'step', step: { tech: 'naked-pair', unit: { type: 'row', index: 3 }, pattern: [30, 34], digits: [2, 7], place: null, eliminate: [[27, 2]], text: 'x' } };
  assert(maxLevel(h) === 4 && [1, 2, 3, 4].map(l => isPaid(h, l)).join() === 'false,false,true,true');
  assert(hintText(h, 1) === "There's a <b>Naked Pair</b> you can use.", hintText(h, 1));
  assert(hintText(h, 2) === 'Look in <b>row 4</b>.', hintText(h, 2));
  for (const k of ['none', 'solved']) assert(maxLevel({ kind: k }) === 1 && !isPaid({ kind: k }, 1));
});

test('Spot it: the hint goes straight to the target technique step', () => {
  let n = 0;
  for (const w of DATA.worlds) for (const it of w.spotIt) {
    if (w.world === 0) continue;
    const values = arr(it.values);
    const cands = it.cands ? Uint16Array.from({ length: 81 }, (_, i) => parseInt(it.cands.slice(i * 3, i * 3 + 3), 16)) : computeCands(values);
    const target = new Set(TECHNIQUES.filter(t => ALLOW[w.world].includes(t) && !ALLOW[w.world - 1].includes(t)));
    const steps = [...allSteps(values, cands, ALLOW[w.world])].filter(s => target.has(s.tech));
    // solution of the source puzzle
    const src = [...Object.values(DATA.quick).flat(), ...DATA.daily].find(q => q.id === it.source);
    const sol = arr(src.solution);
    const h = findHint({ values, notes: cands, given: values, sol, mode: 'spot', solved: false, unlocked: ALLOW[w.world], spot: { steps, step: it.step } });
    assert(h.kind === 'step' && target.has(h.step.tech), `${it.id}: got ${h.kind} ${h.step && h.step.tech}`);
    assert(h.step.tech === it.step.tech && JSON.stringify(h.step.eliminate) === JSON.stringify(it.step.eliminate), `${it.id}: not the stored step`);
    n++;
  }
  return `${n} Spot it items`;
});

test('check: claim types follow the unlocked rule', () => {
  const ids = u => claimsFor(u).map(c => c.id).join(',');
  assert(ids(ALLOW[0]) === 'place,eliminate', ids(ALLOW[0]));
  assert(ids(ALLOW[1]) === 'place,eliminate,hidden-single', ids(ALLOW[1]));
  assert(ids(ALLOW[2]) === 'place,eliminate,naked-single,hidden-single', ids(ALLOW[2]));
  assert(ids(ALLOW[3]) === 'place,eliminate,naked-single,hidden-single,locked', ids(ALLOW[3]));
  assert(ids(ALLOW[4]) === CLAIMS.map(c => c.id).join(','), ids(ALLOW[4]));
});

test('check: every solver step, claimed as what it is, is confirmed; a broken claim gets a specific no', () => {
  let yes = 0, no = 0;
  for (let s = 0; s < 120; s++) {
    const it = pick(items), pos = position(it, pick([0.1, 0.3, 0.5, 0.7]), 'full');
    const cands = hintCands(pos.values, pos.notes);
    for (const st of allSteps(pos.values, cands)) {
      const id = { 'naked-pair': 'naked-pair', 'hidden-pair': 'hidden-pair', pointing: 'locked', claiming: 'locked', 'naked-single': 'naked-single', 'hidden-single-box': 'hidden-single', 'hidden-single-line': 'hidden-single' }[st.tech];
      if (!id) continue;
      const def = CLAIMS.find(c => c.id === id);
      const cells = st.place ? [st.place.cell] : st.pattern;
      const digits = def.digits ? st.digits.slice(0, def.digits) : [];
      const r = runClaim(pos, id, cells, digits);
      assert(r.ok, `${it.id} ${st.tech} ${JSON.stringify(cells)}: ${r.text}`);
      yes++;
      if (id === 'naked-pair') {
        // swap one cell for another empty cell of the unit: must be a specific "no"
        const other = [...Array(81).keys()].find(i => !pos.values[i] && !cells.includes(i) && ((i / 9 | 0) === (cells[0] / 9 | 0)) && digitsOf(cands[i]).length > 2);
        if (other != null) {
          const r2 = runClaim(pos, id, [cells[0], other], []);
          assert(!r2.ok && /^(Not a pair|.* don't share)/.test(r2.text), r2.text);
          no++;
        }
      }
      if (yes > 400) break;
    }
  }
  return `${yes} confirmed, ${no} specific no's`;
});

test('check: place / eliminate claims are judged against the solution', () => {
  let n = 0;
  for (let s = 0; s < 50; s++) {
    const it = pick(items), pos = position(it, 0.3, 'none');
    const empties = []; for (let i = 0; i < 81; i++) if (!pos.values[i]) empties.push(i);
    const c = pick(empties), d = pos.sol[c], bad = d % 9 + 1;
    assert(runClaim(pos, 'place', [c], [d]).ok, 'true placement rejected');
    const r = runClaim(pos, 'place', [c], [bad]);
    assert(!r.ok && /^No, r\dc\d (can't|is not)/.test(r.text), r.text);
    assert(!runClaim(pos, 'eliminate', [c], [d]).ok, 'removing the solution digit accepted');
    assert(runClaim(pos, 'eliminate', [c], [bad]).ok, 'removing a wrong digit rejected');
    n++;
  }
  return `${n} positions`;
});

const bad = results.filter(r => !r).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
