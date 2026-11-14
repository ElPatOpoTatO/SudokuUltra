// campaign.js — minimal WORLD RUNNER. A world is 14 levels played in order:
// Level 0 (guided script) → Spot it 1-6 → Use it 1-6 → Master 1. Next goes to
// the following level; after Master, an end-of-world toast. Every level is
// selectable (DEV menu row). Units, unlock gates and the keyboard map come
// later (step 7).
//
/* --- step7: the store now lives in the progress profile ('sudoku.profile.v1', profile.js), which
   migrates 'sudoku.camp.v1' once; `store` below is a live view of it with the same shape. The
   Master gate (24 charges) and the end-of-world reward are step 7 (docs/progression.md). --- */
// Stored in localStorage 'sudoku.camp.v1' (best effort):
//   { done: { <level id>: true }, clean: { <level id>: true }, skip: { <world>: true },
//     unlock: { fillNotes: true } }
// unlock.fillNotes is set when World 2's Level 0 is finished (the player has
// written a cell's candidates by hand once). TODO: a "fill all candidates"
// control reads it (not built yet).
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
/* --- step7: the store lives in the progress profile; Master gate; hooks for the progression UI --- */
import { campStore, saveProfile, markLevelDone, isMasterOpen } from './profile.js';
/* --- end step7 --- */

const KEY = 'sudoku.camp.v1';
export const LEVELS_PER_WORLD = 14;
const toastTitle = $('toastTitle'), againLbl = document.querySelector('#againKey .lbl');

/* --- step7: 'sudoku.camp.v1' is migrated into 'sudoku.profile.v1' (profile.js); this is a live view --- */
const store = campStore();
function saveStore() { saveProfile(); }
// gate(w): may the runner go on to world w's Master? blocked(w): it may not (show the level list).
// worldToast(w): the end-of-world toast is up (reward + keyboard key). leave(): the runner stopped.
export const campHooks = { blocked: null, worldToast: null, leave: null };
void KEY;
/* --- end step7 --- */

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
export function startCampaign(w = 0, k = 0, restore = false) {
  const ids = worldLevels(w);
  if (!ids.length || !hasLevel0(w)) return false;
  cur = { world: w, ids, k: 0 };
  play(Math.max(0, Math.min(LEVELS_PER_WORLD - 1, k)), restore);   /* step7: restore = Continue */
  return true;
}
/* --- step7 --- */
export const campCurrent = () => (cur ? { world: cur.world, k: cur.k, id: cur.ids[cur.k], worldToast } : null);
/* --- end step7 --- */
function play(k, restore = false) {
  cur.k = k; worldToast = false;
  hideToast();
  const id = cur.ids[k];
  starting = true;
  try {
    const w = cur.world;
    if (k === 0) startLevel0(level0Scripts['w' + w], { canSkip: !!store.skip[w], onNext: next, onSkip: next, onDone: () => { markDone(id, true); level0Unlocks(w); } });
    else startPuzzle(id, restore);   /* step7: restore */
  } finally { starting = false; }
  updatePid();
}
function next() {
  if (!cur) return;
  /* --- step7: Master stays locked until the gate; the runner shows the world's level list instead --- */
  if (cur.k + 1 === LEVELS_PER_WORLD - 1 && !isMasterOpen(cur.world) && campHooks.blocked) {
    const w = cur.world; hideToast(); cur = null; worldToast = false; campHooks.blocked(w); return;
  }
  /* --- end step7 --- */
  if (cur.k < LEVELS_PER_WORLD - 1) play(cur.k + 1);
  else showWorldToast();
}
function markDone(id, clean) {
  markLevelDone(id, clean);   /* step7: profile.js */
}
/* --- step6: what finishing a world's Level 0 unlocks --- */
function level0Unlocks(w) {
  if (w === 2 && !store.unlock.fillNotes) { store.unlock.fillNotes = true; saveStore(); }
}
/** The next world that has a Level 0 and levels, or -1. */
const nextWorld = w => (hasLevel0(w + 1) && worldLevels(w + 1).length ? w + 1 : -1);
/* --- end step6 --- */
function showWorldToast() {
  worldToast = true;
  toastTitle.textContent = `World ${cur.world} complete`;
  toastMsg.textContent = `All ${LEVELS_PER_WORLD} levels done.`;
  againLbl.textContent = nextWorld(cur.world) >= 0 ? 'Next world' : 'Done';   /* step6 */
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;                       // replay the toast's entrance
  toastEl.classList.add('show');
  sfx.latch(0, 0); sfx.latch(0.18, 1); sfx.latch(0.36, 2);
  /* --- step7 --- */ if (campHooks.worldToast) campHooks.worldToast(cur.world); /* --- end step7 --- */
}
/** Open a world's Level 0 on its own (outside the runner). */
export function startLevel0Alone(w = 0) {
  cur = null;
  return startLevel0(level0Scripts['w' + w], { canSkip: !!store.skip[w], onDone: () => level0Unlocks(w) });
}

export function initCampaign() {
  // leaving the runner: any puzzle the runner did not start
  gameHooks.start.push(() => { if (cur && !starting) { cur = null; worldToast = false; /* step7 */ if (campHooks.leave) campHooks.leave(); } });
  gameHooks.label = () => {
    if (cur) return `<b>DEV</b> · World ${cur.world} · Level ${cur.k}/${LEVELS_PER_WORLD - 1}`;
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
    if (worldToast) {
      /* --- step6: "Next world" starts the following world's runner --- */
      const nw = nextWorld(cur.world);
      hideToast(); worldToast = false; cur = null;
      /* step7 */ if (campHooks.leave) campHooks.leave();
      if (nw >= 0) startCampaign(nw, 0); else updatePid();
      /* --- end step6 --- */
      return true;
    }
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
