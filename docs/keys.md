# Keycaps, colorways, switch sounds, Settings

The pad can be drawn in three keycap **styles** (shape and material) and many **colorways** (colour). The two are independent: any style works with any layout and any preset, in light and dark. Each style also has its own synthesized **mechanical switch sound**. A gear in the header opens the **Settings** sheet.

| File | What it holds |
|---|---|
| `src/keys.css` | The style geometry and materials, the colorway plumbing, and the Settings sheet. The build appends it after `style.css` |
| `src/colorways.js` | The preset table, colour maths (WCAG contrast, `ensure()`), and the generated `.cw-<id>` CSS |
| `src/switches.js` | The switch voices (`sfx.sw(kind)`) and the switch-sound volume bus |
| `src/settings.js` | `getSettings` / `setSettings` / `onSettings`, storage, applying settings to `<html>`, dressing keys |
| `src/settingsui.js` | The gear button, the Settings sheet, the live preview strip, and the swap wave |
| `tools/keys-test.py` | Browser tests and screenshots (see Tests below) |

Edits to shared files are small and fenced with `/* --- keys --- */`. They are: `src/main.js` (import + `initKeys()`), `src/audio.js` (`keyStyle`, `prims`, and one routing line in `pen`/`pencil`/`mod`/`release`), `tools/build.mjs` (appends `keys.css`), and `tools/parity-test.py` (`&keys=classic`).

## Styles

| id | Name | Look | Travel | Switch voice |
|---|---|---|---|---|
| `sa` (default) | SA / Retro | Tall caps with a spherical dish, thick rounded skirts, ABS gloss streak, bold uppercase mod legends | 3.5 px | Linear: a deep, marbly "thock" with a low-mid body |
| `cherry` | Cherry / OEM | Sculpted rows (row 1 has a tall front skirt, row 3 leans back), cylindrical dish, PBT grain, lowercase mod legends in the top-left corner (GMK-like) | 3 px | Brown tactile: a soft bump, then a mid thock |
| `lp` | Low-profile flat | Uniform flat tops, thin skirts, matte PBT | 2 px | Low-profile clicky: a sharp click jacket on the way down and on the way up |

**DOM.** `settings.js` (`dressKey`) adds three parts to every `.key`, including keys created later (a MutationObserver watches for them): `.key > .shadow .wall .sw(.hs .st .pl) .cap > .sk .tf + legends`.

- `.sk` is the cap body: the front skirt, plus `::before` (left facet) and `::after` (right facet).
- `.tf` is the top face: the dish shading, `::before` (gloss), and `::after` (press shade).
- `.sw` is a bare switch: housing, cross stem, and the digit printed on the plate.

`.sk` and `.tf` sit at `z-index: -1` inside `.cap` (a stacking context), so the legends stay direct children of `.cap`. Every existing rule (`.hkeys`, `.dead`, `.toast`, sheet and coach keys) keeps working, and so do the particle origins (`.cap` rects).

**A style is only custom properties** on `.ks-<style>`. That is why a preview tile can carry a different style than the page. Geometry is given in fractions of `--kh` (`--Sk` side, `--Bk` back, `--Fk` front, `--Fk1..3` per row, `--Rk`/`--TRk` radii, `--Gk` gap) and is resolved per key in `.kx .key` (`--kS --kB --kF --kR --kT --kG`), so compact keys scale with their own `--kh`. The material properties are `--dish`, `--rim`, `--sk-sh`, `--lf/--rf/--fr0/--fr1/--back` (facet light), `--gloss`, and `--press-shade`. The legend properties are `--lgk/--lgw/--lbl-*`, and mod legend placement uses `--mod-align/--mod-justify/--mod-pad`. Locked keys use `--lock-cap/--lock-sw/--lock-y`. Dark-theme overrides sit in a `prefers-color-scheme: dark` block per style.

**States** stay exactly as `input.js` and `board.js` set them:

| State | How it looks |
|---|---|
| `.down` | The press, on the pointerdown frame with no transition in: the cap travels by `--travel` and the shade comes on |
| `.latched` | The cap is held at `--latch`, the LED is lit, and the legend turns the colorway's latch colour. Toggle keys (Pencil, Check) also show the unlit LED |
| `.locked` (digit used up) | SA/Cherry: a blank cap with a debossed legend, no badge, no LED. Low-profile: the cap is pulled, showing the bare switch with a "+" stem and the digit printed on the plate |
| `.l0-dim` (Level 0) | A flat outlined slot in every style: body, wall, shadow and switch hidden, an outline in `--plate-line`, the legend in `--plate-ink` |
| Hint key | The accent cap. Check is a mod cap |

