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
| `tools/author-level0.mjs` | Teaching checks: each teaching step shows the intended technique and nothing simpler competes (see Authoring) |
| `tools/level0-test.py` | Playwright tests (engine, World 0, runner, layout) |
| `tools/worlds-test.py` | Playwright tests for Worlds 1-4 (Level 0 via the UI, the four runners, entry points, layout of every coach text) |

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
| `highlight` | no | `{cells?: [..], digits?: [..]}`. `cells` get the pulsing outline (the select ring's inset line). Default: the cells the expect acts on. `"cells": []` means no outline at all (a step with less help: the player finds the cell). `digits` outline those pad keys. Do not list the answer digit in a "which number?" step, because it gives the answer away |
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
| `{"notes": {"cell": c, "digits": [..]}}` | every listed digit is a note in `c` (any order) | select, load, Pencil, flicking off one of the listed notes | Pencil on if needed, select, each key in turn, then the notes go again |
| `{"eliminate": [[c, d], …]}` | none of these notes is left | select, load, Pencil | select, then Erase (when those are the cell's only notes) or digit key presses in Pencil mode, then the notes are drawn back |
| `{"fill": [cells]}` | every listed cell holds its answer (any order, cell-first or number-first) | select, load, Pencil, the player's own notes | the next listed cell the solver can fill right now is placed, then rubbed out |
| `{"loadDigit": d}` | `d` is loaded (number-first) | unloading, Pencil | key press and load pulse, then unload |
| `{"press": "pencil"\|"erase"\|"undo"}` | that key was pressed | select, load | key press (Pencil toggles on and back off) |
| `{"continue": true}` | the **Got it** keycap was pressed | — | (none) |

Every other action is wrong. Wrong actions are blocked: nothing on the board
changes, the blocked sound plays, and the coach shows the nudge for 3.4 s. These
get their own nudge whatever the step's `nudge` says:

- A digit in a cell that is not the outlined one gets "Use the outlined cell." When the step outlines several cells (or none), it says why that cell is out instead, for example "This row already has a 5." (a peer already holds the digit), else the step's `nudge`.
- A placement with Pencil on (the action would write a note) gets "Pencil is on, so that would be a note…".
- A digit during a note step with Pencil off gets "Turn Pencil on first, then press d."
- A wrong digit in a `notes` or `fill` step that a peer already holds gets "This column already has a 1." (row, column or box, whichever holds it).
- Pressing a to-be-erased digit with Pencil off in an `eliminate` step gets "Turn Pencil on first, then press d to rub it out."
- Board input during a `continue` step gets "Tap Got it when you're ready." This one does not count toward show me.

A long press would turn a placement into a note. In Level 0 it is quietly
ignored, unless the step expects exactly that note.

After a step is done, there is a soft rising tick (`sfx.noteTick`, pitch climbs
with the step number), the step's dot fills, and about 0.4 s later the next step
begins. Between two placement steps the wait is 0.3 s. The selection carries
over only when it is on a cell the next step acts on. A loaded digit carries
over after a `loadDigit` step, and into any step that uses only that digit (so
"Keep 6 loaded" chains work in number-first).

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
  `allSteps(values, cands, ALLOW[world])` on the board as it is at that step,
  where `cands` are the **logical candidates**: `computeCands` minus every
  elimination the script has made so far (only from World 3 on, where erasing
  notes is a technique). So a single that only exists after a pointing or pair
  elimination is accepted. In W0 the placement must be a real full house at
  that moment.
- **notes:** like note, for each digit.
- **fill:** Pencil is on; a listed cell is filled; or the cells cannot be
  filled one after another, each placement justified (as for place) at its
  moment.
- **note:** Pencil is off; the cell is filled; the note is already there; or a
  peer already holds the digit (so it is not a candidate).
- **eliminate:** the note is not there, or the digit is the cell's answer
  (erasing the answer teaches the wrong thing). From World 3 on, erasing a
  note that is still a logical candidate must be justified: one solver step
  (pointing, claiming, naked pair or hidden pair, within the world's
  techniques) must remove all of them. Erasing a note that was never a
  candidate is always fine.
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

`validate-level0.mjs` also checks broken copies of the scripts that must be
rejected: 13 derived from World 0, plus 4 for the newer rules (a note that is
not a candidate and a fill with Pencil on, from World 2; an elimination no
pointing/claiming step justifies and a payoff placement before its
elimination, from World 3).

## Authoring tips

- Start from a solved grid and remove a handful of cells. Then write the steps
  so that each one is the obvious move once its focus is shown. Run the
  validator after every edit.
- To check that a step really teaches something (for example, that a row has
  only one gap while its column and box still have two), count the gaps by
  hand or with a small script. The validator only checks that the move is
  legal and justified.
- Run `node tools/author-level0.mjs` (it is quick). It has an intent table per
  script (step index → what the step must demonstrate) and checks:
  - a teaching **place** step: the easiest technique that justifies it is the
    intended one, and nothing simpler competes inside the focus (with a digit
    loaded: no simpler placement of that digit; otherwise no full house);
  - a **payoff** place step: it is impossible on the plain candidates and only
    possible after the player's eliminations;
  - a W2 **notes** step: the digits are exactly the cell's candidates;
  - a W1 **tap** of a given: it is the digit of the next placement and lines up
    with the box cell it blocks;
  - a teaching **eliminate** step: one step of the intended technique removes
    those notes, its pattern is the cells the previous tap step had the player
    tap, no technique from an earlier world removes them too (so the new
    technique is really needed), and there is no single-note cell or full house
    in the focus.
- The W3 and W4 boards come from real puzzles: a Quick Play position right
  before a pointing/claiming (or pair) step, with every cell refilled that is
  not needed for the three eliminations and the payoff to stay valid and
  necessary. That is why they keep 23 and 26 gaps: smaller boards always offer
  an earlier-world move that does the same job.
- To try a script in the game, open `dist/index.html?debug=1#l0=w1` (any world
  0-4), or use the DEV menu entry "W1 Level 0". `#camp=1` (or `#camp=1.5` for
  level index 5) starts the world runner.

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

## World 1 script (Cross-hatch), step by step

Board: 10 gaps. The teaching box is the center box (gaps r5c5, r5c6, r6c5,
missing 2, 5 and 6). The 5 in r6c9 blocks r6c5 through its row, the 5 in r9c6
blocks r5c6 through its column, so r5c5 is the box's only spot for 5. It is
not a full house anywhere, and no other 5 can be placed in the focus. The
player uses **number-first** from step 4 on: load a digit, then tap cells.
Every 5 lights up when 5 is loaded. A wrong tap says which line blocks that
cell ("This row already has a 5.").

1. **Got it.** "Now rows and boxes have a few gaps each. Here's a new way in: follow one number."
2. **Tap r6c9.** "This box still needs a 5. Tap the 5 in this row."
3. **Tap r9c6.** "That 5 blocks its whole row, even inside the box. Now tap the 5 in this column."
4. **Load 5.** "Here's a shortcut: press 5 with no cell selected. Every 5 lights up."
5. **Place 5 in r5c5.** "Each 5 blocks its row and column. Tap the one cell in the box no 5 can see."
6. **Got it.** "When a number has only one open cell in a box, it goes there. That's a hidden single."
7. **Load 2.** "Your turn. Load 2."
8. **Place 2 in r2c5.** "Where can 2 go in this box?"
9. **Load 6.** "Rows work the same way. Load 6."
10. **Place 6 in r5c3.** "This row needs a 6. Which of its gaps can take it?"
11. **Place 6 in r6c5.** "Keep 6 loaded. Where does 6 go in this box?"
12. **Place 6 in r4c7.** "One more 6, for this row."
13. **Fill 5 cells (r2c4=8 r3c6=1 r5c2=1 r5c6=2 r6c3=2).** "Five gaps left. Finish the board!"

Outro: "Solved! When a number has only one open spot in a box, row or column, it goes there."

Focus: steps 2-5 light the center box plus the blocking row (step 2), column
(step 3) or both (steps 4-5); step 5 outlines the three gaps of the box, so the
player picks. Step 8 has less help: the top-middle box is tinted, nothing is
dimmed or outlined. Step 10 lights row 5 plus the two 6s that block its other
gaps. Steps 10-12 keep 6 loaded.

## World 2 script (Last candidate), step by step

Board: 9 gaps. r4c3's row, column and box hold seven different numbers, so its
candidates are 1 and 5. r5c2 sees eight, so its only candidate is 5. Neither
is a hidden single or a full house, so the naked single is the reason. The
player writes the notes by hand (a `notes` step, any order). A wrong note says
which line already holds it ("This column already has a 1.").

1. **Got it.** "Sometimes no number has just one spot. Then ask a cell instead: what can go here?"
2. **Press Pencil.** "Notes help with that. Turn Pencil on."
3. **Tap r4c3.** "This cell's row, column and box hold seven different numbers. Tap the cell."
4. **Notes 1, 5 in r4c3.** "Note the two numbers none of them has. Those are its candidates."
5. **Notes 5 in r5c2.** "Now this cell. Which numbers can it still be?"
6. **Press Pencil.** "Only one note, so it's the answer. Turn Pencil off."
7. **Place 5 in r5c2.** "Write the 5 in."
8. **Place 1 in r4c3.** "That 5 cleared a note here too. Place the number that's left."
9. **Got it.** "When a cell has just one candidate left, that's its number. That's a naked single."
10. **Place 8 in r5c3.** "This cell has one candidate too. Find it and place it."
11. **Fill 6 cells (r2c2=3 r2c3=5 r4c7=5 r5c7=1 r6c3=3 r6c7=8).** "Six gaps left. Finish the board!"

Outro: "Solved! When a cell's row, column and box leave just one number, that number goes there."

Focus: steps 3-4 light r4c3's row, column and box; step 5 lights r5c2's. Step
8 shows how a placement clears a peer's note. Step 10 has less help (nothing
dimmed, no notes).

## World 3 script (Pointing & claiming), step by step

Board: 23 gaps, taken from a real medium puzzle, every note shown. Each of the
three eliminations is needed (no single and no earlier move would remove the
same note) and each one pays off: removing the 3 from r3c1 leaves it a 6,
removing the 7 from r9c7 leaves column 7 one spot for 7, and removing the 4
from r1c7 leaves it a 3. Pencil stays on for the three eliminations.

1. **Got it.** "Every note is filled in for you. Now you'll use the notes to rule numbers out."
2. **Tap r4c1 and r5c1.** "In this box, the 3 notes sit in one column. Tap both cells."
3. **Press Pencil.** "Turn Pencil on to edit notes."
4. **Erase 3 from r3c1.** "This column's 3 has to be one of those two. So rub out the 3 up here."
5. **Got it.** "When a number's notes in a box sit on one line, clear it from the rest of that line. That's pointing."
6. **Tap r7c7 and r7c8.** "Now the reverse: in this row, the 7 notes sit inside one box. Tap both cells."
7. **Erase 7 from r9c7.** "So the box's 7 must be in this row. Rub out the box's other 7."
8. **Got it.** "When a row or column keeps a number inside one box, clear it from the rest of that box. That's claiming."
9. **Erase 4 from r1c7.** "Your turn: the 4 notes in this box share a column. Clear that column's other 4."
10. **Press Pencil.** "Turn Pencil off. Your clean-up left some cells with one note."
11. **Place 6 in r3c1.** "This cell lost its 3. Place the number that's left."
12. **Place 3 in r1c7.** "Same here: it lost its 4."
13. **Fill 21 cells (r1c2=4 r1c6=7 r2c3=7 r2c6=3 r2c8=4 r3c2=3 r4c1=3 r4c9=6 r5c1=4 r5c8=7 r5c9=3 r6c1=7 r6c3=6 r6c9=4 r7c7=7 r7c8=3 r8c2=6 r8c7=4 r9c2=7 r9c3=4 r9c7=6).** "Finish the board! Start with cells that have one note."

Outro: "Solved! When a number's notes line up inside a box or a line, clear it from the rest."

Focus: steps 2 and 4 light the middle-left box and column 1; steps 6-7 light
row 7 and the bottom-right box. Step 9 has less help: the box and column 7 are
lit, nothing is outlined.

## World 4 script (Pairs), step by step

Board: 26 gaps, taken from a real tricky puzzle, every note shown. The three
eliminations form one chain: the naked pair 2/6 in row 2 clears the 2s from
its row and box, which leaves 2 and 6 with only two spots in column 6 (the
hidden pair), and leaves r2c3 and r3c2 as a 7/9 naked pair in the top-left box
(the step with less help). None of them can be done by a pointing or claiming
step or a single, and the hidden pair's payoff is the 3 in row 7.

1. **Got it.** "Notes are filled in again. This time, look for two cells that work as a team."
2. **Tap r2c4 and r2c6.** "Two cells in this row have only 2 and 6. Tap both."
3. **Press Pencil.** "One is 2, the other is 6. Turn Pencil on."
4. **Erase 2 from r2c3, 2 from r1c6, 2 from r3c6.** "So no other cell in their row or box can be 2 or 6. Rub out those 2s."
5. **Got it.** "When two cells in a row, column or box share the same two notes, those numbers are taken. That's a naked pair."
6. **Tap r2c6 and r7c6.** "Now this column: 2 and 6 fit only in these two cells. Tap both."
7. **Erase 3 from r7c6.** "So those two cells are 2 and 6. Rub out the other note."
8. **Got it.** "When two numbers fit only in the same two cells, those cells keep just those two. That's a hidden pair."
9. **Erase 7 from r1c3.** "Your turn: two cells in this box share the same two notes. Clear those numbers from the rest."
10. **Press Pencil.** "Turn Pencil off. Time to place."
11. **Place 3 in r7c3.** "This row's 3 has only one spot left now. Place it."
12. **Fill 25 cells (r1c3=1 r1c5=7 r1c6=5 r1c9=2 r2c3=9 r2c4=2 r2c6=6 r2c7=7 r3c1=2 r3c2=7 r3c5=1 r3c6=3 r3c7=9 r3c9=5 r7c1=6 r7c2=9 r7c6=2 r7c9=7 r8c3=7 r8c6=1 r8c7=3 r9c1=1 r9c3=2 r9c4=6 r9c5=3).** "Finish the board! Start with cells that have one note."

Outro: "Solved! When two cells own the same two numbers, clear those numbers from everywhere else they reach."

Focus: steps 2 and 4 light row 2 and the top-middle box; steps 6-7 light
column 6. Step 9 has less help: only the top-left box is lit, nothing is
outlined.

## World runner (campaign.js)

- The 14 levels of world `w` are `w<w>-l0`, then `spotIt[0..5]`, `useIt[0..5]`
  and `master[0]` from `data/puzzles.json`. **Next** goes to the following level.
  Runner levels always start fresh. After Master, the keycap says **Finish**,
  then the toast says "World w complete" with **Next world** (which starts the
  next world's runner at its Level 0) or, after World 4, **Done**.
- Worlds 0-4 all run this way (a world needs a `w<w>.json` script and its
  puzzles in `data/puzzles.json`).
- The header (DEV label) shows `World 1 · Level 3/13`.
- `localStorage['sudoku.camp.v1']` is
  `{done: {id: true}, clean: {id: true}, skip: {world: true}, unlock: {fillNotes: true}}`.
  Every access is wrapped in try/catch. `unlock.fillNotes` is set when World 2's
  Level 0 is finished (the player has written a cell's candidates by hand).
  **TODO:** the "fill all candidates" button that reads this flag is not built
  yet: it belongs in the pad or the settings sheet, which another branch is
  changing.
- Skip rule: clearing Spot it 1 with no mistakes sets `skip[w]`. From then on,
  that world's Level 0 shows a **Skip** keycap, which goes on to Spot it 1.
- The DEV menu has a "Campaign runner" group at the top, with these rows for
  each world 0-4:
  - **Campaign: World N**
  - **WN Level 0**, which plays Level 0 on its own and ends with **Again**
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
node tools/author-level0.mjs        # teaching checks
python3 tools/worlds-test.py        # Worlds 1-4: w1 w2 w3 w4 run layout (or a subset)
```

`level0-test.py` serves on port 8771 (`L0_PORT=… ` picks another, for example
when another checkout runs it at the same time); `worlds-test.py` uses 8772.
The full `worlds-test.py` run takes about 9 minutes (the four runners type
every Use it and Master solution).

`worlds-test.py` plays each W1-W4 Level 0 through the real UI with one wrong
action (nudge, no mistake, board unchanged) and, in W1 and W3, three wrong
actions ("show me" plays the move, puts the board back, the player repeats
it). It runs the four world runners through all 14 levels with the real input
paths (Spot it by performing its stored step, erasing notes for elimination
steps; Use it and Master by typing the solution), checks "World N complete",
**Next world** / **Done**, the stored progress, the Skip keycap, the DEV menu
rows and the `#camp=N.K` / `#l0=wN` entry points, and checks that every coach
text of every script fits the coach line at 390×844 and 375×667. Screenshots
go to `/tmp/worlds/`.

Screenshots go to `/tmp/level0/`:

- `coach-<w>x<h>-<light|dark|reduced>-{continue,place,note}.png`
- `t2-nudge.png`, `t2-showme.png`, `t2-note.png`, `t2-outro.png`
- `t3-world-toast.png`, `t3-devmenu.png`
