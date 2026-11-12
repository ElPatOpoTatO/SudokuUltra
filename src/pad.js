// pad.js — the mechanical keycap pad (DOM only; input.js binds the presses).
// Moved verbatim from the feel prototype (section 5: ICONS, makeKey, buildPad).
import { $, div } from './util.js';

export const padEl = $('pad');
export const digitKeys = [];          // index d → {el, cnt}
export const keys = { pencil: null, erase: null, undo: null };

export const ICONS = {
  undo:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  erase:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H8.5L4 15.5a2 2 0 0 1 0-2.8L13.2 3.5a2 2 0 0 1 2.8 0l4.5 4.5a2 2 0 0 1 0 2.8L11 20"/><path d="m9 8 7 7"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="m14.5 5.5 3 3"/></svg>'
};

export function makeKey(cls, inner, parent = padEl) {
  const el = div('key ' + cls, parent);
  el.setAttribute('role', 'button');
  div('shadow', el); div('wall', el);
  const cap = div('cap', el);
  cap.innerHTML = inner;
  return el;
}

/* Builds the keys. `bind(el, kind, d)` is called for each key in DOM order, so
   input.js can attach its press handlers exactly where the prototype did. */
export function buildPad(bind) {
  // phone-style layout: 1 2 3 Undo / 4 5 6 Erase / 7 8 9 Pencil
  const mods = {
    3: ['undo', 'Undo'], 6: ['erase', 'Erase'], 9: ['pencil', 'Pencil']
  };
  for (let d = 1; d <= 9; d++) {
    const el = makeKey('digit', `<span class="lg">${d}</span><span class="cnt"></span><i class="led"></i>`);
    el.dataset.d = d;
    el.setAttribute('aria-label', 'Number ' + d);
    digitKeys[d] = { el, cnt: el.querySelector('.cnt') };
    bind(el, 'digit', d);
    if (mods[d]) {
      const [name, label] = mods[d];
      const m = makeKey('mod', `${ICONS[name]}<span class="lbl">${label}</span>${name === 'pencil' ? '<i class="led"></i>' : ''}`);
      m.setAttribute('aria-label', label);
      keys[name] = m;
      bind(m, name, 0);
    }
  }
}
