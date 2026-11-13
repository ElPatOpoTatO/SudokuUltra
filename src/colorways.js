// colorways.js — keycap colorways (colour only; the keycap STYLE is shape).
//
// A colorway = a LAYOUT × a PRESET:
//   layout 'plain'   — every digit key cap A, mods cap MOD, the Hint key ACCENT
//   layout 'checker' — digits alternate A (1 3 5 7 9) / B (2 4 6 8), mods MOD, Hint ACCENT
// Each preset has a light and a dark palette (picked by prefers-color-scheme).
// cssFor() turns the table into CSS classes `.cw-<id>` that set custom
// properties; the keycap CSS (keys.css) only ever reads those properties:
//   --cap-a --cap-b --cap-mod --cap-accent          cap colours
//   --legend-a --legend-b --legend-mod --legend-accent   legend colours
//   --latch-a --latch-b --latch-mod                 legend colour of a latched key
//   --led                                           latch LED
//   --plate --plate-ink --plate-line --well          plate, Level 0 slot ink/outline, switch well
//   --deboss-a --deboss-b                           used-up digit (blank cap) deboss shadow
//   --veil-* --glf-*                                tone: tames dish highlights / gloss on dark caps
// Legends are forced to a contrast ratio >= 4.5 against their cap (ensure()),
// so a new preset can be rough and still stay readable.

export const PRESETS = [
  { id: 'retro', name: 'Retro', note: 'beige · grey',
    light: { a: '#ebe2cd', b: '#d5c7a6', mod: '#a9a59b', accent: '#b8481f',
             la: '#2b2721', lb: '#2b2721', lmod: '#1f1d1a', lacc: '#fff6ec', led: '#2fbf4f', plate: '#d6ccb8' },
    dark:  { a: '#3e3b35', b: '#504a3f', mod: '#272521', accent: '#b8481f',
             la: '#efe6d2', lb: '#f3ead6', lmod: '#d9d0bc', lacc: '#fff3e8', led: '#5ff07a', plate: '#22201c' } },
  { id: 'ink', name: 'Ink', note: 'black · red',
    light: { a: '#2a2b2f', b: '#3f4147', mod: '#17181b', accent: '#c7302a',
             la: '#f3f3f1', lb: '#f3f3f1', lmod: '#e4e4e1', lacc: '#ffffff', led: '#ff4a3d', plate: '#c8c8cb' },
    dark:  { a: '#26272b', b: '#36383d', mod: '#141518', accent: '#c7302a',
             la: '#efefec', lb: '#efefec', lmod: '#d6d6d2', lacc: '#ffffff', led: '#ff5446', plate: '#101113' } },
  { id: 'mint', name: 'Mint', note: 'cream · teal',
    light: { a: '#f1ecdf', b: '#cfe6dd', mod: '#2c7169', accent: '#ec8a70',
             la: '#1d3b38', lb: '#1d3b38', lmod: '#f5f1e6', lacc: '#2b1510', led: '#16b39f', plate: '#d9e2dc' },
    dark:  { a: '#253230', b: '#2f4440', mod: '#1a3d39', accent: '#ec8a70',
             la: '#e8f1ec', lb: '#e8f4ef', lmod: '#cdeee6', lacc: '#2b1510', led: '#45e0c8', plate: '#151c1b' } },
  { id: 'rose', name: 'Rose', note: 'blush · charcoal',
    light: { a: '#f4dcdc', b: '#e9c2c6', mod: '#3a393e', accent: '#b0425a',
             la: '#3a272c', lb: '#3a272c', lmod: '#f8e4e5', lacc: '#ffffff', led: '#ff5f86', plate: '#e3d3d2' },
    dark:  { a: '#563c42', b: '#684a51', mod: '#252428', accent: '#e07b93',
             la: '#fbe5e8', lb: '#fde9ec', lmod: '#f0cdd3', lacc: '#2a1117', led: '#ff7c9c', plate: '#1d1a1c' } },
  { id: 'ocean', name: 'Ocean', note: 'navy · sky',
    light: { a: '#1f2f52', b: '#2c4573', mod: '#9ac6e9', accent: '#f2c641',
             la: '#e9f1ff', lb: '#e9f1ff', lmod: '#0f2140', lacc: '#211b06', led: '#ffd23f', plate: '#c9d3df' },
    dark:  { a: '#1b2948', b: '#263b65', mod: '#5d8fba', accent: '#e8bb33',
             la: '#dce9ff', lb: '#dfebff', lmod: '#08162c', lacc: '#1e1804', led: '#ffd23f', plate: '#11151c' } },
  { id: 'forest', name: 'Forest', note: 'olive · cream',
    light: { a: '#5e633f', b: '#6c7247', mod: '#ece4cf', accent: '#a5582c',
             la: '#f4efdf', lb: '#f7f2e3', lmod: '#3a3d24', lacc: '#fff7ef', led: '#e08a4a', plate: '#d3cfbd' },
    dark:  { a: '#474b31', b: '#565b3b', mod: '#3a392f', accent: '#c97a45',
             la: '#ece6d2', lb: '#efe9d6', lmod: '#e6ddc2', lacc: '#1c0f06', led: '#ef9a5a', plate: '#1a1a15' } }
];
export const LAYOUTS = [
  { id: 'plain', name: 'Plain' },
  { id: 'checker', name: 'Checkerboard' }
];

