#!/usr/bin/env node
// token-test.mjs — the backup code (SDK2) codec and format, in Node.
//
//   node tools/token-test.mjs [--n 500] [--seed 9]
//
// T1 envelope: strict base64url, RLE (0x00 / 0xFF runs), seal / unseal
// T2 round trip over N random valid states (with and without a board):
//    decode(encode(s)) equals normalize(s) (normalize = the documented quantization)
// T3 every single-character edit of sample codes is rejected or decodes to identical data;
//    truncated / extended / garbage inputs rejected; whitespace inside a pasted code tolerated
// T4 SDK1 codes load as board only; newer codes refused; locked settings refused;
//    out-of-range puzzles and boards that do not match their givens refused
// T5 sizes: fresh / mid-campaign / everything maxed / with a board
// Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFormat, MESSAGES, PREFIX, FORMAT_VERSION, STYLES_F, LAYOUTS_F, PRESETS_F, FEEDBACK_F, BANDS_F, DAILY_WINDOW, QUICK_SLOTS } from '../src/tokenformat.js';
import { seal, unseal, b64u, unb64u, rle, unrle, puzzleTag, saltFor, CodeError } from '../src/tokencodec.js';
import { TIERS, INNER_MAX, UNLOCKS, FREE_ITEMS } from '../src/progcfg.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/puzzles.json'), 'utf8'));
const F = makeFormat(DATA);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const N = arg('--n', 500), SEED = arg('--seed', 9);

