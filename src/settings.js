// settings.js — player settings: keycap style, colorway, sound.
//
//   getSettings()            → a copy: { style, layout, preset, sound, switchVol }
//   setSettings(patch, opt)  → validates, applies at once, saves; returns the new copy
//   onSettings(fn)           → fn(settings) after every change
//
// Stored in localStorage 'sudoku.settings.v1' as JSON { v: 1, ...settings }.
// (Kept as a plain object so the progress token v2 can carry it later.)
//
// Applying = classes on <html> (keys.css reads them):
//   .kx (any real style) .ks-<style> .cw-<preset> .cl-<layout>
// plus the colorway custom properties (one generated <style>, see colorways.js),
// the switch voice (sfx.keyStyle) and its volume, and the master mute.
//
// DEBUG ONLY: ?debug=1&keys=classic renders the original keycaps and clicks
// (no .kx, no dressing, sfx.keyStyle = null) so the parity test compares like
// with like. 'classic' is never saved and setSettings refuses it without debug.
import { $, DEBUG } from './util.js';
import { sfx } from './audio.js';
import { keys } from './pad.js';
import { PRESETS, LAYOUTS, cssFor, presetById } from './colorways.js';
import { setSwitchVolume, SWITCH_NAMES } from './switches.js';

export const STORE_KEY = 'sudoku.settings.v1';
export const STYLES = [
  { id: 'sa', name: 'SA', sub: 'Retro', sound: SWITCH_NAMES.sa },
  { id: 'cherry', name: 'Cherry', sub: 'OEM', sound: SWITCH_NAMES.cherry },
  { id: 'lp', name: 'Low', sub: 'Profile', sound: SWITCH_NAMES.lp }
];
export const DEFAULTS = { style: 'sa', layout: 'plain', preset: 'retro', sound: true, switchVol: 0.8 };

const listeners = [];
let cur = { ...DEFAULTS };
let classicUrl = false;
let observer = null;

function clean(o, base) {
  const out = { ...base };
  if (!o || typeof o !== 'object') return out;
  if (STYLES.some(s => s.id === o.style) || (o.style === 'classic' && DEBUG)) out.style = o.style;
  if (LAYOUTS.some(l => l.id === o.layout)) out.layout = o.layout;
  if (presetById(o.preset)) out.preset = o.preset;
  if (typeof o.sound === 'boolean') out.sound = o.sound;
  if (typeof o.switchVol === 'number' && isFinite(o.switchVol)) out.switchVol = Math.max(0, Math.min(1, o.switchVol));
  return out;
}
function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
  const s = clean(saved, DEFAULTS);
  if (s.style === 'classic') s.style = DEFAULTS.style;      // never restored from storage
  return s;
}
function save() {
  if (cur.style === 'classic') return;
  try {
    const { style, layout, preset, sound, switchVol } = cur;
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, style, layout, preset, sound, switchVol }));
  } catch (e) {}
}

export const getSettings = () => ({ ...cur });
export const isClassic = () => cur.style === 'classic';
export function onSettings(fn) { listeners.push(fn); }
export function setSettings(patch, opt = {}) {
  const next = clean({ ...cur, ...patch }, cur);
  const changed = Object.keys(next).some(k => next[k] !== cur[k]);
  cur = next;
  apply();
  if (opt.persist !== false) save();
  if (changed) for (const fn of listeners) { try { fn(getSettings()); } catch (e) {} }
  return getSettings();
}

/* ---- DOM ---- */
function injectColorways() {
  if (document.getElementById('kcw')) return;
  const st = document.createElement('style');
  st.id = 'kcw'; st.textContent = cssFor(PRESETS);
  document.head.appendChild(st);
}
function swapClass(el, prefix, value) {
  for (const c of [...el.classList]) if (c.startsWith(prefix)) el.classList.remove(c);
  if (value) el.classList.add(prefix + value);
}
function apply() {
  const html = document.documentElement, classic = cur.style === 'classic';
  html.classList.toggle('kx', !classic);
  swapClass(html, 'ks-', classic ? null : cur.style);
  swapClass(html, 'cw-', classic ? null : cur.preset);
  swapClass(html, 'cl-', classic ? null : cur.layout);
  sfx.keyStyle = classic ? null : cur.style;
  setSwitchVolume(cur.switchVol);
  if (!classic) {
    injectColorways();
    dressAll();
    if (sfx.muted !== !cur.sound) sfx.setMuted(!cur.sound);
    const mb = $('muteBtn'); if (mb) mb.classList.toggle('muted', !cur.sound);
  }
}

/* Give a .key the extra parts the styles need (idempotent). */
const ROW_OF_MOD = { undo: 1, erase: 2, pencil: 3 };
export function dressKey(el) {
  const cap = el.querySelector(':scope > .cap');
  if (!cap) return;
  if (!cap.querySelector(':scope > .sk')) {
    const tf = document.createElement('i'); tf.className = 'tf';
    const sk = document.createElement('i'); sk.className = 'sk';
    cap.prepend(sk, tf);
  }
  if (!el.querySelector(':scope > .sw')) {
    const sw = document.createElement('div'); sw.className = 'sw';
    sw.innerHTML = '<i class="hs"></i><i class="st"></i><span class="pl"></span>';
    if (el.dataset.d || el.dataset.pd) sw.lastChild.textContent = el.dataset.d || el.dataset.pd;
    el.insertBefore(sw, cap);
  }
  const d = +(el.dataset.d || el.dataset.pd);
  if (d) { el.classList.add('r' + Math.ceil(d / 3)); el.classList.toggle('ev', d % 2 === 0); }
  for (const m in ROW_OF_MOD) if (keys[m] === el) el.classList.add('r' + ROW_OF_MOD[m]);
  if (el.classList.contains('mod') && cap.querySelector(':scope > .led')) el.classList.add('tg');
}
function dressAll(root = document) {
  root.querySelectorAll('.key').forEach(dressKey);
  if (!observer && 'MutationObserver' in window) {
    observer = new MutationObserver(recs => {
      if (cur.style === 'classic') return;
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList.contains('key')) dressKey(n);
          else if (n.querySelector) n.querySelectorAll('.key').forEach(dressKey);
        }
        // a cap whose content was replaced (innerHTML) lost its body parts
        const t = r.target;
        if (t.classList && t.classList.contains('cap') && t.parentNode && t.parentNode.classList.contains('key')) dressKey(t.parentNode);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

/* Called once from main.js, after the pad and the hint keys exist. */
export function initSettings() {
  try { classicUrl = DEBUG && new URLSearchParams(location.search).get('keys') === 'classic'; } catch (e) {}
  cur = load();
  if (classicUrl) cur.style = 'classic';
  apply();
  if (DEBUG) window.__keys = { getSettings, setSettings, STYLES, PRESETS, LAYOUTS, DEFAULTS };
}
