# Shell map: prototype -> modules

Source: `/home/claude/sudoku/pwa/index.html` (feel prototype, 1882 lines, one file).
Target: `game/src/*.js` + `game/src/style.css`, bundled by `tools/build.mjs` into `dist/index.html`.

Rule for the move: code is moved **verbatim** (same timings, easings, constants, sound
recipes, particle maths, CSS). Only the glue changes: global `const`s become imports, the
fixed `PUZZLE`/`SOLUTION`/`GIVEN`/`SOL` become `S.given` / `S.sol` of the current puzzle,
and the `refresh = function(){ _refresh(); scheduleSave(); }` monkey patch becomes a hook.

| Prototype section (lines) | What it holds | Module |
|---|---|---|
| `<head>` meta, manifest, icons (1-16) | PWA meta tags | `tools/build.mjs` HTML template (identical tags) |
| CSS 1. TOKENS (18-95) | light/dark tokens, reduced-motion overrides | `style.css` |
| CSS 2. BASE (97-112) | touch defaults, font | `style.css` |
| CSS 3. LAYOUT + header (114-154) | `.app`, `.hdr`, `.stat`, `.status`, `.hbtn`, `.board-wrap` | `style.css` (+ new `.pid`, `.dead` header rules, appended) |
| CSS 4. BOARD (156-226) | cells, notes, fx layers, ghost, rub, cq fallback | `style.css` |
| CSS 5. KEYCAPS (228-305) | `.key/.shadow/.wall/.cap`, down/latched/locked, mod keys | `style.css` |
| CSS 6. SOLVED TOAST (307-322) | `.toast` | `style.css` |
| CSS PROGRESS TOKEN SHEET (323-355) | `.sheet`, `.sheet-bg` | `style.css` (dev menu reuses it, plus `.dev*` rules appended) |
| CSS PARTICLE OVERLAY (356-359) | `.fxc` canvas | `style.css` |
| `<body>` markup (362-412) | header, board, toast, pad, canvas, token sheet | `tools/build.mjs` HTML template (identical, plus `#pid`, `#dead` banner, `#devSheet`) |
| JS 1. PUZZLE DATA (416-425) | `PUZZLE`, `SOLUTION`, `GIVEN`, `SOL`, `LONG_MS`, `RIPPLE_MS` | puzzle -> `puzzles.js` (`PROTO`, id `proto`, dev only); constants -> `util.js` |
| JS 2. GEOMETRY (427-450) | `rowOf/colOf/boxOf`, `ROWS/COLS/BOXES`, `unitsOf`, `PEERS`, `PEERFLAG`, `bit`, `reducedMotion` | `util.js` |
| JS 3. STATE + UNDO (452-470) | `S`, `pending`, `snapshot/pushUndo/restore` | `state.js` (`pending` -> `S.pending`) |
| JS 4. AUDIO ENGINE (472-694) | `sfx` (unlock, pen, pencil, mod, release, select, noteTick, blocked, error, latch, erase, scratch, flick, whoosh, complete) | `audio.js` (verbatim) + `?debug=1` call log |
| `haptic` (696-699) | vibrate | `util.js` |
| JS 5. DOM BUILD (701-766) | `$`, element refs, `cells`, `digitKeys`, `div`, `buildBoard`, `ICONS`, `makeKey`, `buildPad` | `$`/`div` -> `util.js`; `buildBoard`/`cells` -> `board.js`; `ICONS`/`makeKey`/`buildPad`/`digitKeys`/mod keys -> `pad.js` (listeners bound in `input.js`) |
| JS 6. RENDERING (768-838) | `killGhost`, `renderCell`, `renderAll`, `conflictAt`, `countOf`, `isLocked`, `refresh` (+ `prevLeft`, `mistHeld`, `mistGen`) | `renderCell/renderAll/killGhost/refresh` -> `board.js`; `conflictAt/countOf/isLocked` -> `state.js`; `mistHeld/mistGen` -> `state.js` (`UI`) |
| JS 7. MOTION (840-996) | `animPop`, `animFlash`, `animNoteIn`, `animNoteFlick`, `animErase` (+`ERASE_MS`, `ERASE_STROKES`), `animFlip`, `animReach`, `animModeShimmer`, `animPing`, `bumpCounter`, `animNoteOut`, `animShake`, `animBlink`, `animSweep`, `animCascade`, `CASCADE_STEP`, `SWEEP_STEP`, `dist` | `board.js` (cell effects); `dist` -> `util.js` |
| JS 7b. PARTICLES (998-1331) | `FX` pool + rAF loop + emitters `clear`, `crumbs`, `flecks`, `flickOff`, `ring`, `loadPulse`, `undoLift`, `toCounter`, `spark`, `absorb`, `gather`, `chips`, `release`, `wave` | `particles.js` (verbatim; `undoLift` gains an optional target element so Rewind can reuse it) |
| JS 8. GAME ACTIONS (1333-1466) | `toggleNote`, `placeProvisional`, `clearCell`, `finalizePending`, `convertPendingToNote`, `consequences` | `actions.js` (+ rules hooks from `state.js`: silent wrong, dead end, Spot it) |
| Digit key (1468-1507) | `digitDown`, `digitLong` (cell-first / number-first) | `input.js` |
| Cells (1509-1534) | `lastTap`, `selectFx`, `cellDown`, `cellLong` | `input.js` |
| Modifier keys (1536-1595) | `togglePencil`, `doErase`, `doUndo`, `release`, `resetGame`, `showToast`, `hideToast` | `actions.js` |
| JS 9. PRESS SYSTEM (1597-1679) | `presses`, `pressStart`, `pressEnd`, `cancelAllPresses`, `bindPress`, board listener, window/document listeners, unlock hooks, zoom killers, `bindHeaderBtn`, mute/reset/again buttons | `input.js` (`againKey` handler -> `game.js`, it becomes "Next" after a Spot it) |
| JS 10. KEYBOARD (1681-1712) | keydown/keyup | `input.js` |
| JS 11. BOOT (1714-1720) | build + first render | `main.js` |
| JS 12. TOKEN + AUTOSAVE (1722-1868) | `Token` codec (SDK1), `packState`, `unpackState`, `applyState`, autosave, token sheet UI | `token.js` (save key becomes `sudoku.save.v1.<puzzleId>`, byte 1 = puzzle tag). Step 9: the envelope moved to `tokencodec.js`, the sheet to `backup.js` (SDK2 backup code, `docs/token.md`) |
| JS 13. PWA (1870-1877) | service worker registration | `main.js` |
| `loadSaved()` (1879) | restore at boot | `game.js` `startPuzzle()` (per puzzle id) |
| `sw.js` | offline cache | `tools/sw.template.js` -> `dist/sw.js` with hashed `VERSION` |

New modules with no prototype counterpart:

| Module | Purpose |
|---|---|
| `shared.js` | `ALLOW`, `WORLD_TECHS`, candidate encode/decode, daily rhythm + epoch. Shared by the browser and `tools/pipeline-common.mjs` |
| `puzzles.js` | embedded `data/puzzles.json` (virtual module `./puzzles-data.js`, made by the build), lookup by id, cands decoding, Spot it solution lookup via `source` |
| `game.js` | start / switch puzzles (free play, Spot it), per-id autosave restore, Next |
| `devmenu.js` | temporary DEV sheet (puzzle picker, daily, token) |
| `main.js` | boot |
| `morph.js` | step 10: spatial screen transitions (expand from the tapped key / collapse into its anchor / crossfade), sheet + toast springs, the swoosh sounds |
| `uistate.js` | step 10: "last seen" values (`sudoku.ui.v1`) so bars and counters animate only the delta, once |