let pass = 0, failN = 0;
function test(name, fn) {
  try { const extra = fn(); console.log(`PASS  ${name}${extra ? '  ' + extra : ''}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`); failN++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
function deepEq(a, b, p = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: array mismatch`;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return `${p}: keys ${ka.join()} != ${kb.join()}`;
  for (const k of ka) { const d = deepEq(a[k], b[k], p + '.' + k); if (d) return d; }
  return null;
}
const errCode = fn => { try { fn(); return null; } catch (e) { return e instanceof CodeError ? e.code : 'THROW:' + e.message; } };

/* ---- seeded random ---- */
let rs = SEED >>> 0;
const rnd = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

/* ---- helpers mirroring the profile rules (from progcfg.js) ---- */
const W = F.WORLD_IDS;
const tierFor = m => { let t = 1; for (const T of TIERS) if (T.world < 0 || m.includes(T.world)) t = Math.max(t, T.tier); return t; };
const perInner = t => TIERS.find(x => x.tier === t).perInner;
const unlockW = (kind, id) => { for (const r of UNLOCKS) for (const it of r.items) if (it.kind === kind && it.id === id) return r.world; return null; };
const unlocked = (kind, id, m, dev) => dev || (FREE_ITEMS[kind] || []).includes(id) || unlockW(kind, id) === null || m.includes(unlockW(kind, id));
const allShipped = [...DATA.worlds.flatMap(w => [...w.spotIt, ...w.useIt, ...w.master]), ...BANDS_F.flatMap(b => DATA.quick[b]), ...DATA.daily].map(x => x.id);
const freeIds = [...BANDS_F.flatMap(b => DATA.quick[b]), ...DATA.daily].map(x => x.id);

function blankSnap() {
  return {
    levels: {}, skip: [], mastered: [], pendingBuild: [], expertise: { tier: 1, inner: 1, points: 0 },
    fillNotes: false, badge: false, devUnlockAll: false, lastFree: '',
    settings: { style: 'sa', layout: 'plain', preset: 'retro', sound: true, switchVol: 0.8 },
    free: { played: Object.fromEntries(BANDS_F.map(b => [b, []])), solved: Object.fromEntries(BANDS_F.map(b => [b, []])), best: {}, current: {},
      feedback: 'conflicts', challenge: false, daily: { solved: {}, late: {}, streak: 0, lastDay: -1, older: 0 } },
    last: '', board: null
  };
}
function randomBoard(id) {
  const g = F.givensOf(id), values = [], notes = [];
  for (let i = 0; i < 81; i++) {
    const v = g[i] || (chance(0.35) ? ri(1, 9) : 0);
    values.push(v);
    notes.push(v ? (chance(0.1) ? ri(1, 511) : 0) : (chance(0.5) ? ri(0, 511) : 0));    // stray notes on filled cells are dropped
  }
  return { values, notes, mistakes: ri(0, 6), paidHints: ri(0, 3), silentWrong: ri(0, 5), elapsed: chance(0.2) ? 0 : ri(0, 5400000) + rnd() };
}
function randomSnap() {
  const s = blankSnap();
  const density = rnd();
  for (const w of W) {
    const ids = F.levelIds(w);
    if (chance(density)) s.levels[ids[0]] = 0;
    for (let k = 1; k < 14; k++) if (chance(density)) s.levels[ids[k]] = chance(0.15) ? 0 : ri(1, 3);   // 0 = done without a charge: dropped
    if (chance(0.3)) s.skip.push(w);
  }
  const m = new Set(W.filter(w => (s.levels[F.levelIds(w)[13]] || 0) >= 1));
  for (const w of W) if (chance(0.15)) m.add(w);
  s.mastered = [...m].sort((a, b) => a - b);
  s.pendingBuild = s.mastered.filter(() => chance(0.3));
  const tier = ri(tierFor(s.mastered), TIERS.length);
  const points = chance(0.1) ? ri(0, 70000) : ri(0, 120);
  const minInner = Math.min(INNER_MAX, 1 + Math.floor(Math.min(points, 65535) / perInner(tier)));
  s.expertise = { tier, inner: ri(minInner, INNER_MAX), points };
  s.fillNotes = chance(0.5); s.badge = chance(0.3); s.devUnlockAll = chance(0.1);
  s.lastFree = chance(0.5) ? pick(freeIds) : '';
  const ok = (kind, tab) => tab.filter(id => unlocked(kind, id, s.mastered, s.devUnlockAll));
  s.settings = { style: pick(ok('style', STYLES_F)), layout: pick(ok('layout', LAYOUTS_F)), preset: pick(ok('preset', PRESETS_F)), sound: chance(0.7), switchVol: rnd() };
  for (const b of BANDS_F) {
    const list = DATA.quick[b].map(x => x.id), d = rnd() * rnd();
    s.free.played[b] = list.filter(() => chance(d));
    s.free.solved[b] = list.filter(() => chance(d));
    if (chance(0.15)) s.free.played[b].reverse();                 // order is not kept
    if (chance(0.6)) s.free.best[b] = chance(0.05) ? ri(0, 999) : ri(1000, 7200000);
    if (chance(0.3)) s.free.current[b] = pick(list);
  }
  s.free.feedback = pick(FEEDBACK_F); s.free.challenge = chance(0.3);
  const dl = s.free.daily;
  if (chance(0.7)) {
    const top = ri(0, 3000), n = ri(1, 90);
    for (let k = 0; k < n; k++) {
      const day = Math.max(0, top - (chance(0.7) ? ri(0, 63) : ri(0, 500)));
      dl.solved[day] = ri(30000, 3600000);
      if (chance(0.2)) dl.late[day] = 1;
    }
    const days = Object.keys(dl.solved).map(Number);
    dl.lastDay = chance(0.8) ? pick(days) : -1;
    dl.older = chance(0.3) ? ri(0, 400) : 0;
    dl.streak = ri(0, Math.min(40, days.length + dl.older));
  }
  const r = rnd();
  s.last = r < 0.15 ? '' : r < 0.25 ? `w${pick(W)}-l0` : pick(allShipped);
  if (s.last && F.isShipped(s.last) && chance(0.6)) s.board = randomBoard(s.last);
  return s;
}

/* ---- the documented quantization (written independently of the format) ---- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function normalize(s) {
  const o = blankSnap();
  for (const [id, c] of Object.entries(s.levels)) { const L = F.levelInfo(id); if (L.k === 0) o.levels[id] = 0; else if (c >= 1) o.levels[id] = c; }
  o.skip = [...s.skip].sort((a, b) => a - b);
  o.mastered = [...s.mastered]; o.pendingBuild = [...s.pendingBuild].sort((a, b) => a - b);
  o.expertise = { ...s.expertise, points: Math.min(65535, s.expertise.points) };
  o.fillNotes = s.fillNotes; o.badge = s.badge; o.devUnlockAll = s.devUnlockAll; o.lastFree = s.lastFree;
  o.settings = { ...s.settings, switchVol: Math.round(s.settings.switchVol * 100) / 100 };
  for (const b of BANDS_F) {
    const list = DATA.quick[b].map(x => x.id);
    o.free.played[b] = list.filter(id => s.free.played[b].includes(id));
    o.free.solved[b] = list.filter(id => s.free.solved[b].includes(id));
    if (s.free.best[b] != null) o.free.best[b] = clamp(Math.round(s.free.best[b] / 1000), 1, 65535) * 1000;
    if (s.free.current[b]) o.free.current[b] = s.free.current[b];
  }
  o.free.feedback = s.free.feedback; o.free.challenge = s.free.challenge;
  const d = s.free.daily, days = Object.keys(d.solved).map(Number);
  const anchor = Math.max(-1, d.lastDay, ...days);
  const od = o.free.daily;
  od.streak = d.streak; od.lastDay = d.lastDay; od.older = d.older;
  for (const day of days) {
    if (anchor - day < DAILY_WINDOW) {
      od.solved[day] = day === anchor ? clamp(Math.round(d.solved[day] / 1000), 0, 65535) * 1000 : 0;
      if (d.late[day]) od.late[day] = 1;
    } else od.older++;
  }
  o.last = s.last;
  if (s.board) {
    const g = F.givensOf(s.last);
    o.board = { values: s.board.values.map((v, i) => g[i] || v), notes: s.board.notes.map((n, i) => (g[i] || s.board.values[i]) ? 0 : n),
      mistakes: s.board.mistakes, paidHints: s.board.paidHints, silentWrong: s.board.silentWrong,
      elapsed: clamp(Math.round(s.board.elapsed / 1000), 0, 65535) * 1000 };
  }
  return o;
}

/* ---- low-level helpers to craft payloads ---- */
const body = snap => unrle(F.pack(snap).subarray(1));
const sealV2 = bodyBytes => { const p = Uint8Array.of(FORMAT_VERSION, ...rle(bodyBytes)); return seal(PREFIX, p, saltFor(p)); };
// offsets in the uncompressed body (docs/token.md)
const OFF = { flags: 0, levels: 1, mastered: 57, pending: 59, tier: 61, inner: 62, points: 63, lastFree: 65, last: 68, settings: 71, vol: 72, bands: 73, daily: 73 + 4 * 42, board: 73 + 4 * 42 + 26 };

/* =========================================================================== */
test('T1 base64url is strict and matches Node', () => {
  for (let n = 0; n < 300; n++) {
    const a = Uint8Array.from({ length: ri(0, 60) }, () => ri(0, 255));
    const s = b64u(a);
    assert(s === Buffer.from(a).toString('base64url'), 'b64u differs from Node');
    assert(deepEq(Array.from(unb64u(s)), Array.from(a)) === null, 'unb64u round trip');
    if (s.length % 4 === 2 || s.length % 4 === 3) {           // the last char carries unused bits: any other value is refused
      const last = s[s.length - 1], alt = s.slice(0, -1) + (last === 'A' ? 'B' : 'A');
      const r = unb64u(alt);
      assert(r === null || deepEq(Array.from(r), Array.from(a)) !== null, 'non-canonical alias accepted');
    }
  }
  assert(unb64u('ab=c') === null && unb64u('a') === null && unb64u('ab+c') === null, 'bad chars accepted');
});
test('T1 RLE round trip, canonical only', () => {
  for (let n = 0; n < 2000; n++) {
    const len = ri(0, 700), a = new Uint8Array(len);
    let i = 0;
    while (i < len) { const run = chance(0.5) ? ri(1, 300) : 1, b = chance(0.4) ? 0 : chance(0.3) ? 255 : ri(0, 255); for (let k = 0; k < run && i < len; k++) a[i++] = b; }
    const e = rle(a), d = unrle(e, 1 << 16);
    assert(d && deepEq(Array.from(d), Array.from(a)) === null, 'rle round trip');
  }
  assert(unrle(Uint8Array.of(0, 1, 0, 1)) === null, 'two mergeable runs accepted');
  assert(unrle(Uint8Array.of(0)) === null, 'dangling escape accepted');
  assert(unrle(Uint8Array.of(0, 255, 0, 0)) !== null, 'a 256-run followed by a run must be fine');
  return `(2000 random arrays)`;
});
test('T1 seal / unseal; deterministic SDK2 salt', () => {
  for (let n = 0; n < 200; n++) {
    const p = Uint8Array.from({ length: ri(1, 300) }, () => ri(0, 255));
    const c = seal(PREFIX, p, saltFor(p));
    assert(c === seal(PREFIX, p, saltFor(p)), 'not deterministic');
    assert(deepEq(Array.from(unseal(c.slice(PREFIX.length))), Array.from(p)) === null, 'unseal');
  }
});

/* =========================================================================== */
let samples = [];
test(`T2 round trip over ${N} random valid states`, () => {
  let withBoard = 0, withL0 = 0, maxLen = 0, minLen = 1e9;
  for (let n = 0; n < N; n++) {
    const s = randomSnap();
    const code = F.encode(s);
    assert(code === F.encode(s), 'encode is not deterministic');
    const r = F.decode(code);
    assert(r.kind === 'v2', 'kind');
    const want = normalize(s), d = deepEq(r.snap, want);
    if (d) throw new Error(`state #${n}: ${d}`);
    // a decoded state re-encodes to the same code (fixed point)
    assert(F.encode(r.snap) === code, `state #${n}: re-encode differs`);
    if (s.board) withBoard++;
    if (/-l0$/.test(s.last)) withL0++;
    maxLen = Math.max(maxLen, code.length); minLen = Math.min(minLen, code.length);
    if (n < 40) samples.push(code);
  }
  return `(${withBoard} with a board, ${withL0} with a Level 0 as the last puzzle; ${minLen}-${maxLen} chars)`;
});

