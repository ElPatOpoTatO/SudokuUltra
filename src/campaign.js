// campaign.js — minimal WORLD RUNNER. A world is 14 levels played in order:
// Level 0 (guided script) → Spot it 1-6 → Use it 1-6 → Master 1. Next goes to
// the following level; after Master, an end-of-world toast. Every level is
// selectable (DEV menu row). Units, unlock gates and the keyboard map come
// later (step 7).
//
// Stored in localStorage 'sudoku.camp.v1' (best effort):
//   { done: { <level id>: true }, clean: { <level id>: true }, skip: { <world>: true } }
// skip[w] is set when Spot it 1 of world w is cleared with no mistakes: from
// then on Level 0 of that world shows a Skip keycap.
//
// Boot: #camp=<world> or #camp=<world>.<index 0-13> starts the runner,
// #l0=w<world> opens that Level 0 on its own.
import { $ } from './util.js';
import { sfx } from './audio.js';
import { S } from './state.js';
import { worlds } from './puzzles.js';
import { startPuzzle, gameHooks, updatePid } from './game.js';
import { toastHooks, hideToast } from './actions.js';
import { toastEl, toastMsg } from './board.js';
import { startLevel0, level0Scripts } from './level0.js';

const KEY = 'sudoku.camp.v1';
export const LEVELS_PER_WORLD = 14;
const toastTitle = $('toastTitle'), againLbl = document.querySelector('#againKey .lbl');

function loadStore() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && typeof o === 'object') return { done: o.done || {}, clean: o.clean || {}, skip: o.skip || {} };
  } catch (e) {}
  return { done: {}, clean: {}, skip: {} };
}
const store = loadStore();
function saveStore() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

/** Level ids of world w, in play order (14). */
export function worldLevels(w) {
  const W = worlds.find(x => x.world === w);
  if (!W) return [];
  return [`w${w}-l0`, ...W.spotIt.slice(0, 6).map(x => x.id), ...W.useIt.slice(0, 6).map(x => x.id), W.master[0].id];
}
export const levelName = k => (k === 0 ? 'Level 0' : k <= 6 ? `Spot it ${k}` : k <= 12 ? `Use it ${k - 6}` : 'Master');
export const hasLevel0 = w => !!level0Scripts['w' + w];

let cur = null;          // { world, ids, k }
let starting = false;    // the runner itself is starting a level
let worldToast = false;  // the end-of-world toast is showing

/** Start the runner on world w at level index k (0 = Level 0). */
export function startCampaign(w = 0, k = 0) {
  const ids = worldLevels(w);
  if (!ids.length || !hasLevel0(w)) return false;
  cur = { world: w, ids, k: 0 };
  play(Math.max(0, Math.min(LEVELS_PER_WORLD - 1, k)));
  return true;
}
function play(k) {
  cur.k = k; worldToast = false;
  hideToast();
  const id = cur.ids[k];
  starting = true;
  try {
    if (k === 0) startLevel0(level0Scripts['w' + cur.world], { canSkip: !!store.skip[cur.world], onNext: next, onSkip: next, onDone: () => markDone(id, true) });
    else startPuzzle(id, false);
  } finally { starting = false; }
  updatePid();
}
function next() {
  if (!cur) return;
  if (cur.k < LEVELS_PER_WORLD - 1) play(cur.k + 1);
  else showWorldToast();
}
function markDone(id, clean) {
  store.done[id] = true;
  if (clean) store.clean[id] = true;
  saveStore();
}
function showWorldToast() {
  worldToast = true;
  toastTitle.textContent = `World ${cur.world} complete`;
  toastMsg.textContent = `All ${LEVELS_PER_WORLD} levels done.`;
  againLbl.textContent = 'Done';
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;                       // replay the toast's entrance
  toastEl.classList.add('show');
  sfx.latch(0, 0); sfx.latch(0.18, 1); sfx.latch(0.36, 2);
}
/** Open a world's Level 0 on its own (outside the runner). */
export function startLevel0Alone(w = 0) {
  cur = null;
  return startLevel0(level0Scripts['w' + w], { canSkip: !!store.skip[w] });
}

export function initCampaign() {
  // leaving the runner: any puzzle the runner did not start
  gameHooks.start.push(() => { if (cur && !starting) { cur = null; worldToast = false; } });
  gameHooks.label = () => {
    if (cur) return `<b>DEV</b> · World ${cur.world} · Level ${cur.k + 1}/${LEVELS_PER_WORLD}`;
    if (S.mode === 'l0' || S.mode === 'l0demo') return `<b>DEV</b> · ${S.id} · W${S.world} Level 0`;
    return null;
  };
  // a solved / spotted level: record it, the keycap says Next (Finish after Master)
  toastHooks.after = () => {
    if (!cur || S.id !== cur.ids[cur.k] || worldToast) return;
    const clean = S.mistakes === 0;
    markDone(S.id, clean);
    if (cur.k === 1 && clean) { store.skip[cur.world] = true; saveStore(); }
    againLbl.textContent = cur.k < LEVELS_PER_WORLD - 1 ? 'Next' : 'Finish';
  };
  gameHooks.next = () => {
    if (!cur) return false;
    if (worldToast) { hideToast(); worldToast = false; cur = null; updatePid(); return true; }
    if (!S.solved) return false;
    next();
    return true;
  };
  const m = /[#&]camp=(\d)(?:\.(\d+))?/.exec(location.hash), l = /[#&]l0=w(\d)/.exec(location.hash);
  if (m) startCampaign(+m[1], m[2] ? +m[2] : 0);
  else if (l && hasLevel0(+l[1])) startLevel0Alone(+l[1]);
}

/* DEV menu rows (devmenu.js passes its own el/chip helpers and close()). */
export function devEntries(sheet, el, chip, close) {
  el('div', 'grp', 'Campaign runner', sheet);
  for (const W of worlds) {
    if (!hasLevel0(W.world)) continue;
    const row = el('div', 'wrow', null, sheet);
    const c = chip(row, `Campaign: World ${W.world}`);
    c.dataset.camp = String(W.world);
    c.addEventListener('click', () => { close(); startCampaign(W.world, 0); });
    const l0 = chip(row, `W${W.world} Level 0`);
    l0.dataset.l0 = 'w' + W.world;
    if (S.id === `w${W.world}-l0`) l0.classList.add('cur');
    l0.addEventListener('click', () => { close(); startLevel0Alone(W.world); });
    const lv = el('div', 'wrow', null, sheet);
    el('span', 'tag', `W${W.world} levels`, lv);
    worldLevels(W.world).forEach((id, k) => {
      const b = chip(lv, k === 0 ? 'L0' : k <= 6 ? `S${k}` : k <= 12 ? `U${k - 6}` : 'M');
      b.dataset.campLevel = `${W.world}.${k}`;
      b.title = `${levelName(k)} (${id})`;
      if (store.done[id]) b.classList.add('done');
      if (cur && cur.world === W.world && cur.k === k) b.classList.add('cur');
      b.addEventListener('click', () => { close(); startCampaign(W.world, k); });
    });
  }
}

/* Test view (window.__debug.camp with ?debug=1). */
export const camp = {
  state: () => ({ active: !!cur, world: cur ? cur.world : -1, k: cur ? cur.k : -1, id: cur ? cur.ids[cur.k] : null, worldToast,
    store: JSON.parse(JSON.stringify(store)) }),
  levels: worldLevels, start: startCampaign, startLevel0Alone
};