/* ---- colour maths (sRGB, WCAG 2.x) ---- */
const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export function luminance(h) { const [r, g, b] = (Array.isArray(h) ? h : hex(h)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export function mix(a, b, t) { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); }
/* Push `fg` toward black or white (whichever side it is on) until it reaches `min` against `bg`. */
export function ensure(fg, bg, min = 4.5) {
  if (contrast(fg, bg) >= min) return fg;
  // walk toward white and toward black; keep the closest colour (least shift) that passes
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    for (const pole of luminance(fg) >= luminance(bg) ? ['#ffffff', '#000000'] : ['#000000', '#ffffff']) {
      const c = mix(fg, pole, t); if (contrast(c, bg) >= min) return c;
    }
  }
  return contrast('#ffffff', bg) > contrast('#000000', bg) ? '#ffffff' : '#000000';
}
const isLight = h => luminance(h) > 0.32;

/* Resolved palette (all custom properties, as a plain object). */
export function palette(p, theme) {
  const c = p[theme];
  const plateInk = isLight(c.plate) ? '#26241f' : '#ece8de';
  const latch = cap => ensure(c.led, cap, 4.5);   // accent-coloured latched legend, kept readable
  const deboss = cap => isLight(cap)
    ? '0 1px 0 rgba(255,255,255,.9), 0 -1px 0 rgba(0,0,0,.26)'
    : '0 1px 0 rgba(255,255,255,.13), 0 -1px 0 rgba(0,0,0,.62)';
  // dark caps under the light theme: soften the style's white dish highlights and gloss
  const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
  const veil = cap => rgba(cap, theme === 'light' && luminance(cap) < 0.12 ? 0.5 : 0);
  const glf = cap => theme === 'light' && luminance(cap) < 0.12 ? 0.35 : 1;
  return {
    '--veil-a': veil(c.a), '--veil-b': veil(c.b), '--veil-mod': veil(c.mod), '--veil-accent': veil(c.accent),
    '--glf-a': glf(c.a), '--glf-b': glf(c.b), '--glf-mod': glf(c.mod), '--glf-accent': glf(c.accent),
    '--cap-a': c.a, '--cap-b': c.b, '--cap-mod': c.mod, '--cap-accent': c.accent,
    '--legend-a': ensure(c.la, c.a), '--legend-b': ensure(c.lb, c.b),
    '--legend-mod': ensure(c.lmod, c.mod), '--legend-accent': ensure(c.lacc, c.accent),
    '--latch-a': latch(c.a), '--latch-b': latch(c.b), '--latch-mod': latch(c.mod),
    '--led': c.led, '--plate': c.plate, '--plate-ink': plateInk, '--plate-line': mix(c.plate, plateInk, 0.28),
    '--well': theme === 'dark' ? mix(c.plate, '#000000', 0.7) : mix(c.plate, '#000000', 0.68),
    '--deboss-a': deboss(c.a), '--deboss-b': deboss(c.b)
  };
}
const decl = o => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

/* CSS for every preset: `.cw-<id>` (light) + the dark override. */
export function cssFor(list = PRESETS) {
  const light = list.map(p => `.cw-${p.id}{${decl(palette(p, 'light'))}}`).join('\n');
  const dark = list.map(p => `.cw-${p.id}{${decl(palette(p, 'dark'))}}`).join('\n');
  return `${light}\n@media (prefers-color-scheme: dark){\n${dark}\n}`;
}
export const presetById = id => PRESETS.find(p => p.id === id) || null;
