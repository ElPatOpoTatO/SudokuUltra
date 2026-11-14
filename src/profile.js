// profile.js — the PROGRESS PROFILE (step 7): power charges per level, mastered
// worlds, expertise, unlocks, flags. One plain JSON object, persisted under
// localStorage 'sudoku.profile.v1' (best effort). The backup code (backup.js,
// docs/token.md) reads getProfile() and loads with setProfile(). See docs/progression.md.
//
//   getProfile()        → deep copy { v, levels: {id: bestCharges}, mastered: [w],
//                          expertise: {tier, inner, points}, unlocks: {fillNotes, items}, flags: {...} }
//   setProfile(obj)     → validate, apply, save, notify (screens re-render, settings re-checked)
//   onProfile(fn)       → fn(profile) after every change
//
// It listens for 'sudoku:solved' (events.js) and keeps each level's BEST result.
// Migrates the step-6 store 'sudoku.camp.v1' once (done levels, skip flags, unlock.fillNotes).
import { worlds } from './puzzles.js';
import { settingsGate, setSettings, STYLES, getSettings } from './settings.js';
import { PRESETS, LAYOUTS } from './colorways.js';
import {
  CHARGES_PER_LEVEL, WORLD_CHARGES, MASTER_GATE, UNLOCKS, FREE_ITEMS,
  TIERS, INNER_MAX
} from './progcfg.js';

export const PROFILE_KEY = 'sudoku.profile.v1';
export const OLD_CAMP_KEY = 'sudoku.camp.v1';

/* ---- level ids (same order as campaign.js worldLevels) ---------------------- */
export const WORLD_IDS = worlds.map(W => W.world).filter(w => W_OK(w));
function W_OK(w) { const W = worlds.find(x => x.world === w); return !!(W && W.spotIt.length >= 6 && W.useIt.length >= 6 && W.master.length); }
export function levelIds(w) {
  const W = worlds.find(x => x.world === w);
  if (!W) return [];
  return [`w${w}-l0`, ...W.spotIt.slice(0, 6).map(x => x.id), ...W.useIt.slice(0, 6).map(x => x.id), W.master[0].id];
}
const LEVEL = new Map();     // id -> { world, k }
for (const w of WORLD_IDS) levelIds(w).forEach((id, k) => LEVEL.set(id, { world: w, k }));
export const levelInfo = id => LEVEL.get(id) || null;
export const isLevel = id => LEVEL.has(id);
export const worldCount = () => WORLD_IDS.length;

/* ---- validation ---------------------------------------------------------------- */
function blank() {
  return {
    v: 1, levels: {}, mastered: [],
    expertise: { tier: 1, inner: 1, points: 0 },
    unlocks: { fillNotes: false, items: [] },
    flags: { skip: {}, clean: {}, badge: false, fresh: [], pendingBuild: [], devUnlockAll: false, lastFree: '' }
  };
}
const int = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d);
const itemKey = it => it.kind + ':' + it.id;

function validate(o) {
  const p = blank();
  if (!o || typeof o !== 'object') return p;
  if (o.levels && typeof o.levels === 'object') {
    for (const [id, c] of Object.entries(o.levels)) {
      const L = LEVEL.get(id);
      if (!L) continue;
      p.levels[id] = L.k === 0 ? 0 : int(c, 0, CHARGES_PER_LEVEL, 0);
    }
  }
  const ms = new Set();
  if (Array.isArray(o.mastered)) for (const w of o.mastered) if (WORLD_IDS.includes(w)) ms.add(w);
  for (const w of WORLD_IDS) if ((p.levels[levelIds(w)[13]] | 0) >= 1) ms.add(w);   // a cleared Master masters its world
  p.mastered = [...ms].sort((a, b) => a - b);
  const e = o.expertise || {};
  p.expertise.tier = int(e.tier, 1, TIERS.length, 1);
  p.expertise.inner = int(e.inner, 1, INNER_MAX, 1);
  p.expertise.points = int(e.points, 0, 1e6, 0);
  const t = tierFor(p.mastered);
  if (t > p.expertise.tier) p.expertise = { tier: t, inner: 1, points: 0 };
  const T = TIERS.find(x => x.tier === p.expertise.tier) || TIERS[0];   // the inner level never falls below what the points give
  p.expertise.inner = Math.max(p.expertise.inner, Math.min(INNER_MAX, 1 + Math.floor(p.expertise.points / T.perInner)));
  const u = o.unlocks || {}, f = o.flags || {};
  p.unlocks.fillNotes = u.fillNotes === true;
  p.unlocks.items = earnedItems(p.mastered).map(itemKey);
  if (f.skip && typeof f.skip === 'object') for (const k of Object.keys(f.skip)) if (f.skip[k] === true && /^\d$/.test(k)) p.flags.skip[k] = true;
  if (f.clean && typeof f.clean === 'object') for (const k of Object.keys(f.clean)) if (f.clean[k] === true && LEVEL.has(k)) p.flags.clean[k] = true;
  p.flags.badge = f.badge === true;
  if (Array.isArray(f.fresh)) p.flags.fresh = f.fresh.filter(k => typeof k === 'string' && p.unlocks.items.includes(k));
  if (Array.isArray(f.pendingBuild)) p.flags.pendingBuild = [...new Set(f.pendingBuild.filter(w => p.mastered.includes(w)))];
  p.flags.devUnlockAll = f.devUnlockAll === true;
  p.flags.lastFree = typeof f.lastFree === 'string' ? f.lastFree.slice(0, 40) : '';
  return p;
}
function tierFor(mastered) {
  let t = 1;
  for (const T of TIERS) if (T.world < 0 || mastered.includes(T.world)) t = Math.max(t, T.tier);
  return t;
}
function earnedItems(mastered) {
  const out = [];
  for (const row of UNLOCKS) if (mastered.includes(row.world)) out.push(...row.items);
  return out;
}