/* =========================================================================== */
const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
function editSweep(code) {
  const base = F.decode(code).snap;
  let rejected = 0, same = 0;
  for (let i = 0; i < code.length; i++) {
    for (const ch of ALPH + '+/=!') {
      if (ch === code[i]) continue;
      const t = code.slice(0, i) + ch + code.slice(i + 1);
      let r;
      try { r = F.decode(t); } catch (e) { if (!(e instanceof CodeError)) throw e; rejected++; continue; }
      if (r.kind === 'v2' && deepEq(r.snap, base) === null) { same++; continue; }
      throw new Error(`edit at ${i} ('${code[i]}' -> '${ch}') silently accepted as different data`);
    }
  }
  return { rejected, same };
}
test('T3 every single-character edit is rejected (sample codes)', () => {
  const fresh = F.encode(blankSnap());
  const withBoard = samples.find(c => c.length > 300) || samples[0];
  const out = [];
  for (const c of [fresh, withBoard, samples[1]]) { const r = editSweep(c); out.push(`${c.length} chars: ${r.rejected} rejected, ${r.same} identical`); assert(r.same === 0, 'an edit decoded to identical data'); }
  return '(' + out.join('; ') + ')';
});
test('T3 truncated / extended / garbage rejected; whitespace tolerated', () => {
  const code = samples.find(c => c.length > 300) || samples[0];
  const base = F.decode(code).snap;
  for (let k = 0; k < code.length; k++) assert(errCode(() => F.decode(code.slice(0, k))) !== null, `truncation to ${k} accepted`);
  for (const ch of ALPH) assert(errCode(() => F.decode(code + ch)) !== null, `extension '${ch}' accepted`);
  assert(errCode(() => F.decode(code + code.slice(5))) !== null, 'doubled body accepted');
  const g = ['', '   ', 'hello', 'SDK2.', 'SDK2.!!!!', 'SDK2.AAAA', 'SDK2.' + 'A'.repeat(400), 'sdk2.' + code.slice(5), 'SDK.' + code.slice(5), 'SDK02' + code.slice(4), 'SDK2:' + code.slice(5)];
  for (let n = 0; n < 300; n++) g.push('SDK2.' + Array.from({ length: ri(4, 400) }, () => pick(ALPH.slice(0, 64))).join(''));
  for (const x of g) assert(errCode(() => F.decode(x)) !== null, `garbage accepted: ${x.slice(0, 20)}`);
  assert(errCode(() => F.decode('')) === 'empty' && errCode(() => F.decode('hello')) === 'notcode', 'empty / notcode messages');
  // whitespace and line breaks a paste may add
  const spaced = '  ' + code.replace(/(.{37})/g, '$1\n').replace(/(.{11})/g, '$1 ') + '\t\r\n';
  assert(deepEq(F.decode(spaced).snap, base) === null, 'whitespace inside a code not tolerated');
  assert(deepEq(F.decode(code.replace(/(.{20})/g, '$1​')).snap, base) === null, 'zero-width spaces not tolerated');
  return `(${code.length} truncations, ${ALPH.length} extensions, ${g.length} garbage inputs)`;
});

