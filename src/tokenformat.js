// tokenformat.js — the BACKUP CODE format (SDK2): the player's whole profile,
// settings, Free Mode data and the puzzle in progress as one compact, versioned
// binary payload inside the tokencodec envelope. Pure: no DOM, no storage, no
// clock. The shipped puzzle data is passed in, so Node tests can use it too.
// Every byte is documented in docs/token.md (keep the two in step).
//
//   const F = makeFormat(DATA);
//   F.encode(snap)      → 'SDK2.…'            (deterministic: same snap, same code)
//   F.decode(text)      → { kind: 'v2', snap } | { kind: 'sdk1', board }   or throws CodeError
//   F.pack(snap) / F.unpack(bytes)            the payload alone (version byte + RLE body)
//
// `snap` (the "token domain"; decode always returns this canonical shape):
//   { levels: { <level id>: charges },   Level 0 ids → 0 (done); other levels 1..3 (0 = not done, dropped)
//     skip: [w], mastered: [w], pendingBuild: [w],                     sorted world numbers
//     expertise: { tier, inner, points },
//     fillNotes, badge, devUnlockAll: booleans,
//     lastFree: id | '',
//     settings: { style, layout, preset, sound, switchVol },          switchVol in 0.01 steps
//     free: { played: {band: [ids]}, solved: {band: [ids]}, best: {band: ms}, current: {band: id},
//             feedback, challenge,
//             daily: { solved: {day: ms}, late: {day: 1}, streak, lastDay, older } },
//     last: id | '',                     the puzzle Continue resumes (a shipped puzzle or a Level 0 'wN-l0')
//     board: null | { values: [81], notes: [81], mistakes, paidHints, silentWrong, elapsed } }   elapsed in ms
import { seal, unseal, saltFor, rle, unrle, squeeze, CodeError, puzzleTag } from './tokencodec.js';
import { UNLOCKS, FREE_ITEMS, TIERS, INNER_MAX, CHARGES_PER_LEVEL } from './progcfg.js';

export const PREFIX = 'SDK2.';
export const FORMAT_VERSION = 2;
export const WORLD_SLOTS = 16, LEVEL_SLOTS = 14, QUICK_SLOTS = 150, DAILY_WINDOW = 64;
export const QBYTES = Math.ceil(QUICK_SLOTS / 8);          // 19
export const BANDS_F = ['gentle', 'easy', 'medium', 'tricky'];
// Enum tables owned by the format: changing an order needs a new FORMAT_VERSION.
export const STYLES_F = ['sa', 'cherry', 'lp'];
export const LAYOUTS_F = ['plain', 'checker'];
export const PRESETS_F = ['retro', 'ink', 'mint', 'rose', 'ocean', 'forest'];
export const FEEDBACK_F = ['instant', 'conflicts', 'nothing'];
const KIND = { spotIt: 1, useIt: 2, master: 3, quick: 4, daily: 5, level0: 6 };
const NONE16 = 0xFFFF;

export const MESSAGES = {
  empty: 'Paste a backup code first.',
  notcode: "That isn't a backup code.",
  damaged: 'This code is damaged or was edited.',
  newer: 'This code is from a newer version — update the game first.',
  puzzle: "This code is for a puzzle this version doesn't have."
};
const fail = code => { throw new CodeError(code, MESSAGES[code]); };

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const cmp = (a, b) => a - b;

/* ---- byte writer / reader ---------------------------------------------------------- */
class W {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 0xFF); }
  u16(v) { this.b.push(v >>> 8 & 0xFF, v & 0xFF); }
  bytes(a) { for (const x of a) this.b.push(x & 0xFF); }
}
class R {
  constructor(b) { this.b = b; this.i = 0; }
  need(n) { if (this.i + n > this.b.length) fail('damaged'); }
  u8() { this.need(1); return this.b[this.i++]; }
  u16() { this.need(2); const v = (this.b[this.i] << 8) | this.b[this.i + 1]; this.i += 2; return v; }
  bytes(n) { this.need(n); const a = this.b.slice(this.i, this.i + n); this.i += n; return a; }
}
/* bit i of a bitset lives in byte i>>3, MSB first */
const getBit = (a, i) => (a[i >> 3] >> (7 - (i & 7))) & 1;
const setBit = (a, i) => { a[i >> 3] |= 1 << (7 - (i & 7)); };
const popcount = a => { let n = 0; for (const x of a) { let v = x; while (v) { n += v & 1; v >>= 1; } } return n; };

