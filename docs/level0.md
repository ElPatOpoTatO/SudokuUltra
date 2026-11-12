# Level 0: guided scripts

Every world starts with a Level 0. It is not a pop-up. It is a real board that
the player solves one scripted move at a time:

- The coach line under the board says what to do.
- Everything except the focus is dimmed.
- The target cell (or key) gets an outline.
- The player makes the move with the normal keycaps, sounds and particles.

What the engine does:

- **Wrong actions** are blocked. The player hears the blocked sound and gets a
  gentle nudge. A wrong action is never a mistake.
- **Three wrong tries in a row** start "show me". The game plays the move
  slowly, puts the board back, and the player does it again.
- **Finishing the board** runs the normal solve cascade. Then the outro shows in
  the coach line.

Files:

| File | What it holds |
|---|---|
| `content/level0/w<N>.json` | One script per world. The build embeds every file here as `SCRIPTS.w<N>` |
| `src/level0-script.js` | Schema, validator and shared helpers. No DOM, so it runs in Node and in the browser |
| `src/level0.js` | The engine: coach UI, dimming, input judging, show me, outro |
| `src/campaign.js` | World runner: Level 0, then Spot it 1-6, Use it 1-6, Master 1 |
| `tools/validate-level0.mjs` | Command-line validator, plus broken fixtures that must be rejected |
| `tools/level0-test.py` | Playwright tests |

## Script format

```json
{
  "id": "w0-l0",
  "world": 0,
  "title": "Full house",
  "board": "864351729927486513531279684702534168308107402410802075143728956685913247279645831",
  "showCands": false,
  "steps": [ { "say": "…", "expect": { "continue": true } }, … ],
  "outro": "Solved! When a row, column or box has one gap left, the missing number goes there."
}
```

Any field not listed below is an error.

### Top level

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `w<world>-l0`. It must match `world` |
| `world` | yes | 0-4. The world's techniques limit which placements the validator accepts (see Validation) |
| `title` | yes | A short name, for menus |
| `board` | yes | 81 digits in reading order, `0` = empty. Every filled cell is a given. The board must have exactly one solution and no clashes |
| `showCands` | no | `false` (default): no notes at the start. `true` or `"computed"`: start with every candidate as a note (`computeCands`) |
| `steps` | yes | 1-30 steps, played in order |
| `outro` | yes | Coach text shown after the last step |

### Step

