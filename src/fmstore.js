// fmstore.js — Free Mode data (Quick Play + Daily), one JSON object persisted
// under localStorage 'sudoku.free.v1' (best effort, try/catch). Plain JSON so
// the progress token v2 can serialize it later.
//
//   getFreeModeState()      → a deep copy
//   setFreeModeState(obj)   → cleans, stores, returns a copy
//
// Shape:
//   { v: 1,
//     played:  { <band>: [ids] }   Quick Play ids handed out since the band's last reshuffle
//     solved:  { <band>: [ids] }   Quick Play ids ever solved (solved count = length)
//     best:    { <band>: ms }      best Quick Play time per band
//     current: { <band>: id }      the band's puzzle in progress (resumed from its card)
//     clock:   { <id>: ms }        elapsed play time of unfinished puzzles
//     daily: { solved: { <day>: ms },   first-solve time per day number (days since DAILY_EPOCH, no wrap)
//              late:   { <day>: 1 },    solved, but not on its own day (never counts for the streak)
//              streak, lastDay },       lastDay = day number of the last streak solve (-1 = none)
//     feedback: 'instant' | 'conflicts' | 'nothing',   Free Mode only; default 'conflicts'
//     challenge: false }                "Challenge me": bands beyond the mastered worlds
import { BANDS } from './shared.js';

export const FM_KEY = 'sudoku.free.v1';
export const FEEDBACK = ['instant', 'conflicts', 'nothing'];

const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const ids = a => (Array.isArray(a) ? a.filter(x => typeof x === 'string') : []);
const num = x => (typeof x === 'number' && isFinite(x) && x >= 0 ? x : null);

export function emptyState() {
  const per = f => Object.fromEntries(BANDS.map(b => [b, f()]));
  return {
    v: 1, played: per(() => []), solved: per(() => []), best: {}, current: {}, clock: {},
    daily: { solved: {}, late: {}, streak: 0, lastDay: -1 },
    feedback: 'conflicts', challenge: false
  };
}

function clean(o) {
  const s = emptyState();
  if (!isObj(o)) return s;
  for (const b of BANDS) {
    if (isObj(o.played)) s.played[b] = [...new Set(ids(o.played[b]))];
    if (isObj(o.solved)) s.solved[b] = [...new Set(ids(o.solved[b]))];
    if (isObj(o.best) && num(o.best[b]) != null) s.best[b] = o.best[b];
    if (isObj(o.current) && typeof o.current[b] === 'string') s.current[b] = o.current[b];
  }
  if (isObj(o.clock)) for (const k in o.clock) if (num(o.clock[k]) != null) s.clock[k] = o.clock[k];
  const d = o.daily;
  if (isObj(d)) {
    if (isObj(d.solved)) for (const k in d.solved) if (/^\d+$/.test(k) && num(d.solved[k]) != null) s.daily.solved[k] = d.solved[k];
    if (isObj(d.late)) for (const k in d.late) if (/^\d+$/.test(k) && d.late[k]) s.daily.late[k] = 1;
    if (num(d.streak) != null) s.daily.streak = Math.floor(d.streak);
    if (typeof d.lastDay === 'number' && isFinite(d.lastDay)) s.daily.lastDay = Math.floor(d.lastDay);
  }
  if (FEEDBACK.includes(o.feedback)) s.feedback = o.feedback;
  s.challenge = o.challenge === true;
  return s;
}

let cur = null;
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(FM_KEY) || 'null'); } catch (e) {}
  return clean(raw);
}

export function getFreeModeState() {
  if (!cur) cur = load();
  return JSON.parse(JSON.stringify(cur));
}
export function setFreeModeState(obj) {
  cur = clean(obj);
  try { localStorage.setItem(FM_KEY, JSON.stringify(cur)); } catch (e) {}
  return getFreeModeState();
}
/** Read-modify-write helper: fn(state) mutates a copy, which is then stored. */
export function updateFreeModeState(fn) {
  const s = getFreeModeState();
  fn(s);
  return setFreeModeState(s);
}
