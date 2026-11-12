// puzzles.js — the shipped puzzle stock (data/puzzles.json, embedded by the
// build as the virtual module './puzzles-data.js'), lookup by id, and the
// board a puzzle starts from.
import { DATA } from './puzzles-data.js';
import { parseGrid, computeCands, findSolution } from './solver.js';
import { decodeCands, BANDS, dailyIndex } from './shared.js';

/* The feel prototype's fixed puzzle, for the parity test (#p=proto). DEV only. */
export const PROTO = {
  id: 'proto',
  givens: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  solution: '534678912672195348198342567859761423426853791713924856961537284287419635345286179'
};

const SPOT_LABEL = ['full house', 'hidden single', 'naked single', 'pointing / claiming', 'pair'];

const byId = new Map();     // id -> { item, kind, world, band, index, list }
function add(list, kind, extra) {
  list.forEach((item, index) => byId.set(item.id, { item, kind, index, list, ...extra }));
}
add([PROTO], 'proto', {});
for (const w of DATA.worlds) {
  add(w.spotIt, 'spotIt', { world: w.world });
  add(w.useIt, 'useIt', { world: w.world });
  add(w.master, 'master', { world: w.world });
}
for (const b of BANDS) add(DATA.quick[b] || [], 'quick', { band: b });
add(DATA.daily, 'daily', {});

export const has = id => byId.has(id);
export const entry = id => byId.get(id) || null;
export const allIds = () => [...byId.keys()].filter(id => id !== 'proto');
export const worlds = DATA.worlds;
export const quick = DATA.quick;
export const daily = DATA.daily;
export const todayDailyId = (date) => DATA.daily[dailyIndex(date) % DATA.daily.length].id;

const toArr = s => Int8Array.from(parseGrid(s));

/* Solution of an item: stored, or found again (solutionsOmitted), or for a
   Spot it snapshot, the solution of the puzzle it was taken from. */
export function solutionOf(id) {
  const e = entry(id);
  if (!e) return null;
  if (e.kind === 'spotIt') return solutionOf(e.item.source);
  if (e.item.solution) return toArr(e.item.solution);
  const s = findSolution(parseGrid(e.item.givens));
  return s ? Int8Array.from(s) : null;
}

/* Everything game.js needs to start a puzzle:
   { id, mode, kind, world, given, values, notes, sol, step?, label? } */
export function boardFor(id) {
  const e = entry(id);
  if (!e) return null;
  const sol = solutionOf(id);
  if (e.kind === 'spotIt') {
    const values = toArr(e.item.values);
    const notes = e.item.cands ? decodeCands(e.item.cands) : computeCands(values);
    return { id, mode: 'spot', kind: e.kind, world: e.world, given: values.slice(), values, notes, sol, step: e.item.step, label: SPOT_LABEL[e.world] };
  }
  const given = toArr(e.item.givens);
  return { id, mode: 'free', kind: e.kind, world: e.world ?? -1, given, values: given.slice(), notes: new Uint16Array(81), sol };
}

/* Next item in the same list (wraps), for the Next keycap. */
export function nextId(id) {
  const e = entry(id);
  if (!e) return null;
  return e.list[(e.index + 1) % e.list.length].id;
}

export function modeLabel(id) {
  const e = entry(id);
  if (!e) return '';
  switch (e.kind) {
    case 'spotIt': return `W${e.world} Spot it`;
    case 'useIt': return `W${e.world} Use it`;
    case 'master': return `W${e.world} Master`;
    case 'quick': return `Quick ${e.band}`;
    case 'daily': return `Daily ${e.item.band}`;
    default: return 'Prototype';
  }
}
