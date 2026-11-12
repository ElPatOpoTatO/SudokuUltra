# Shell report (step 3: game shell)

The feel prototype (`/home/claude/sudoku/pwa/index.html`, 1882 lines) is now split into
plain ES modules in `game/src/`, bundled by a zero-dependency build into one
`dist/index.html`. The prototype is untouched. The inventory of what moved where is in
`docs/shell-map.md`.

## Modules

| File | Lines | Holds |
|---|---:|---|
| `src/style.css` | 390 | prototype CSS verbatim (lines 18-359), then shell additions (`.pid`, `.dead` banner, `.dev` sheet) |
| `src/index.html` | 82 | HTML template: prototype `<head>` + markup, plus `#pid`, `#dead`, `#toastTitle`, `#devSheet` |
| `src/util.js` | 44 | geometry, `$`, `div`, `haptic`, `reducedMotion`, `dist`, `LONG_MS`, `RIPPLE_MS`, `DEBUG` |
| `src/audio.js` | 230 | `sfx` engine, verbatim |
| `src/state.js` | 129 | `S`, `UI`, undo, `conflictAt/countOf/isLocked`, rules: dead end, rewind target, Spot it steps |
| `src/pad.js` | 45 | keycap DOM (`ICONS`, `makeKey`, `buildPad`) |
| `src/board.js` | 259 | board DOM, `renderCell/renderAll/refresh`, every cell animation, verbatim |
| `src/particles.js` | 344 | canvas engine + all emitters, verbatim (`undoLift` gets an optional target) |
| `src/actions.js` | 328 | placement + consequences, notes, erase, undo, reset, toast (verbatim) + rules: silent wrong, dead end/Rewind, Spot it |
| `src/input.js` | 211 | press system, pointer/keyboard, long-press, cell-first / number-first, verbatim |
| `src/token.js` | 202 | SDK1 codec verbatim, pack/unpack, per-puzzle autosave, token sheet |
| `src/shared.js` | 48 | `ALLOW`, `WORLD_TECHS`, cands encode/decode, daily rhythm + epoch (shared with `tools/pipeline-common.mjs`) |
| `src/puzzles.js` | 84 | embedded stock, lookup by id, start board per item, Spot it solution via `source` |
| `src/game.js` | 56 | start / switch puzzle, per-id restore, Next / Play again |
| `src/devmenu.js` | 97 | DEV sheet (temporary) |
| `src/main.js` | 50 | boot, `?debug=1` hooks |
| `src/solver.js` | 931 | unchanged |
| `src/sw.template.js` | 26 | the prototype's `sw.js`; build writes the hashed `VERSION` |
| `tools/build.mjs` | 129 | bundler + dist writer |
| `tools/serve.mjs` | 34 | static server |
| `tools/parity-test.py` | 602 | parity + flow tests |

`tools/pipeline-common.mjs` now imports `WORLDS`, `WORLD_TECHS`, `ALLOW`, `BANDS`,
`DAY_BANDS`, `DAILY_COUNT`, `dailyBand`, `encodeCands` and `decodeCands` from `src/shared.js`
and re-exports them, so the browser and the pipeline use one definition. Its other exports
are unchanged.

## Build

`node tools/build.mjs` writes `dist/index.html`, `dist/sw.js`, the manifest and the icons.
The output is byte-identical between runs. I built it three times and the sha256 was the
same each time. `sw.js` gets `VERSION = 'sudoku-' + first 10 hex chars of sha256(index.html)`.

**Bundle:** `dist/index.html` is **460,055 bytes (449 KB), 126,600 bytes gzipped.**
About 298 KB of that is the embedded `puzzles.json`, 38 KB is the solver, and about 113 KB
is the shell itself (code and CSS). For comparison, the prototype was 88 KB.

How the bundler works: each module is wrapped as
`const __m_x = (() => { const {a, b} = __m_dep; …body…; return Object.freeze({…exports}); })();`
and the modules are emitted in dependency order. This relies on a convention, written in
the header of `build.mjs`. Imports must be named or `* as`, with relative paths. Exports
must be `export function/const/class` with one declarator per statement, or `export {…}`.
There is no `export let/var/default/*`, because bindings are copied instead of live, and
no import cycles. The build fails with a clear message when a module breaks a rule or
imports a name that is not exported. `./puzzles-data.js` is a virtual module that holds
`data/puzzles.json`.