/* ---- storage + migration --------------------------------------------------------- */
function migrate() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem(OLD_CAMP_KEY) || 'null'); } catch (e) {}
  const p = blank();
  if (!old || typeof old !== 'object') return p;
  // step-6 saves knew "done" and "no mistakes", not hints: done = 1 charge, clean = 2
  for (const id of Object.keys(old.done || {})) {
    const L = LEVEL.get(id);
    if (!L || !old.done[id]) continue;
    p.levels[id] = L.k === 0 ? 0 : (old.clean && old.clean[id] ? 2 : 1);
  }
  p.flags.skip = { ...(old.skip || {}) };
  p.flags.clean = { ...(old.clean || {}) };
  p.unlocks.fillNotes = !!(old.unlock && old.unlock.fillNotes);
  return validate(p);
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(PROFILE_KEY); } catch (e) {}
  if (raw) { try { return validate(JSON.parse(raw)); } catch (e) {} }
  const p = migrate();
  P = p; save();
  return p;
}
let P = blank();
function save() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(P)); } catch (e) {} }
P = load();

const listeners = [];
export function onProfile(fn) { listeners.push(fn); }
function notify() {
  regate();
  for (const fn of listeners) { try { fn(getProfile()); } catch (e) { console.error(e); } }
}
export const getProfile = () => JSON.parse(JSON.stringify(P));
export function setProfile(obj) {
  P = validate(obj);
  save(); notify();
  return getProfile();
}
/** Save after an in-place change (campaign.js store view). */
export function saveProfile() { P = validate(P); save(); notify(); }

/* ---- the campaign store view (campaign.js reads / writes through it) ---------- */
export function campStore() {
  return {
    get done() { const d = {}; for (const id of Object.keys(P.levels)) d[id] = true; return d; },
    get clean() { return P.flags.clean; },
    get skip() { return P.flags.skip; },
    get unlock() { return P.unlocks; }
  };
}
/** A level finished (Level 0 outro, or a solved level): done, with 0 charges if new. */
export function markLevelDone(id, clean) {
  if (!LEVEL.has(id)) return;
  if (!(id in P.levels)) P.levels[id] = 0;
  if (clean) P.flags.clean[id] = true;
  saveProfile();
}

/* ---- queries --------------------------------------------------------------------- */
export const best = id => (id in P.levels ? P.levels[id] : -1);       // -1 = never done
export const isMastered = w => P.mastered.includes(w);
export const isWorldOpen = w => WORLD_IDS.includes(w) && (w === WORLD_IDS[0] || isMastered(w - 1) || P.flags.devUnlockAll);
export function gateEarned(w) {
  return levelIds(w).slice(1, 13).reduce((a, id) => a + Math.max(0, best(id)), 0);
}
export const isMasterOpen = w => gateEarned(w) >= MASTER_GATE || isMastered(w) || P.flags.devUnlockAll;
export function worldEarned(w) { return levelIds(w).slice(1).reduce((a, id) => a + Math.max(0, best(id)), 0); }
export function worldStats(w) {
  const ids = levelIds(w);
  return {
    world: w, earned: worldEarned(w), available: WORLD_CHARGES, gate: gateEarned(w), gateNeed: MASTER_GATE,
    masterOpen: isMasterOpen(w), mastered: isMastered(w), open: isWorldOpen(w),
    levels: ids.map((id, k) => ({ id, k, best: best(id), done: id in P.levels }))
  };
}
/** Total bar: bright = all earned; dim = available in unlocked (open) worlds; track = every world. */
export function totals() {
  let earned = 0, available = 0;
  for (const w of WORLD_IDS) { earned += worldEarned(w); if (isWorldOpen(w)) available += WORLD_CHARGES; }
  return { earned, available, all: WORLD_IDS.length * WORLD_CHARGES };
}
export function expertise() {
  const e = P.expertise, T = TIERS.find(t => t.tier === e.tier) || TIERS[0];
  const perInner = T.perInner, into = e.points - (e.inner - 1) * perInner;
  return { tier: e.tier, name: T.name, inner: e.inner, points: e.points, perInner,
    progress: e.inner >= INNER_MAX ? 1 : Math.max(0, Math.min(1, into / perInner)) };
}