The plate under the pad is `.pad::before`, drawn 7 px outside the pad box. Layout is unchanged: the board, the hint band, and the Level 0 coach measure exactly as before.

## Colorways

A colorway is a layout plus a preset:

- **Plain**: every digit key uses cap A, the mods (Undo / Erase / Pencil, Check, sheet buttons) use cap MOD, and the Hint key uses ACCENT.
- **Checkerboard**: the odd digits (1 3 5 7 9) use cap A and the even digits (2 4 6 8) use cap B, so the 3×3 grid alternates. Mods use MOD and Hint uses ACCENT.

`settings.js` sets `.cw-<preset>` and `.cl-<layout>` on `<html>`. `colorways.js` turns the table into one generated `<style id="kcw">` with a light and a dark block per preset. The custom properties are:

| Property | Meaning |
|---|---|
| `--cap-a --cap-b --cap-mod --cap-accent` | Cap colours |
| `--legend-a --legend-b --legend-mod --legend-accent` | Legend colours, forced to at least 4.5:1 against their cap |
| `--latch-a --latch-b --latch-mod` | Latched legend: the LED colour pushed to at least 4.5:1 against the cap |
| `--led` | The latch LED |
| `--plate --plate-ink --plate-line --well` | The plate; the ink and outline of Level 0 slots; the switch well under the caps |
| `--deboss-a --deboss-b` | The text-shadow of the blank (used-up) digit, depending on how light the cap is |
| `--veil-* --glf-*` | Dark caps under the light theme get a veil of their own colour over the dish, and a weaker gloss |

Inside a key, `--base`, `--lg` and `--lgl` pick the right set (A, B, MOD or ACCENT). The shell's own legend variables (`--cap-ink --ink-2 --ink-3 --accent-ink`) are redirected to them, so every older rule that colours a `.lbl` or `svg` inside a key follows the colorway.

### Presets

The notes show the alphas · mods colours.

| id | Name | Light: A / B / MOD / ACCENT | Dark: A / B / MOD / ACCENT |
|---|---|---|---|
| `retro` (default) | Retro (beige · grey, orange accent) | `#ebe2cd` / `#d5c7a6` / `#a9a59b` / `#b8481f` | `#3e3b35` / `#504a3f` / `#272521` / `#b8481f` |
| `ink` | Ink (black · graphite, red accent) | `#2a2b2f` / `#3f4147` / `#17181b` / `#c7302a` | `#26272b` / `#36383d` / `#141518` / `#c7302a` |
| `mint` | Mint (cream · teal, coral accent) | `#f1ecdf` / `#cfe6dd` / `#2c7169` / `#ec8a70` | `#253230` / `#2f4440` / `#1a3d39` / `#ec8a70` |
| `rose` | Rose (blush · charcoal, berry accent) | `#f4dcdc` / `#e9c2c6` / `#3a393e` / `#b0425a` | `#563c42` / `#684a51` / `#252428` / `#e07b93` |
| `ocean` | Ocean (navy · sky, yellow accent) | `#1f2f52` / `#2c4573` / `#9ac6e9` / `#f2c641` | `#1b2948` / `#263b65` / `#5d8fba` / `#e8bb33` |
| `forest` | Forest (olive · cream, copper accent) | `#5e633f` / `#6c7247` / `#ece4cf` / `#a5582c` | `#474b31` / `#565b3b` / `#3a392f` / `#c97a45` |

### Adding a preset

1. Add an entry to `PRESETS` in `src/colorways.js` with `id`, `name`, a short `note`, and a `light` and a `dark` palette. Each palette needs `a b mod accent` (caps), `la lb lmod lacc` (legends), `led`, and `plate`.
2. Build. The CSS class, the swatch in Settings, and the contrast enforcement all follow from that entry. Legends that miss 4.5:1 are nudged toward black or white automatically, but pick readable ones yourself so the hue survives.
3. Add the id to `PRESETS` in `tools/keys-test.py` (K2 sweeps every preset), and optionally to a `PAIRS` entry for screenshots.