## Parity results

`python3 tools/parity-test.py --parity` runs the same script on the prototype and on
`dist/?debug=1#p=proto`. Both pages get:

- the same seeded `Math.random`
- a paused Playwright clock, so timers, rAF and `performance.now()` only move when the
  test moves them. Before every input, `performance.now()` is moved onto the 16 ms frame
  grid, because the two pages' time origins can differ by about 1 ms.
- a frozen animation timeline (CDP `Animation.setPlaybackRate 0`). At each moment, every
  running animation is set to the same `currentTime`.

The script covers: select, cell-first place, undo lift, deselect, number-first load
pulse and place, unload, long-press note, pencil on with shimmer, notes in and flicked
off, a blocked press on a given, notes in peers, cleanup ripple, a clash (shake, chip into
the counter, mistake), erasing a digit, erasing notes, undo twice, keyboard Backspace,
arrows and digit, completing a row (latch sweep), solving the whole puzzle through the UI
(cascade and toast), undo out of solved, opening the token sheet, Copy (read back from
the clipboard), Close, restart, Load (board restored), and a damaged token (error message).
That is 20 state checkpoints and 21 screenshots per run.

| Run | State (20 checkpoints, incl. Math.random call count) | sfx calls (name + args) | Screenshots: max diff outside the header | Errors |
|---|---|---|---|---|
| light | identical | 274 = 274, identical | 0.000% (one rerun: 0.003%, 9 px) | 0 |
| dark | identical | 274 = 274, identical | 0.000% | 0 |
| reduced motion | identical | 274 = 274, identical | 0.0003% (1 px) | 0 |

The header band (top 54 px) differs by about 2% of its pixels because the build shows the
DEV puzzle id there. That band is masked on purpose.

What still differs, and why:

- **1 px at the board's bottom-right corner under reduced motion.** It is a 13-14 level
  anti-aliasing difference on the rounded corner, not a content difference.
- **Occasionally about 9 px at the "undo-digit" moment in light mode** (seen in 1 of 4
  runs). It is sub-millisecond phase noise in the canvas glyph that lifts into the Undo
  key, from the fake-clock timing. The pass limit is 0.05% of pixels per screenshot.
- **First run of the session:** a hidden second sheet (the DEV menu) added its upward box
  shadow to the token sheet's shadow at the bottom of the viewport. The fix is to park the
  hidden DEV sheet 64 px lower. This was a real visual difference and is now fixed.

## Flow tests (build only)

These run with `python3 tools/parity-test.py --flow`, or as part of the full run. All pass.