/* =========================================================================== */
function sdk1Payload(id, values, notes, mistakes = 0, solved = false) {
  const b = new Uint8Array(208);
  b[0] = 1; b[1] = puzzleTag(id); b[2] = mistakes >> 8; b[3] = mistakes & 255; b[4] = solved ? 1 : 0;
  for (let i = 0; i < 81; i++) b[5 + (i >> 1)] |= (values[i] & 0xF) << ((i & 1) ? 0 : 4);
  for (let i = 0; i < 81; i++) { b[46 + i * 2] = notes[i] >> 8; b[47 + i * 2] = notes[i] & 255; }
  return b;
}
test('T4 SDK1 codes load as board only (every pool kind)', () => {
  const ids = [DATA.quick.medium[17].id, DATA.daily[123].id, DATA.worlds[2].useIt[3].id, DATA.worlds[4].master[0].id, DATA.worlds[3].spotIt[5].id, DATA.worlds[0].spotIt[0].id];
  for (const id of ids) {
    const bd = randomBoard(id);
    const notes = bd.notes.map((n, i) => (bd.values[i] ? 0 : n));
    const code = seal('SDK1.', sdk1Payload(id, bd.values, notes, 3), ri(0, 255));
    const r = F.decode(code);
    assert(r.kind === 'sdk1' && r.board.id === id, `${id}: found ${r.board && r.board.id}`);
    assert(deepEq(r.board.values, bd.values) === null && deepEq(r.board.notes, notes) === null && r.board.mistakes === 3, `${id}: board differs`);
  }
  // the prototype puzzle (tag 0) is not shipped
  const PROTO = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
  const pv = Array.from(PROTO, Number);
  assert(errCode(() => F.decode(seal('SDK1.', sdk1Payload('proto', pv, new Array(81).fill(0)), 7))) === 'puzzle', 'proto SDK1 must be "puzzle"');
  // givens that match no puzzle with that tag
  const id = DATA.quick.easy[3].id, g = F.givensOf(id).slice(); const j = g.findIndex(v => v); g[j] = g[j] % 9 + 1;
  assert(errCode(() => F.decode(seal('SDK1.', sdk1Payload(id, g, new Array(81).fill(0)), 7))) === 'puzzle', 'mismatching SDK1 board');
  // a damaged SDK1 code
  const c = seal('SDK1.', sdk1Payload(id, F.givensOf(id), new Array(81).fill(0)), 9);
  assert(errCode(() => F.decode(c.slice(0, 20) + (c[20] === 'A' ? 'B' : 'A') + c.slice(21))) === 'damaged', 'damaged SDK1');
  return `(${ids.length} pools)`;
});
test('T4 newer versions are refused with "update the game first"', () => {
  const b = body(randomSnap());
  const p3 = Uint8Array.of(FORMAT_VERSION + 1, ...rle(b));
  assert(errCode(() => F.decode(seal(PREFIX, p3, saltFor(p3)))) === 'newer', 'version byte 3');
  assert(errCode(() => F.decode('SDK3.' + F.encode(blankSnap()).slice(5))) === 'newer', 'SDK3 prefix');
  // a charge for a world this version does not have (world 7), a mastered world 9, a Quick Play index past the list
  const s = body(blankSnap()); s[OFF.levels + Math.floor((7 * 14 + 3) / 4)] |= 1 << (6 - 2 * ((7 * 14 + 3) & 3));
  assert(errCode(() => F.decode(sealV2(s))) === 'newer', 'world 7 charge');
  const s2 = body(blankSnap()); s2[OFF.mastered] |= 2;    // bit 9
  assert(errCode(() => F.decode(sealV2(s2))) === 'newer', 'world 9 mastered');
  assert(MESSAGES.newer === 'This code is from a newer version — update the game first.', 'message text');
  assert(errCode(() => F.decode(seal(PREFIX, Uint8Array.of(1, ...rle(b)), 3))) === 'damaged', 'version 1 inside SDK2 is damaged');
});
test('T4 locked settings for the code\'s mastery are refused (damaged)', () => {
  const s = blankSnap(); s.settings.style = 'cherry';                    // Cherry needs World 1
  assert(errCode(() => F.decode(F.encode(s))) === 'damaged', 'cherry without World 1');
  s.mastered = [0, 1]; s.levels[F.levelIds(0)[13]] = 1; s.levels[F.levelIds(1)[13]] = 2;
  assert(F.decode(F.encode(s)).snap.settings.style === 'cherry', 'cherry with World 1');
  const t = blankSnap(); t.settings.preset = 'forest'; assert(errCode(() => F.decode(F.encode(t))) === 'damaged', 'forest');
  t.devUnlockAll = true; assert(F.decode(F.encode(t)).snap.settings.preset === 'forest', 'DEV unlock all allows it');
});
test('T4 puzzles this version does not have; boards that do not match; inconsistent data', () => {
  const s = blankSnap(); s.last = DATA.daily[10].id; s.board = randomBoard(s.last);
  const b = body(s);
  const b1 = b.slice(); b1[OFF.last + 1] = 0x0F; b1[OFF.last + 2] = 0xFF;            // daily index 4095
  assert(errCode(() => F.decode(sealV2(b1))) === 'puzzle', 'daily index out of range');
  const b2 = b.slice(); const g = F.givensOf(s.last), j = g.findIndex(v => v);
  const sh = (j & 1) ? 0 : 4; b2[OFF.board + (j >> 1)] = (b2[OFF.board + (j >> 1)] & ~(0xF << sh)) | ((g[j] % 9 + 1) << sh);
  assert(errCode(() => F.decode(sealV2(b2))) === 'puzzle', 'givens mismatch');
  const b3 = b.slice(); b3[OFF.board] = (b3[OFF.board] & 0x0F) | 0xA0;              // value 10
  assert(errCode(() => F.decode(sealV2(b3))) === 'damaged', 'value 10');
  const b4 = b.slice(); b4[OFF.flags] |= 0x40;
  assert(errCode(() => F.decode(sealV2(b4))) === 'damaged', 'reserved flag');
  const b5 = body(blankSnap()); b5[OFF.levels + 3] |= 0x10;                          // World 0 Master charged, not mastered
  assert(errCode(() => F.decode(sealV2(b5))) === 'damaged', 'charged Master without mastery');
  const b6 = body(blankSnap()); b6[OFF.vol] = 101;
  assert(errCode(() => F.decode(sealV2(b6))) === 'damaged', 'volume 101');
  const b7 = body(blankSnap()); b7[OFF.tier] = 9;
  assert(errCode(() => F.decode(sealV2(b7))) === 'newer', 'tier 9 (a newer game)');
  const b8 = body(blankSnap()); b8[OFF.points] = 1;                                  // 256 points at inner 1
  assert(errCode(() => F.decode(sealV2(b8))) === 'damaged', 'inner below the points');
  const b9 = body(blankSnap()), b9x = Uint8Array.of(...b9, 0);
  assert(errCode(() => F.decode(sealV2(b9x))) === 'damaged', 'trailing byte');
  assert(errCode(() => F.decode(sealV2(b9.slice(0, -1)))) === 'damaged', 'short body');
});

