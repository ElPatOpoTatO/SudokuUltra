// tokencodec.js — the code "envelope" shared by every progress code (pure: no
// DOM, no storage; runs in browsers and in Node 18+). See docs/token.md.
//
//   "<PREFIX>" + base64url( salt | scramble( payload | crc32(salt | payload) ) )
//
// - salt: one byte. SDK1 picks it at random (Math.random, unchanged from the
//   prototype); SDK2 derives it from the payload, so the same data always gives
//   the same code.
// - scramble: XOR with a mulberry32 keystream seeded by KEY and the salt, with
//   byte chaining (each output byte also mixes in the previous output byte).
//   Stops casual reading and editing; it is NOT security (the key is right here).
// - crc32 over salt + payload: any typo, truncation or edit is rejected.
// - base64url without padding; decoding is strict (canonical) so that no two
//   strings decode to the same bytes.
//
// rle / unrle: the SDK2 body compression (runs of 0x00 and 0xFF, see docs/token.md).

export const KEY = 0x5D0C_2A17;            // scramble key (obfuscation only)

export class CodeError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, start = 0xFFFFFFFF) {
  let c = start;
  for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function crcSalted(salt, payload) {
  const b = new Uint8Array(payload.length + 1);
  b[0] = salt; b.set(payload, 1);
  return crc32(b);
}

function stream(salt) {                 // mulberry32 keystream
  let a = (KEY ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) & 0xFF;
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
export function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    const left = bytes.length - i;
    s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (left > 1 ? B64[n >> 6 & 63] : '') + (left > 2 ? B64[n & 63] : '');
  }
  return s;
}
/** Strict base64url: only the 64 characters, no padding, unused bits zero. Returns null if not canonical. */
export function unb64u(str) {
  if (str.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor(str.length * 3 / 4));
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i), v = c < 128 ? B64I[c] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xFF; }
  }
  if (bits && (acc & ((1 << bits) - 1))) return null;   // non-zero leftover bits: not canonical
  return out;
}

/** Seal payload bytes into a code string. */
export function seal(prefix, payload, salt) {
  salt &= 0xFF;
  const crc = crcSalted(salt, payload);
  const plain = new Uint8Array(payload.length + 4);
  plain.set(payload);
  plain[payload.length] = crc >>> 24; plain[payload.length + 1] = crc >>> 16 & 0xFF;
  plain[payload.length + 2] = crc >>> 8 & 0xFF; plain[payload.length + 3] = crc & 0xFF;
  const out = new Uint8Array(plain.length + 1);
  out[0] = salt;
  const ks = stream(salt);
  let prev = salt;
  for (let i = 0; i < plain.length; i++) { prev = plain[i] ^ ks() ^ prev; out[i + 1] = prev; }
  return prefix + b64u(out);
}
/** The deterministic SDK2 salt: the top byte of the payload's CRC32. */
export const saltFor = payload => crc32(payload) >>> 24;

/** Open the body of a code (the part after the prefix). Returns the payload or throws CodeError('damaged'). */
export function unseal(body) {
  const raw = unb64u(body);
  if (!raw || raw.length < 6) throw new CodeError('damaged');
  const salt = raw[0], ks = stream(salt), plain = new Uint8Array(raw.length - 1);
  let prev = salt;
  for (let i = 1; i < raw.length; i++) { plain[i - 1] = raw[i] ^ ks() ^ prev; prev = raw[i]; }
  const n = plain.length - 4, payload = plain.slice(0, n);
  const got = ((plain[n] << 24) | (plain[n + 1] << 16) | (plain[n + 2] << 8) | plain[n + 3]) >>> 0;
  if (crcSalted(salt, payload) !== got) throw new CodeError('damaged');
  return payload;
}

/** Remove whitespace a paste may add (spaces, tabs, newlines, NBSP, zero-width). */
export const squeeze = s => String(s == null ? '' : s).replace(/[\s​-‍﻿]+/g, '');

/* ---- RLE for 0x00 / 0xFF runs ---------------------------------------------------
   A byte other than 0x00 / 0xFF stands for itself. 0x00 or 0xFF is followed by
   one byte n: a run of n+1 copies (1..256). Runs are greedy and maximal, so the
   encoding of any input is unique; unrle refuses anything rle would not emit. */
export function rle(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b !== 0x00 && b !== 0xFF) { out.push(b); i++; continue; }
    let n = 1;
    while (i + n < bytes.length && bytes[i + n] === b && n < 256) n++;
    out.push(b, n - 1);
    i += n;
  }
  return Uint8Array.from(out);
}
export function unrle(bytes, max = 4096) {
  const out = [];
  let lastRun = -1, lastLen = 0;          // to refuse a run that should have been merged with the one before
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b !== 0x00 && b !== 0xFF) { out.push(b); i++; lastRun = -1; continue; }
    if (i + 1 >= bytes.length) return null;
    const n = bytes[i + 1] + 1;
    if (lastRun === b && lastLen < 256) return null;   // not maximal
    for (let k = 0; k < n; k++) out.push(b);
    if (out.length > max) return null;
    lastRun = b; lastLen = n;
    i += 2;
  }
  return Uint8Array.from(out);
}

/* ---- SDK1 puzzle tag (byte 1 of an SDK1 board payload) ------------------------- */
export function puzzleTag(id) {
  if (id === 'proto') return 0;
  let h = 0x811C9DC5;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 0x01000193);
  return ((h >>> 0) % 255) + 1;
}