- **F1:** all **1,140** shipped puzzles load through the dev loader. That is 60 Spot it,
  60 Use it, 20 Master, 600 Quick and 400 Daily. Note that "1,440" counts the 300 backlog
  puzzles too (that is the validator's total), but the backlog is not shipped. For each
  puzzle the test checks:
  - the DOM shows the givens and the locked-cell classes
  - Spot it notes equal the stored or computed candidates
  - the solution agrees with the board and is unique
  - the solved check accepts the solution and rejects a one-digit change
  - the stored Spot it step is in the accepted step list, and that list has at least
    `alts` steps

  0 failures.
- **F2:** `w0-use-01`, `w2-use-05` and `w4-use-12` are solved through real pointer input
  (22, 53 and 54 placements). Each ends with the toast and 0 mistakes, and a reload
  restores the solved board from the per-id autosave.
- **F3 dead end:** two correct digits, then wrong digits that never clash. The first 4 are
  "quiet" (no visible mistake, `silentWrong = 4`, mistakes stay 0). Then comes one that
  makes `isDeadEnd` true. The banner appears exactly on that move. Rewind brings back the
  board with only the 2 correct digits, mistakes go 0 → 1, the banner hides, and a
  pencil note made earlier in a still-empty cell is kept.
- **F4 Spot it via the UI:**
  - `w1-spot-01`: hidden single, placement
  - `w3-spot-01`: claiming, 4 eliminations
  - `w4-spot-01`: naked pair, 3 eliminations
  - `w4-spot-02`: hidden pair, 5 eliminations
  - `w1-spot-06`: an alternative valid step that is not the stored one

  All of them reach "Spotted it" with a Next keycap, and Next opens the following item.
- **F5:** in Spot it, a wrong digit shows red at once and counts. Erasing the cell's true
  candidate counts as a mistake, and the note comes back.
- **F6:** the DEV menu has 140 campaign chips. Switching puzzles keeps per-id progress.
  "Play today" opens the right daily (2026-11-12 = day 311 = `d-0311`, medium, Thursday).

`tools/test-solver.mjs` and `tools/validate-puzzles.mjs` still pass (1440 items, 0 errors).
`tools/generate.mjs --quick` also still runs against the refactored `pipeline-common.mjs`.

## Rules as implemented (state.js / actions.js)

- **Free play (Use it, Master, Quick, Daily, proto):** a visible clash is a mistake, with
  the prototype's effects. A wrong digit with no clash only bumps `S.silentWrong`, which is
  saved in the per-id meta.
- **Dead end:** after each placement, if nothing clashes visibly and `isDeadEnd(values)` is
  true, the header banner appears. It says "Something went wrong earlier" and has a
  **Rewind** mod keycap. Rewind:
  - restores the latest undo snapshot whose placed digits are all correct (the givens if
    there is none)
  - trims the undo stack to before that snapshot
  - keeps notes that are still valid (cell still empty, no peer holds the digit)
  - lifts the wrong digits into the Rewind key (undo lift and whoosh), pops back the
    digits that return, and adds +1 mistake with the counter bump

  The banner also hides if an undo or erase makes the board completable again. In that
  case there is no mistake.
- **Spot it:** starts from `values`, with the stored cands (W3, W4) or `computeCands`
  (W0-W2) shown as notes. Every filled cell is locked. The accepted steps are every
  `allSteps(values, cands, ALLOW[w])` step whose technique is in `WORLD_TECHS[w]`,
  computed once from the starting board.
  - **Placement:** placing the step's digit in the step's cell.
  - **Elimination:** the player must erase, by toggling notes or with Erase, every
    elimination of some step, and those notes must still be erased.
  - **Feedback:** a wrong digit shows red at once and counts as a mistake. That counter is
    local to the Spot it board (not a campaign mistake), and campaign scoring does not
    exist yet. Erasing a true-solution candidate is a mistake, and the note returns after
    360 ms.
  - **Success:** the step's unit gets the latch sweep and gather, the pattern cells get a
    ping, and `sfx.latch` plays twice. Then the toast says "Spotted it" with the step text
    and a **Next** keycap.

## Known limitations

- **No live ES module bindings in the bundle.** The source follows the rules (exported
  objects are mutated, never rebound). Running `src/` unbundled in a browser would need
  `puzzles-data.js` to exist as a file. Only the bundle is meant to run.
- **The Daily epoch is a choice.** The pipeline only says that day 0 is a Monday. The game
  anchors it to Monday 2026-01-05 (`DAILY_EPOCH` in `src/shared.js`). Change it there if
  you want another anchor. The weekly rhythm shifts by one day each time the 400 wrap
  around (pipeline rule).
- **The token still uses the SDK1 single-board format** (208 bytes). Byte 1 is now a
  1-byte tag of the puzzle id (`proto` = 0, so prototype tokens still load), and unpack
  also checks the givens. Spot it progress and `silentWrong` are not in the token. They
  live in the autosave meta (`sudoku.meta.v1.<id>`).
- **The dead-end banner covers the whole header** (mistakes, token, restart, mute) while
  it shows. The board and pad stay usable.
- **The dead end is not checked while any visible clash is on the board,** because the
  clash already has its own feedback.
- **Spot it accepted steps are fixed from the starting board.** Erasing unrelated wrong
  candidates first does not unlock new steps.
- **The DEV pieces** (`#pid`, `#devSheet`, `devmenu.js`, `#p=proto`, `?debug=1` hooks)
  are meant to be removed before release.