## Switch sounds

While a style is on, `audio.js` routes `sfx.pen()`, `pencil()`, `mod()` and `release()` to `sfx.sw(kind)`, where `kind` is `pen | pencil | mod | up`. The routing is on whenever `sfx.keyStyle` is set. The sfx call log therefore reads `pen()` followed by `sw(pen)`.

- A press is a tactile bump or click-jacket transient, then the stem bottom-out, then a housing knock.
- A release is the top-out plus a faint, slightly random spring ping.
- Pencil uses the silent version of the same switch: damped, lowpassed, with no click or bump.
- Mods use the same switch on a bigger cap (a touch lower).

Every call uses the engine's `pj()` (±5 % pitch) plus gain and timing jitter. Sounds start at `ctx.currentTime` on pointerdown, as before. They play into a switch bus whose gain is the "Switch sound" slider, and that bus feeds the master, so mute still silences everything. All other sounds (erase scrub, pencil scratch, latch, cleanup ticks, hints) are unchanged.

## Settings

```js
import { getSettings, setSettings, onSettings } from './settings.js';
getSettings();   // { style: 'sa', layout: 'plain', preset: 'retro', sound: true, switchVol: 0.8 }
setSettings({ preset: 'ocean' });   // validates, applies at once, saves, notifies
```

**Storage.** Settings are saved in `localStorage['sudoku.settings.v1']` as `{"v":1,"style","layout","preset","sound","switchVol"}`. Reads and writes are in try/catch. Bad or unknown values fall back to the defaults, field by field. The object is plain JSON; the backup code (step 9, `docs/token.md`) carries it.

**Sound on/off** is the old mute: `sfx.setMuted`. In styled mode the header mute button is hidden, because the gear takes its place. It stays in the DOM, and its `muted` class is kept in sync.

**The sheet.** It reuses `.sheet` / `.sheet-bg`, fits 390×844 without scrolling, and scrolls inside at 375×667. Its top (title plus the live preview strip) is sticky. The preview strip holds real keys: 4, 5, 6 (used up), Pencil (latched) and Hint. You can press them and hear the switch.

**The swap wave.** A change applies at once. Each key keeps its old look for a moment: the old `ks-/cw-/pin-` classes are pinned on the key itself. Then, in a wave spreading out from the tapped option, the cap lifts, takes the new look at the top of the lift, and drops back. This uses transform and opacity only. With reduced motion it is a 220 ms crossfade instead.

**DEBUG ONLY.** `?debug=1&keys=classic` renders the original keycaps and clicks: no `.kx`, no dressing, no gear, and `sfx.keyStyle = null`. The parity test uses it to compare the build with the prototype like for like. `classic` is never saved, and `setSettings` refuses it without `?debug=1`. With `?debug=1`, `window.__keys` exposes `getSettings`, `setSettings`, `STYLES`, `PRESETS`, `LAYOUTS` and `DEFAULTS`.

## Tests

```
node tools/build.mjs
python3 tools/keys-test.py        # K1..K7, screenshots in /tmp/keys-shots
python3 tools/parity-test.py      # parity runs with &keys=classic; the flow tests run in the default SA style
python3 tools/level0-test.py; python3 tools/hints-test.py   # run one browser suite at a time
```

| Test | What it checks |
|---|---|
| K1 | The style × layout × 2 presets × light/dark matrix at 390×844, plus a few at 375×667. No scroll; no overlap between keys, plate, Hint/Check and board; every legend at least 4.5:1 against its cap (computed styles). Writes `overview-*.png` grids |
| K2 | Contrast sweep over every preset × layout × style × theme, including latched legends |
| K3 | The pressed transform equals the style's travel in the same task as the pointerdown (before any frame) |
| K4 | Locked and latched are distinct in computed treatment and in pixels, in every style and theme |
| K5 | Level 0 `.l0-dim` keys are flat outlined slots in every style |
| K6 | The default is SA + Retro + Plain. Settings persist across a reload, and bad JSON falls back to the defaults. The sheet fits at both sizes and with reduced motion; tile, segment and swatch taps apply; Escape closes |
| K7 | The sfx sequence per style (`pen()` then `sw(pen)`, `sw(up)`, `sw(pencil)`, `sw(mod)`). Classic never calls `sw`. An offline render checks that each voice is audible, at a level comparable to the classic click, with a short tail |
