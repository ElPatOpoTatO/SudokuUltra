// devmenu.js — TEMPORARY developer menu (clearly marked DEV). A sheet that
// reuses the token sheet styling: campaign worlds 0-4 (Spot it 1-12, Use it
// 1-12, Master 1-4), Quick Play bands, today's Daily, the progress token.
// Remove this module (and the #pid / #devSheet markup) for release.
import { $ } from './util.js';
import { sfx } from './audio.js';
import { S, UI } from './state.js';
import { release } from './actions.js';
import { cancelAllPresses, bindHeaderBtn } from './input.js';
import { openSheet } from './token.js';
import { startPuzzle } from './game.js';
import { worlds, quick, daily, todayDailyId, modeLabel, entry } from './puzzles.js';
import { BANDS, dailyIndex, DAILY_EPOCH } from './shared.js';
/* --- level0: campaign runner entries --- */
import { devEntries } from './campaign.js';
/* --- end level0 --- */

const sheet = $('devSheet'), bg = $('devBg');

function el(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function chip(parent, label, id, title) {
  const c = el('span', 'chip', label, parent);
  c.setAttribute('role', 'button');
  if (id) { c.dataset.id = id; if (id === S.id) c.classList.add('cur'); }
  if (title) c.title = title;
  return c;
}
const pad2 = n => String(n).padStart(2, '0');

function go(id) { closeDev(); if (id && id !== S.id) startPuzzle(id); }

function render() {
  sheet.textContent = '';
  const h = el('h2', null, null, sheet); h.innerHTML = '<b>DEV</b> · Puzzles';
  el('p', 'sub', `Current: ${S.id} · ${modeLabel(S.id)}${S.mode === 'spot' ? ' · target: ' + S.spot.label : ''}`, sheet);
  /* --- level0: campaign runner + Level 0 entries (no data-id, so the chip handler below skips them) --- */
  devEntries(sheet, el, chip, closeDev);
  /* --- end level0 --- */

  el('div', 'grp', 'Campaign', sheet);
  for (const w of worlds) {
    for (const [key, name] of [['spotIt', 'Spot it'], ['useIt', 'Use it'], ['master', 'Master']]) {
      const row = el('div', 'wrow grid', null, sheet);
      el('span', 'tag', `W${w.world} ${name}`, row);
      w[key].forEach((it, k) => chip(row, String(k + 1), it.id, it.id));
    }
  }

  el('div', 'grp', 'Quick Play', sheet);
  for (const b of BANDS) {
    const row = el('div', 'wrow', null, sheet);
    el('span', 'tag', b, row);
    const list = quick[b] || [];
    const r = chip(row, 'Random');
    r.addEventListener('click', () => go(list[(Math.random() * list.length) | 0].id));
    const inp = el('input', null, null, row);
    inp.type = 'number'; inp.min = 1; inp.max = list.length; inp.placeholder = `1-${list.length}`;
    const g = chip(row, 'Go');
    g.addEventListener('click', () => { const n = +inp.value; if (n >= 1 && n <= list.length) go(list[n - 1].id); });
  }

  el('div', 'grp', 'Daily', sheet);
  const today = new Date(), idx = dailyIndex(today), tid = todayDailyId(today);
  el('p', 'note', `Today (${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}, local) = day ${idx} → ${tid} (${entry(tid).item.band}). Day 0 = Monday ${DAILY_EPOCH[0]}-${pad2(DAILY_EPOCH[1])}-${pad2(DAILY_EPOCH[2])}, index = days since then mod ${daily.length}.`, sheet);
  const drow = el('div', 'wrow', null, sheet);
  chip(drow, 'Play today', tid);
  const dinp = el('input', null, null, drow);
  dinp.type = 'number'; dinp.min = 0; dinp.max = daily.length - 1; dinp.placeholder = `0-${daily.length - 1}`;
  const dg = chip(drow, 'Go');
  dg.addEventListener('click', () => { const n = +dinp.value; if (dinp.value !== '' && n >= 0 && n < daily.length) go(daily[n].id); });

  el('div', 'grp', 'Other', sheet);
  const orow = el('div', 'wrow', null, sheet);
  const tk = chip(orow, 'Progress token');
  tk.addEventListener('click', () => { closeDev(); openSheet(); });
  chip(orow, 'Prototype puzzle', 'proto');
  const close = chip(orow, 'Close');
  close.addEventListener('click', closeDev);

  sheet.querySelectorAll('.chip[data-id]').forEach(c => c.addEventListener('click', () => go(c.dataset.id)));
}

export function openDev() {
  cancelAllPresses(); release();
  render();
  UI.sheetOpen = true; sheet.classList.add('show'); bg.classList.add('show');
  sheet.scrollTop = 0;
}
export function closeDev() {
  UI.sheetOpen = false; sheet.classList.remove('show'); bg.classList.remove('show');
  const a = document.activeElement; if (a && a.blur) a.blur();
}

export function initDevMenu() {
  bindHeaderBtn($('pid'), () => { sfx.mod(); openDev(); });
  bg.addEventListener('pointerdown', e => { e.preventDefault(); closeDev(); });
}