export function makeFormat(DATA) {
  /* ---- catalogues from the shipped data --------------------------------------------- */
  const worldOk = W => !!(W && W.spotIt.length >= 6 && W.useIt.length >= 6 && W.master.length);
  const WORLD = new Map();
  for (const W of DATA.worlds) if (worldOk(W) && W.world < WORLD_SLOTS) WORLD.set(W.world, W);
  const WORLD_IDS = [...WORLD.keys()].sort(cmp);
  const levelIds = w => {
    const W = WORLD.get(w);
    return W ? [`w${w}-l0`, ...W.spotIt.slice(0, 6).map(x => x.id), ...W.useIt.slice(0, 6).map(x => x.id), W.master[0].id] : [];
  };
  const LEVEL = new Map();                 // id -> {world, k}
  for (const w of WORLD_IDS) levelIds(w).forEach((id, k) => LEVEL.set(id, { world: w, k }));

  const REF = new Map();                   // id -> {kind, sub, index}
  const POOL = (kind, sub) => {
    if (kind === KIND.spotIt || kind === KIND.useIt || kind === KIND.master) {
      const W = DATA.worlds.find(x => x.world === sub);
      return W ? (kind === KIND.spotIt ? W.spotIt : kind === KIND.useIt ? W.useIt : W.master) : null;
    }
    if (kind === KIND.quick) return BANDS_F[sub] ? DATA.quick[BANDS_F[sub]] || [] : null;
    if (kind === KIND.daily) return sub === 0 ? DATA.daily : null;
    return null;
  };
  for (const W of DATA.worlds) {
    if (W.world >= WORLD_SLOTS) continue;
    W.spotIt.forEach((x, i) => REF.set(x.id, { kind: KIND.spotIt, sub: W.world, index: i, item: x }));
    W.useIt.forEach((x, i) => REF.set(x.id, { kind: KIND.useIt, sub: W.world, index: i, item: x }));
    W.master.forEach((x, i) => REF.set(x.id, { kind: KIND.master, sub: W.world, index: i, item: x }));
  }
  BANDS_F.forEach((b, s) => (DATA.quick[b] || []).forEach((x, i) => REF.set(x.id, { kind: KIND.quick, sub: s, index: i, item: x })));
  DATA.daily.forEach((x, i) => REF.set(x.id, { kind: KIND.daily, sub: 0, index: i, item: x }));
  const QLIST = BANDS_F.map(b => (DATA.quick[b] || []).slice(0, QUICK_SLOTS));
  const QINDEX = BANDS_F.map((b, s) => new Map(QLIST[s].map((x, i) => [x.id, i])));
  const givensOf = id => { const r = REF.get(id); if (!r) return null; const g = r.kind === KIND.spotIt ? r.item.values : r.item.givens; return Array.from(g, c => +c); };
  const isShipped = id => REF.has(id);
  const isL0 = id => /^w(\d+)-l0$/.test(id) && WORLD.has(+id.slice(1, -3));
  const isFreeId = id => { const r = REF.get(id); return !!r && (r.kind === KIND.quick || r.kind === KIND.daily); };

  function writeRef(w, id) {
    if (id && isL0(id)) { w.u8((KIND.level0 << 4) | +id.slice(1, -3)); w.u16(0); return; }
    const r = id ? REF.get(id) : null;
    if (!r) { w.u8(0); w.u16(0); return; }
    w.u8((r.kind << 4) | r.sub); w.u16(r.index);
  }
  /** returns id, '' (none); records 'puzzle' / 'newer' problems in `bad` */
  function readRef(rd, bad) {
    const k = rd.u8(), index = rd.u16(), kind = k >> 4, sub = k & 15;
    if (k === 0) { if (index) fail('damaged'); return ''; }
    if (kind === KIND.level0) {
      if (index) fail('damaged');
      if (!WORLD.has(sub)) { bad.add('newer'); return ''; }
      return `w${sub}-l0`;
    }
    if (kind < 1 || kind > 5) fail('damaged');
    if ((kind === KIND.quick && sub > 3) || (kind === KIND.daily && sub !== 0)) fail('damaged');
    const list = POOL(kind, sub);
    if (!list || index >= list.length) { bad.add('puzzle'); return ''; }
    return list[index].id;
  }

  /* ---- unlock rule for the settings check (same table as profile.js) ------------------ */
  const unlockWorld = (kind, id) => { for (const row of UNLOCKS) for (const it of row.items) if (it.kind === kind && it.id === id) return row.world; return null; };
  function unlocked(kind, id, mastered, dev) {
    if (dev || (FREE_ITEMS[kind] || []).includes(id)) return true;
    const w = unlockWorld(kind, id);
    return w === null || mastered.includes(w);
  }
  const tierFor = mastered => { let t = 1; for (const T of TIERS) if (T.world < 0 || mastered.includes(T.world)) t = Math.max(t, T.tier); return t; };
  const perInner = tier => (TIERS.find(t => t.tier === tier) || TIERS[0]).perInner;

  /* ================================================================================
     PACK
     ================================================================================ */
  function pack(snap) {
    const w = new W();
    const s = snap.settings || {}, f = snap.free || {}, d = f.daily || {};
    const last = snap.last && (isShipped(snap.last) || isL0(snap.last)) ? snap.last : '';
    const board = snap.board && last && isShipped(last) ? snap.board : null;
    let flags = 0;
    if (board) flags |= 1;
    if (snap.fillNotes) flags |= 2;
    if (snap.badge) flags |= 4;
    if (snap.devUnlockAll) flags |= 8;
    if (f.challenge) flags |= 16;
    if (s.sound !== false) flags |= 32;
    w.u8(flags);
    // campaign: 224 two-bit slots, world-major
    const lv = new Uint8Array(WORLD_SLOTS * LEVEL_SLOTS / 4);
    const put = (slot, v) => { lv[slot >> 2] |= (v & 3) << (6 - 2 * (slot & 3)); };
    const skip = new Set((snap.skip || []).map(Number));
    for (const w0 of WORLD_IDS) {
      const ids = levelIds(w0);
      let v0 = (ids[0] in (snap.levels || {})) ? 1 : 0;
      if (skip.has(w0)) v0 |= 2;
      put(w0 * LEVEL_SLOTS, v0);
      for (let k = 1; k < LEVEL_SLOTS; k++) put(w0 * LEVEL_SLOTS + k, clampInt((snap.levels || {})[ids[k]] || 0, 0, CHARGES_PER_LEVEL));
    }
    w.bytes(lv);
    const mask = arr => (arr || []).reduce((m, x) => (WORLD.has(+x) ? m | (1 << +x) : m), 0);
    w.u16(mask(snap.mastered)); w.u16(mask(snap.pendingBuild));
    const e = snap.expertise || {};
    w.u8(clampInt(e.tier || 1, 1, 255)); w.u8(clampInt(e.inner || 1, 1, 255)); w.u16(clampInt(e.points || 0, 0, 0xFFFF));
    writeRef(w, isFreeId(snap.lastFree) ? snap.lastFree : '');
    writeRef(w, last);
    // settings
    const ix = (tab, v, dflt) => { const i = tab.indexOf(v); return i < 0 ? dflt : i; };
    w.u8((ix(STYLES_F, s.style, 0) << 6) | (ix(LAYOUTS_F, s.layout, 0) << 5) | (ix(PRESETS_F, s.preset, 0) << 2) | ix(FEEDBACK_F, f.feedback, 1));
    w.u8(clampInt((s.switchVol ?? 0.8) * 100, 0, 100));
    // Free Mode, per band
    BANDS_F.forEach((b, sb) => {
      for (const field of ['solved', 'played']) {
        const bs = new Uint8Array(QBYTES);
        for (const id of ((f[field] || {})[b] || [])) { const i = QINDEX[sb].get(id); if (i != null) setBit(bs, i); }
        w.bytes(bs);
      }
      const best = (f.best || {})[b];
      w.u16(typeof best === 'number' && isFinite(best) && best >= 0 ? clampInt(best / 1000, 1, 0xFFFF) : 0);
      const cur = (f.current || {})[b], ci = cur != null ? QINDEX[sb].get(cur) : null;
      w.u16(ci != null ? ci + 1 : 0);
    });
    // Daily
    const solvedDays = Object.keys(d.solved || {}).filter(k => /^\d+$/.test(k)).map(Number).filter(x => x <= 0xFFFE);
    const lastDay = typeof d.lastDay === 'number' && d.lastDay >= 0 && d.lastDay <= 0xFFFE ? Math.floor(d.lastDay) : -1;
    let anchor = solvedDays.length ? Math.max(...solvedDays) : -1;
    if (lastDay > anchor) anchor = lastDay;
    const sb64 = new Uint8Array(8), lb64 = new Uint8Array(8);
    let inWin = 0;
    for (const day of solvedDays) {
      const off = anchor - day;
      if (off < DAILY_WINDOW) { setBit(sb64, off); inWin++; if ((d.late || {})[day]) setBit(lb64, off); }
    }
    const total = Math.min(0xFFFF, solvedDays.length + clampInt(d.older || 0, 0, 0xFFFF));
    w.u16(clampInt(d.streak || 0, 0, 0xFFFF));
    w.u16(lastDay < 0 ? NONE16 : lastDay);
    w.u16(anchor < 0 ? NONE16 : anchor);
    const am = anchor >= 0 ? (d.solved || {})[anchor] : null;
    w.u16(typeof am === 'number' && isFinite(am) && am >= 0 ? clampInt(am / 1000, 0, 0xFFFF) : 0);
    w.u16(Math.max(total, inWin));
    w.bytes(sb64); w.bytes(lb64);
    // the puzzle in progress
    if (board) {
      const g = givensOf(last);
      const vals = new Uint8Array(41);
      for (let i = 0; i < 81; i++) { const v = g[i] || clampInt(board.values[i] || 0, 0, 9); vals[i >> 1] |= v << ((i & 1) ? 0 : 4); }
      w.bytes(vals);
      const notes = new Uint8Array(92);
      for (let i = 0; i < 81; i++) {
        const filled = g[i] || board.values[i];
        const n = filled ? 0 : (board.notes[i] & 0x1FF);
        for (let k = 0; k < 9; k++) if (n & (1 << (8 - k))) setBit(notes, i * 9 + k);
      }
      w.bytes(notes);
      w.u16(clampInt(board.mistakes || 0, 0, 0xFFFF));
      w.u8(clampInt(board.paidHints || 0, 0, 255));
      w.u16(clampInt(board.silentWrong || 0, 0, 0xFFFF));
      w.u16(clampInt((board.elapsed || 0) / 1000, 0, 0xFFFF));
    }
    const body = rle(Uint8Array.from(w.b));
    const out = new Uint8Array(body.length + 1);
    out[0] = FORMAT_VERSION; out.set(body, 1);
    return out;
  }

  /* ================================================================================
     UNPACK + VALIDATE (throws CodeError: damaged | newer | puzzle)
     ================================================================================ */
  function unpack(payload) {
    if (!payload || payload.length < 2) fail('damaged');
    const ver = payload[0];
    if (ver > FORMAT_VERSION) fail('newer');
    if (ver !== FORMAT_VERSION) fail('damaged');
    const body = unrle(payload.subarray(1));
    if (!body) fail('damaged');
    const rd = new R(body), bad = new Set();
    const snap = { levels: {}, skip: [], mastered: [], pendingBuild: [], expertise: null, fillNotes: false, badge: false, devUnlockAll: false,
      lastFree: '', settings: null, free: null, last: '', board: null };
    const flags = rd.u8();
    if (flags & 0xC0) fail('damaged');
    const hasBoard = !!(flags & 1);
    snap.fillNotes = !!(flags & 2); snap.badge = !!(flags & 4); snap.devUnlockAll = !!(flags & 8);
    // campaign
    const lv = rd.bytes(WORLD_SLOTS * LEVEL_SLOTS / 4);
    const slot = i => (lv[i >> 2] >> (6 - 2 * (i & 3))) & 3;
    for (let w0 = 0; w0 < WORLD_SLOTS; w0++) {
      const ids = levelIds(w0);
      for (let k = 0; k < LEVEL_SLOTS; k++) {
        const v = slot(w0 * LEVEL_SLOTS + k);
        if (!v) continue;
        if (!ids.length) { bad.add('newer'); continue; }
        if (k === 0) { if (v & 1) snap.levels[ids[0]] = 0; if (v & 2) snap.skip.push(w0); }
        else snap.levels[ids[k]] = v;
      }
    }
    const mm = rd.u16(), pm = rd.u16();
    for (let w0 = 0; w0 < WORLD_SLOTS; w0++) {
      if (mm & (1 << w0)) { if (WORLD.has(w0)) snap.mastered.push(w0); else bad.add('newer'); }
      if (pm & (1 << w0)) { if (!(mm & (1 << w0))) fail('damaged'); if (WORLD.has(w0)) snap.pendingBuild.push(w0); }
    }
    for (const w0 of WORLD_IDS) if ((snap.levels[levelIds(w0)[13]] || 0) >= 1 && !snap.mastered.includes(w0)) fail('damaged');
    const tier = rd.u8(), inner = rd.u8(), points = rd.u16();
    if (tier < 1 || inner < 1 || inner > INNER_MAX) fail('damaged');
    if (tier > TIERS.length) bad.add('newer');
    else {
      if (tier < tierFor(snap.mastered)) fail('damaged');
      if (inner < Math.min(INNER_MAX, 1 + Math.floor(points / perInner(tier)))) fail('damaged');
    }
    snap.expertise = { tier, inner, points };
    snap.lastFree = readRef(rd, bad);
    if (snap.lastFree && !isFreeId(snap.lastFree)) fail('damaged');
    snap.last = readRef(rd, bad);
    // settings
    const sb = rd.u8(), vol = rd.u8();
    const si = sb >> 6, li = (sb >> 5) & 1, pi = (sb >> 2) & 7, fi = sb & 3;
    if (si >= STYLES_F.length || pi >= PRESETS_F.length || fi >= FEEDBACK_F.length || vol > 100) fail('damaged');
    snap.settings = { style: STYLES_F[si], layout: LAYOUTS_F[li], preset: PRESETS_F[pi], sound: !!(flags & 32), switchVol: vol / 100 };
    for (const [kind, id] of [['style', snap.settings.style], ['layout', snap.settings.layout], ['preset', snap.settings.preset]])
      if (!unlocked(kind, id, snap.mastered, snap.devUnlockAll)) fail('damaged');
    // Free Mode
    const free = { played: {}, solved: {}, best: {}, current: {}, feedback: FEEDBACK_F[fi], challenge: !!(flags & 16), daily: null };
    BANDS_F.forEach((b, s) => {
      for (const field of ['solved', 'played']) {
        const bs = rd.bytes(QBYTES), out = [];
        for (let i = 0; i < QBYTES * 8; i++) {
          if (!getBit(bs, i)) continue;
          if (i >= QUICK_SLOTS) fail('damaged');
          if (i >= QLIST[s].length) { bad.add('newer'); continue; }
          out.push(QLIST[s][i].id);
        }
        free[field][b] = out;
      }
      const best = rd.u16(), cur = rd.u16();
      if (best) free.best[b] = best * 1000;
      if (cur) {
        if (cur > QUICK_SLOTS) fail('damaged');
        if (cur > QLIST[s].length) bad.add('newer'); else free.current[b] = QLIST[s][cur - 1].id;
      }
    });
    const streak = rd.u16(), lastDay = rd.u16(), anchor = rd.u16(), anchorSecs = rd.u16(), total = rd.u16();
    const sb64 = rd.bytes(8), lb64 = rd.bytes(8);
    const daily = { solved: {}, late: {}, streak, lastDay: lastDay === NONE16 ? -1 : lastDay, older: 0 };
    const inWin = popcount(sb64);
    for (let i = 0; i < 8; i++) if (lb64[i] & ~sb64[i]) fail('damaged');
    if (anchor === NONE16) {
      if (inWin || anchorSecs || total || lastDay !== NONE16) fail('damaged');
    } else {
      if (lastDay !== NONE16 && lastDay > anchor) fail('damaged');
      if (total < inWin) fail('damaged');
      if (anchorSecs && !getBit(sb64, 0)) fail('damaged');
      for (let off = 0; off < DAILY_WINDOW; off++) {
        if (!getBit(sb64, off)) continue;
        const day = anchor - off;
        if (day < 0) fail('damaged');
        daily.solved[day] = off === 0 ? anchorSecs * 1000 : 0;
        if (getBit(lb64, off)) daily.late[day] = 1;
      }
      daily.older = total - inWin;
    }
    if (streak > total) fail('damaged');
    free.daily = daily;
    snap.free = free;
    // the puzzle in progress
    if (hasBoard) {
      const vals = rd.bytes(41), notes = rd.bytes(92);
      const mistakes = rd.u16(), paidHints = rd.u8(), silentWrong = rd.u16(), secs = rd.u16();
      if (vals[40] & 0x0F) fail('damaged');                       // the unused low nibble of the last byte
      for (let i = 729; i < 92 * 8; i++) if (getBit(notes, i)) fail('damaged');
      if (!snap.last) { if (bad.size) bad.add('puzzle'); else fail('damaged'); }
      else if (!isShipped(snap.last)) fail('damaged');           // a Level 0 never carries a board
      else {
        const g = givensOf(snap.last), values = new Array(81), nn = new Array(81);
        let mismatch = false;
        for (let i = 0; i < 81; i++) {
          const v = (vals[i >> 1] >> ((i & 1) ? 0 : 4)) & 0xF;
          if (v > 9) fail('damaged');
          if (g[i] && v !== g[i]) mismatch = true;
          let n = 0;
          for (let k = 0; k < 9; k++) if (getBit(notes, i * 9 + k)) n |= 1 << (8 - k);
          if (v && n) fail('damaged');
          values[i] = v; nn[i] = n;
        }
        if (mismatch) bad.add('puzzle');
        else snap.board = { values, notes: nn, mistakes, paidHints, silentWrong, elapsed: secs * 1000 };
      }
    }
    if (rd.i !== body.length) fail('damaged');
    if (bad.has('newer')) fail('newer');
    if (bad.has('puzzle')) fail('puzzle');
    snap.mastered.sort(cmp); snap.skip.sort(cmp); snap.pendingBuild.sort(cmp);
    return snap;
  }

  /* ================================================================================
     SDK1 (a single board, from before step 9)
     ================================================================================ */
  function sdk1Board(b, preferId) {
    if (b.length !== 208 || b[0] !== 1) fail('damaged');
    const values = new Array(81), notes = new Array(81);
    for (let i = 0; i < 81; i++) {
      const v = (b[5 + (i >> 1)] >> ((i & 1) ? 0 : 4)) & 0xF;
      if (v > 9) fail('damaged');
      values[i] = v;
      const n = (b[46 + i * 2] << 8) | b[47 + i * 2];
      if (n > 0x1FF) fail('damaged');
      notes[i] = v ? 0 : n;
    }
    if (b[45] & 0x0F) fail('damaged');
    // byte 1 is a hash of the puzzle id: find the shipped puzzle(s) with that tag whose givens fit
    let best = null, bestN = -1;
    for (const id of REF.keys()) {
      if (puzzleTag(id) !== b[1]) continue;
      const g = givensOf(id);
      let ok = true, n = 0;
      for (let i = 0; i < 81; i++) if (g[i]) { n++; if (values[i] !== g[i]) { ok = false; break; } }
      if (!ok) continue;
      if (id === preferId) { best = id; break; }
      if (n > bestN) { best = id; bestN = n; }
    }
    if (!best) fail('puzzle');
    return { id: best, values, notes, mistakes: (b[2] << 8) | b[3], solved: b[4] === 1 };
  }

  /* ================================================================================
     STRINGS
     ================================================================================ */
  function encode(snap) {
    const p = pack(snap);
    return seal(PREFIX, p, saltFor(p));
  }
  function decode(text, { preferId = '' } = {}) {
    const t = squeeze(text);
    if (!t) fail('empty');
    const m = /^SDK([1-9]\d{0,2})\./.exec(t);
    if (!m) fail(/^sdk/i.test(t) ? 'damaged' : 'notcode');
    const gen = +m[1];
    if (gen > 2) fail('newer');
    if (gen < 1) fail('damaged');
    const payload = unseal(t.slice(m[0].length));        // CodeError('damaged') on a bad checksum
    if (gen === 1) return { kind: 'sdk1', board: sdk1Board(payload, preferId) };
    return { kind: 'v2', snap: unpack(payload) };
  }

  return {
    pack, unpack, encode, decode, sdk1Board,
    levelIds, WORLD_IDS, isShipped, isL0, isFreeId, givensOf, levelInfo: id => LEVEL.get(id) || null,
    unlocked, tierFor, QLIST
  };
}

/** The message for an error thrown by decode / apply. */
export const messageFor = e => (e && e.code && MESSAGES[e.code]) || MESSAGES.damaged;