/* ---- unlocks ---------------------------------------------------------------------- */
export function lockWorld(kind, id) {
  for (const row of UNLOCKS) for (const it of row.items) if (it.kind === kind && it.id === id) return row.world;
  return null;
}
export function isUnlocked(kind, id) {
  if (P.flags.devUnlockAll) return true;
  if ((FREE_ITEMS[kind] || []).includes(id)) return true;
  if (P.unlocks.items.includes(kind + ':' + id)) return true;
  return lockWorld(kind, id) === null;     // not in the table = never locked
}
const STYLE_NAMES = { sa: 'SA Retro', cherry: 'Cherry OEM', lp: 'Low-profile' };
export const itemName = it => {
  if (it.kind === 'style') return STYLE_NAMES[it.id] || (STYLES.find(x => x.id === it.id) || { name: it.id }).name;
  if (it.kind === 'layout') { const l = LAYOUTS.find(x => x.id === it.id); return l ? l.name : it.id; }
  const p = PRESETS.find(x => x.id === it.id); return p ? p.name : it.id;
};
export const itemsFor = w => (UNLOCKS.find(r => r.world === w) || { items: [] }).items;
export function setDevUnlockAll(on) { P.flags.devUnlockAll = !!on; saveProfile(); }
export function clearBadge() { if (P.flags.badge) { P.flags.badge = false; saveProfile(); } }
export function clearFresh() { if (P.flags.fresh.length) { P.flags.fresh = []; saveProfile(); } }
export function takePendingBuild() {
  const b = P.flags.pendingBuild.slice();
  if (b.length) { P.flags.pendingBuild = []; save(); }
  return b;
}
/* Settings refuse locked items (old saves fall back to the defaults). */
settingsGate.allow = (kind, id) => isUnlocked(kind, id);
function regate() {
  const s = getSettings();
  if (s.style === 'classic') return;
  if (!isUnlocked('style', s.style) || !isUnlocked('layout', s.layout) || !isUnlocked('preset', s.preset)) setSettings({});
}

/* ---- recording a solve --------------------------------------------------------------- */
let lastResult = null;
export const getLastResult = () => lastResult;

export function recordSolved(d) {
  const L = LEVEL.get(d.id);
  const before = { mastered: P.mastered.slice(), exp: { ...P.expertise }, world: L ? worldEarned(L.world) : 0, gate: L ? gateEarned(L.world) : 0, total: totals().earned };
  let prev = -1, nb = -1, masteredNow = null, items = [];
  if (L) {
    prev = best(d.id);
    nb = Math.max(prev, L.k === 0 ? 0 : d.charges | 0);
    P.levels[d.id] = nb;
    if (L.k === 13 && nb >= 1 && !P.mastered.includes(L.world)) {
      masteredNow = L.world;
      P.mastered = [...P.mastered, L.world].sort((a, b) => a - b);
      items = itemsFor(L.world);
      if (items.length) { P.flags.badge = true; P.flags.fresh = [...new Set([...P.flags.fresh, ...items.map(itemKey)])]; }
      P.flags.pendingBuild = [...new Set([...P.flags.pendingBuild, L.world])];
    }
  }
  // expertise: clean solves, weighted by world (a campaign level counts the first time it is clean)
  let gained = 0;
  if (d.clean) {
    const counts = L ? prev < CHARGES_PER_LEVEL : d.id !== P.flags.lastFree;
    if (counts) gained = (d.world | 0) + 1;
    if (!L) P.flags.lastFree = d.id;
  }
  if (gained) {
    const e = P.expertise, T = TIERS.find(t => t.tier === e.tier) || TIERS[0];
    e.points += gained;
    e.inner = Math.max(e.inner, Math.min(INNER_MAX, 1 + Math.floor(e.points / T.perInner)));
  }
  const t = tierFor(P.mastered);
  if (t > P.expertise.tier) P.expertise = { tier: t, inner: 1, points: 0 };
  P = validate(P);
  save();
  lastResult = {
    id: d.id, level: !!L, world: L ? L.world : d.world, k: L ? L.k : -1, charges: d.charges, prev, best: nb,
    delta: L ? Math.max(0, nb - Math.max(0, prev)) : 0,
    worldBefore: before.world, worldAfter: L ? worldEarned(L.world) : 0,
    gateBefore: before.gate, gateAfter: L ? gateEarned(L.world) : 0,
    masterOpenedNow: !!(L && before.gate < MASTER_GATE && gateEarned(L.world) >= MASTER_GATE),
    masteredNow, items: items.map(it => ({ ...it, name: itemName(it) })),
    expBefore: before.exp, expAfter: { ...P.expertise }, gained
  };
  notify();
  return lastResult;
}

export function initProfile() {
  document.addEventListener('sudoku:solved', e => { try { recordSolved(e.detail); } catch (err) { console.error(err); } });
}