| Field | Required | Meaning |
|---|---|---|
| `say` | yes | Coach text. Keep it to 2 short sentences and under 140 characters. Longer text only gives a warning, but it must fit the coach line (the layout test checks this) |
| `expect` | yes | The one action that completes the step (see below) |
| `focus` | no | `{cells?: [..], row?: 0-8, col?: 0-8, box?: 0-8}`. These cells stay bright. `row`, `col` and `box` also get the unit tint (the same tint as peers). If you leave out `focus`, the highlighted cells are the focus |
| `dim` | no | `"all-but"` dims every cell outside the focus, and every key that does not belong to the expected action. `"none"` dims nothing. Default: `"all-but"` when the step has a focus, a highlight or a key to press, otherwise `"none"` |
| `highlight` | no | `{cells?: [..], digits?: [..]}`. `cells` get the pulsing outline (the select ring's inset line). Default: the cells the expect acts on. `digits` outline those pad keys. Do not list the answer digit in a "which number?" step, because it gives the answer away |
| `nudge` | no | The text shown on a wrong action. Without it, the engine uses a default for the step type. Some cases always get their own text (see below) |
| `show` | no | `false` turns off "show me" for this step. It is on by default for every step except `continue` |

Cells are 0-80 in reading order: `row = i / 9 | 0`, `col = i % 9`. Rows, columns
and boxes are 0-based in the file. The coach text says "row 4" in 1-based words
when it needs to.

### expect types

Each step has exactly one of these:

| expect | Done when | Neutral (allowed, never wrong) | Show me does |
|---|---|---|---|
| `{"tap": [cells], "mode": "any"\|"all"}` | `any` (default): one listed cell is selected. `all`: every listed cell has been tapped | deselecting | select ring on the first cell |
| `{"place": {"cell": c, "digit": d}}` | `d` is in `c` (after the key is released) | selecting any cell, loading or unloading a digit, Pencil | select, digit key press, placement spark, then Erase rubs it out |
| `{"note": {"cell": c, "digit": d}}` | the note `d` is in `c` | select, load, Pencil | Pencil on if needed, select, key press, note stroke, then the note is flicked off again |
| `{"eliminate": [[c, d], …]}` | none of these notes is left | select, load, Pencil | select, then Erase (when those are the cell's only notes) or digit key presses in Pencil mode, then the notes are drawn back |
| `{"loadDigit": d}` | `d` is loaded (number-first) | unloading, Pencil | key press and load pulse, then unload |
| `{"press": "pencil"\|"erase"\|"undo"}` | that key was pressed | select, load | key press (Pencil toggles on and back off) |
| `{"continue": true}` | the **Got it** keycap was pressed | — | (none) |

Every other action is wrong. Wrong actions are blocked: nothing on the board
changes, the blocked sound plays, and the coach shows the nudge for 3.4 s. These
get their own nudge whatever the step's `nudge` says:

- A digit in a cell that is not the outlined one gets "Use the outlined cell."
- A placement with Pencil on (the action would write a note) gets "Pencil is on, so that would be a note…".
- A digit during a note step with Pencil off gets "Turn Pencil on first, then press d."
- Board input during a `continue` step gets "Tap Got it when you're ready." This one does not count toward show me.

A long press would turn a placement into a note. In Level 0 it is quietly
ignored, unless the step expects exactly that note.

After a step is done, there is a soft rising tick (`sfx.noteTick`, pitch climbs
with the step number), the step's dot fills, and about 0.4 s later the next step
begins. Between two placement steps the wait is 0.3 s. The selection carries
over only when it is on a cell the next step acts on. A loaded digit carries
over only after a `loadDigit` step.

### Minimal example

```json
{
  "id": "w1-l0", "world": 1, "title": "Hidden single",
  "board": "…81 digits…",
  "steps": [
    { "say": "Where can 4 go in this box?", "focus": { "box": 4 }, "highlight": { "digits": [4] },
      "expect": { "tap": [40] }, "nudge": "Only one cell in the box can still take a 4." },
    { "say": "Put the 4 there.", "focus": { "box": 4 }, "expect": { "place": { "cell": 40, "digit": 4 } } }
  ],
  "outro": "That was a hidden single."
}
```

## Validation

```
node tools/validate-level0.mjs            # every content/level0/*.json, then the broken fixtures
node tools/validate-level0.mjs my.json    # one file
```

`node tools/build.mjs` runs the same validator and fails on an invalid script.
The engine also validates a script before it starts it, and refuses to start an
invalid one.

The validator first checks the schema. Unknown fields, wrong types and
out-of-range cells, digits and units are all errors. Then it plays the whole
script on the board, keeping track of values, notes, Pencil, the selection and
an undo history. These are errors:

- **place:** the cell is not empty; the digit is not the cell's digit in the
  unique solution; the digit clashes with a peer; Pencil is on at that point; or
  the solver cannot justify the placement. The placement must be one of
  `allSteps(values, computeCands(values), ALLOW[world])` on the board as it is
  at that step. In W0 that means the placement must be a real full house at that
  moment.
- **note:** Pencil is off; the cell is filled; the note is already there; or a
  peer already holds the digit (so it is not a candidate).
- **eliminate:** the note is not there, or the digit is the cell's answer
  (erasing the answer teaches the wrong thing).
- **loadDigit:** all nine of that digit are already placed (the key is locked).
- **press erase:** no cell is known to be selected (the step before must act on
  one cell); the selected cell is a given; or it is already empty.
- **press undo:** there is nothing to undo.

Warnings (they do not fail): a `say`, `nudge` or `outro` with more than 2
sentences or more than 140 characters, and a board that is not complete after
the last step. On an incomplete board the outro shows without the solve
cascade.

The validator's output names the step and the cell, for example
`steps[2] (place): r4c2 is 9 in the solution, not 1`.

## Authoring tips

- Start from a solved grid and remove a handful of cells. Then write the steps
  so that each one is the obvious move once its focus is shown. Run the
  validator after every edit.
- To check that a step really teaches something (for example, that a row has
  only one gap while its column and box still have two), count the gaps by
  hand or with a small script. The validator only checks that the move is
  legal and justified.
- To try a script in the game, open `dist/index.html?debug=1#l0=w0`, or use the
  DEV menu entry "W0 Level 0". `#camp=0` (or `#camp=0.5` for level index 5)
  starts the world runner.

## World 0 script, step by step

Board: an almost solved grid with 7 gaps, all in rows 4-6: r4c2, r5c2, r5c5,
r5c8, r6c3, r6c5, r6c7. The steps use 1-based names.

1. **Got it.** "This board is almost full. You'll finish it yourself, one move at a time." Nothing is dimmed.
2. **Tap r4c2.** "Every row holds 1 to 9, once each. Tap this row's one gap." Row 4 is lit and r4c2 is outlined. Row 4 has only this gap, but its column and box still have two gaps each, so the row is the reason.
3. **Place 9 in r4c2.** "Which number is this row missing? Type it." Nudge: "Read along the row. Which of 1 to 9 isn't there yet?"
4. **Place 3 in r6c7.** "Columns follow the same rule. Fill this column's gap." Column 7 has only this gap. Row 6 and box 6 still have more.
5. **Place 9 in r5c8.** "So do the 3×3 boxes. Fill this box's gap." Box 6 (middle right) has only this gap. Its column is also down to one gap at this point, but row 5 still has three.
6. **Got it.** "The last gap in a row, column or box is a full house. Only one number fits."
7. **Press Pencil.** "Pencil marks are notes. Tap Pencil to switch to notes." The Pencil key is outlined and the board is dimmed.
8. **Note 6 in r6c5.** "Notes are free thinking, never mistakes. Write a small 6 here." r6c5 can be 6 or 9 at this point. The 6 key is outlined.
9. **Erase the note.** "Changed your mind? Press 6 again, or Erase, to rub it out." Pressing 6 again or Erase both work.
10. **Press Pencil.** "Tap Pencil again to go back to writing answers."
11. **Place 5 in r5c2.** "Now a chain. This column has one gap left." Column 2.
12. **Place 6 in r5c5.** "That left one gap in this row." Row 5 was not a full house before step 11.
13. **Place 9 in r6c5.** "And one in this box." This is the center box, which had two gaps before step 12. The cell is the one that held the note: it was 9, not 6.
14. **Place 6 in r6c3.** "Last one. Finish the board!" The solve cascade follows.

Outro: "Solved! When a row, column or box has one gap left, the missing number goes there."

One thing for the designer to know: r6c3 (step 14) is already a full house in
column 3 from the start. The focus and the guard keep the order. A board with 4
chain cells where no later cell is a full house early cannot exist: I checked
every arrangement.

## World runner (campaign.js)

- The 14 levels of world `w` are `w<w>-l0`, then `spotIt[0..5]`, `useIt[0..5]`
  and `master[0]` from `data/puzzles.json`. **Next** goes to the following level.
  Runner levels always start fresh. After Master, the keycap says **Finish**,
  then the toast says "World w complete" with **Done**.
- The header (DEV label) shows `World 0 · Level 3/14`.
- `localStorage['sudoku.camp.v1']` is
  `{done: {id: true}, clean: {id: true}, skip: {world: true}}`. Every access is
  wrapped in try/catch.
- Skip rule: clearing Spot it 1 with no mistakes sets `skip[w]`. From then on,
  that world's Level 0 shows a **Skip** keycap, which goes on to Spot it 1.
- The DEV menu has a "Campaign runner" group at the top:
  - **Campaign: World 0**
  - **W0 Level 0**, which plays Level 0 on its own and ends with **Again**
  - a row of 14 level chips, which start the runner at that level. Done levels
    are ticked.

  These chips have no `data-id`, so the existing campaign chip count stays 140.

## How it hooks into the shell

Each edit to a shared file is small and fenced with `/* --- level0: … --- */ … /* --- end level0 --- */`:

| File | Hook |
|---|---|
| `input.js` | `inputGuard.fn(action)` runs before any input changes state. `inputGuard.reset()` handles the header Restart. Mod keys and the keyboard go through `gUndo`, `gErase` and `gPencil`. With no guard set, input behaves exactly as before |
| `actions.js` | `toastHooks.before` (Level 0 shows its outro instead of the toast) and `toastHooks.after` (the runner records the level and relabels the keycap). Mode `'l0'` counts as solvable in `consequences` |
| `game.js` | `gameHooks.start` (listeners called before a puzzle starts), `gameHooks.next` (the toast keycap), `gameHooks.label` (the header label) |
| `devmenu.js` | the runner rows (`campaign.devEntries`) |
| `main.js` | `initLevel0()` after `initToken()`, `initCampaign()` after `loadSaved()`, and `L0` and `camp` on `window.__debug` |
| `index.html` | `<section class="coach" id="coach">` between the board and the pad |
| `style.css` | the coach, the dim overlay, focus and highlight. All of it is inert unless `.app.l0` is set |
| `build.mjs` | the virtual module `./level0-data.js`, and script validation before bundling |

## Layout

The coach is a fixed 80 px slot (`.app.l0 .coach`) between the board and the
pad. The board shrinks to fit once when Level 0 starts, and never moves while
the coach text changes. At 390×844 the board stays 362 px, the same as in normal
play. At 375×667 it goes from 347 px to 325 px. Nothing scrolls at either size.
Dimming is opacity only: one overlay per cell and the opacity of the keys.
Under reduced motion, the outline does not pulse, transitions take 120 ms, and
show me runs at 0.6× its timings.

## Tests

```
node tools/build.mjs
node tools/validate-level0.mjs
python3 tools/level0-test.py        # T1 validator, T2 W0 Level 0 via the UI, T3 world runner, T4 layout
python3 tools/level0-test.py t2 t4  # a subset
```

Screenshots go to `/tmp/level0/`:

- `coach-<w>x<h>-<light|dark|reduced>-{continue,place,note}.png`
- `t2-nudge.png`, `t2-showme.png`, `t2-note.png`, `t2-outro.png`
- `t3-world-toast.png`, `t3-devmenu.png`
