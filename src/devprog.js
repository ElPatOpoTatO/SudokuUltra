// devprog.js — DEV menu rows for the progression layer (step 7): Home, the
// keyboard map, "unlock all", master worlds, fill a Master gate, reset.
// Kept apart from progress.js so devmenu.js can import it without a cycle.
import { nav } from './events.js';
import { getProfile, setProfile, setDevUnlockAll, levelIds, WORLD_IDS, itemsFor } from './profile.js';
import { MASTER_GATE } from './progcfg.js';

/* ---- DEV tools ---------------------------------------------------------------- */
export function devMaster(w) {
  const p = getProfile(), was = new Set(p.mastered);
  for (let v = 0; v <= w; v++) {
    if (!was.has(v)) { p.flags.pendingBuild.push(v); p.flags.badge = true; p.flags.fresh.push(...itemsFor(v).map(i => i.kind + ':' + i.id)); }
    const ids = levelIds(v);
    ids.forEach((id, k) => { p.levels[id] = k === 0 ? 0 : 3; });
  }
  setProfile(p);
}
export function devGate(w, n = MASTER_GATE) {
  const p = getProfile(), ids = levelIds(w).slice(1, 13);
  ids.forEach((id, j) => { const c = Math.max(0, Math.min(3, n - j * 3)); if (c > 0) p.levels[id] = c; else delete p.levels[id]; });
  setProfile(p);
}
export function progDevEntries(sheet, el, chip, close) {
  el('div', 'grp', 'Progression (step 7)', sheet);
  const r1 = el('div', 'wrow', null, sheet);
  chip(r1, 'Home').addEventListener('click', () => { close(); nav('home'); });
  chip(r1, 'Keyboard map').addEventListener('click', () => { close(); nav('campaign'); });
  const ua = chip(r1, `Unlock all: ${getProfile().flags.devUnlockAll ? 'ON' : 'off'}`);
  ua.dataset.dev = 'unlockall';
  if (getProfile().flags.devUnlockAll) ua.classList.add('cur');
  ua.addEventListener('click', () => { setDevUnlockAll(!getProfile().flags.devUnlockAll); ua.textContent = `Unlock all: ${getProfile().flags.devUnlockAll ? 'ON' : 'off'}`; ua.classList.toggle('cur', getProfile().flags.devUnlockAll); });
  const r2 = el('div', 'wrow', null, sheet);
  el('span', 'tag', 'Master up to', r2);
  for (const w of WORLD_IDS) { const c = chip(r2, 'W' + w); c.dataset.devMaster = String(w); c.addEventListener('click', () => devMaster(w)); }
  const r3 = el('div', 'wrow', null, sheet);
  el('span', 'tag', '24⚡ gate in', r3);
  for (const w of WORLD_IDS) { const c = chip(r3, 'W' + w); c.addEventListener('click', () => devGate(w)); }
  const r4 = el('div', 'wrow', null, sheet);
  chip(r4, 'Reset progress').addEventListener('click', () => { setProfile({}); });
}