/* =========================================================================== */
test('T5 sizes', () => {
  const fresh = blankSnap();
  const mid = blankSnap();
  for (const w of [0, 1]) { F.levelIds(w).forEach((id, k) => { mid.levels[id] = k === 0 ? 0 : (k % 4 === 0 ? 2 : 3); }); }
  F.levelIds(2).slice(0, 8).forEach((id, k) => { mid.levels[id] = k === 0 ? 0 : 3; });
  mid.mastered = [0, 1]; mid.skip = [0, 1]; mid.expertise = { tier: 1, inner: 7, points: 38 }; mid.fillNotes = false;
  mid.settings = { style: 'cherry', layout: 'plain', preset: 'ink', sound: true, switchVol: 0.65 };
  mid.free.played.gentle = DATA.quick.gentle.slice(0, 9).map(x => x.id); mid.free.solved.gentle = DATA.quick.gentle.slice(0, 7).map(x => x.id);
  mid.free.best.gentle = 241000; mid.lastFree = DATA.quick.gentle[6].id;
  for (let d = 300; d < 312; d++) mid.free.daily.solved[d] = 300000; mid.free.daily.late[303] = 1;
  mid.free.daily.streak = 8; mid.free.daily.lastDay = 311;
  mid.last = F.levelIds(2)[8];
  const max = blankSnap();
  for (const w of W) F.levelIds(w).forEach((id, k) => { max.levels[id] = k === 0 ? 0 : 3; });
  max.mastered = [...W]; max.skip = [...W]; max.expertise = { tier: 2, inner: 10, points: 9999 }; max.fillNotes = true;
  max.settings = { style: 'lp', layout: 'checker', preset: 'forest', sound: true, switchVol: 1 };
  for (const b of BANDS_F) { max.free.solved[b] = DATA.quick[b].map(x => x.id); max.free.played[b] = DATA.quick[b].slice(0, 137).map(x => x.id); max.free.best[b] = 95000; max.free.current[b] = DATA.quick[b][140].id; }
  for (let d = 0; d < 320; d++) max.free.daily.solved[d] = 400000;
  max.free.daily.streak = 320; max.free.daily.lastDay = 319; max.lastFree = DATA.daily[319].id;
  max.free.challenge = true; max.free.feedback = 'instant';
  max.last = DATA.quick.tricky[140].id;
  const withBoard = JSON.parse(JSON.stringify(mid));
  withBoard.last = DATA.quick.medium[42].id;
  withBoard.free.current.medium = withBoard.last;
  const g = F.givensOf(withBoard.last), sol = Array.from(DATA.quick.medium[42].solution, Number);
  let filled = 0;
  const values = g.map((v, i) => v || (i % 3 === 0 && filled++ < 20 ? sol[i] : 0));
  const notes = values.map((v, i) => (v ? 0 : (i % 2 ? (1 << (sol[i] - 1)) | (1 << ((sol[i] + 3) % 9)) : 0)));
  withBoard.board = { values, notes, mistakes: 1, paidHints: 0, silentWrong: 2, elapsed: 312000 };
  const maxBoard = JSON.parse(JSON.stringify(max));
  maxBoard.board = { values: F.givensOf(max.last).map((v, i) => v || (i * 7) % 9 + 1), notes: new Array(81).fill(0), mistakes: 9, paidHints: 2, silentWrong: 3, elapsed: 1800000 };
  maxBoard.board.values = F.givensOf(max.last).map((v, i) => v || 0); maxBoard.board.notes = maxBoard.board.values.map(v => (v ? 0 : 0x1FF ^ (1 << (v % 9))));
  const rows = [['fresh profile', fresh], ['mid-campaign (W0-W1 mastered, W2 half, some Quick Play, a daily streak)', mid],
    ['everything maxed (5 worlds x 3 charges, every Quick Play solved, 320 dailies)', max],
    ['mid-campaign + a Quick Play board in progress (20 digits, notes)', withBoard], ['maxed + a board with every empty cell full of notes', maxBoard]];
  const out = [];
  for (const [name, s] of rows) {
    const code = F.encode(s), raw = F.pack(s).length, unc = body(s).length + 1;
    assert(deepEq(F.decode(code).snap, normalize(s)) === null, `${name}: round trip`);
    out.push(`        ${String(code.length).padStart(4)} chars  (payload ${raw} B after RLE, ${unc} B before)  ${name}`);
  }
  console.log(out.join('\n'));
  console.log('        sample (fresh): ' + F.encode(fresh));
  console.log('        sample (mid):   ' + F.encode(mid));
});

console.log(`\n${pass}/${pass + failN} passed`);
process.exit(failN ? 1 : 0);
