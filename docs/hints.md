# Hints and Check my thinking (step 5)

Code: `src/hintlogic.js` (logic, no DOM, runs in Node), `src/hintui.js` (keys, coach line,
board overlays, effects, sounds, check mode, claim sheet). Small fenced edits
(`/* --- hints: ... --- */ ... /* --- end hints --- */`) in `state.js`, `actions.js`,
`board.js`, `input.js`, `token.js`, `audio.js`, `particles.js`, `main.js`, `style.css` and
`tools/parity-test.py`.

## Controls and layout

- **Hint** and **Check** are two compact mod keycaps (same travel, shadow, release sound
  as the pad's mod keys; icon + label laid out like the Rewind key). They sit, with the
  coach line to their left, in the free band between the board and the pad. That band is
  inside `.board-wrap` and absolutely placed, so the board keeps its size and position.
  - 390×844: the band is 95 px high, keys 40 px.
  - 375×667: the band is 34 px high, keys 30 px.
- If that band is thinner than 30 px (wide or short windows, for example 1280×720
  desktop), the keys move into the header, icon-only, left of the token/restart/mute
  buttons (`.app.hb-hdr`). The coach line then floats as a bubble over the board's bottom
  edge, or over its top edge when the hint is about the bottom half.
- **Coach line:** 12 px text. When it doesn't fit, it shrinks in steps down to 10.5 px. If
  it still doesn't fit, it grows upward as a bubble over the board's edge, or floats at the
  top of the board when the hint is about the bottom half. Four pips in front of the text
  show the hint level.
- **Keyboard:** H = hint, C = check, Esc = leave check mode (or close the claim sheet).

## The hint ladder

Each tap goes one level deeper on the **same** hint:

| Tap | Shows | Paid |
|---|---|---|
| 1 Name it | "There's a **Naked Pair** you can use." | no |
| 2 Where | tints the unit (row / column / box; for a naked single, its box). Text: "Look in row 4." | no |
| 3 Show it | accent outline on the pattern cells, the pattern's own digits in accent, the candidates that go in red and struck through. For a placement, the target cell gets the outline. | yes |
| 4 Do it | applies the move with the normal placement / elimination effects and sounds; the coach shows `step.text` | yes |

After level 4 the next tap starts a new hint at level 1. **Any board change** (placement,
note, erase, undo, rewind, restart, new puzzle) resets the ladder and clears its visuals.
Selecting a cell is not a board change. The hint's own level-4 move does not wipe its
reason text.

What a hint is about, in this order (`findHint`):

1. **solved**: "Nothing left to hint: the puzzle is solved." (1 level, free)
2. **wrong digit**: a placed digit that differs from the solution. Without this check, a
   hint built on a wrong board could place a wrong digit. 1 "One of your digits doesn't
   match the solution." → 2 tints its box → 3 outlines the cell (paid) → 4 erases it with
   the normal erase (paid, not a mistake).
3. **missing note**: a cell that has notes but not its solution digit. 1 "Your notes are
   missing a 4 in r2c7." → 2 outlines that cell → 3 writes the note back with the pencil
   effect (paid). This also covers a cell whose only note is wrong.
4. **step**: `nextStep(values, cands, unlocked)`, the easiest available move. In Spot it,
   the hint goes straight to the target step: the stored step if it is still valid,
   otherwise any valid target step.
5. **none**: "No move with the techniques you've learned. Check your notes or try a
   guess-free scan." (1 level, free, never a crash)

**Candidates (`hintCands`):** in a cell with notes, the notes intersected with
`computeCands(values)`. In a cell without notes, the computed candidates. Steps 2 and 3
come first, so by the time a step is searched every placed digit is right and every noted
cell still holds its solution digit. The candidates are therefore a superset of the truth,
and every step found is sound. *Choice to review:* a note the player removed that is
**not** the solution digit is trusted, even if no technique justified removing it. The
spec's "or still logically possible" case is only flagged when the removed digit is the
solution digit.

**Level 4 on an elimination in cells without notes:** the cell gets the surviving
candidates written as notes (`cands & ~eliminated`). An elimination only exists on the
board as notes, so this makes it visible and makes it stick. It is one undo step. In Spot
it, the removed notes go through the same rules path as the player's erasures
(`notesRemoved` → `afterErase`), so the item completes ("Spotted it").

## The `unlocked` rule

`unlocked` is the list of techniques a hint may use and name. Check offers claim types
from the same list.

- Default (`unlockedFor(S.id)`): ids `w<w>-spot|use|master-..` → `ALLOW[w]`. Quick Play,
  Daily, `proto` and anything else → `ALLOW[4]`.
- Override: `hintOpts.unlocked = [...]` in `hintui.js` (null = default). Exposed as
  `__debug.hintOpts` with `?debug=1`.
- A hint never names a technique outside `unlocked`. Level 1 uses display names, and
  levels 2 to 4 only mention units, cells and `step.text` of an allowed step. W0 is full
  house only, so W0 Use it puzzles, which also need hidden singles, honestly reach the
  "no move" message (7 of 12 do).

## paidHints

- `S.paidHints` goes up by 1 for each paid level shown: levels 3 and 4 of a step or
  wrong-digit hint, and level 3 of a missing-note hint. A full step ladder costs 2.
- It is saved per puzzle in the existing meta record `localStorage['sudoku.meta.v1.<id>']`
  as `{ ..., paidHints }`, written with the normal autosave and restored by `loadSaved()`.
  It is not in the SDK1 token.
- A restart (`resetGame`) sets it back to 0, the same as the mistake count.
- For step 7 scoring, read `S.paidHints`, or `hintState().paidHints` (exported from
  `hintui.js`). "No hints used" means `paidHints === 0`. Levels 1 and 2 are free.

## Check my thinking

Checking is free. It never changes the board and never counts as a mistake.

1. Tap **Check**. The key latches with its LED, and the coach says "tap the cells you're
   thinking about". Cell taps now toggle a dashed accent outline (up to 4 cells; filled
   cells are refused). A selected cell or a loaded digit is released.
2. Tap **Check** again. A sheet (token sheet styling) lists the claim types that are
   **unlocked**. A type whose cell count doesn't match is dimmed:

   | Claim | Cells | Digits (keypad) | Needs unlocked |
   |---|---|---|---|
   | This digit goes here | 1 | 1 | always |
   | This candidate can go | 1 | 1 | always |
   | Naked single | 1 | 0 | naked-single |
   | Hidden single | 1 | 1 | a hidden single |
   | Pointing / Claiming | 2-3 | 1 | pointing or claiming |
   | Naked pair | 2 | 0 | naked-pair |
   | Hidden pair | 2 | 2 | hidden-pair |

3. If digits are needed, the coach asks for them and the keypad digits go to the check.
4. `solver.checkClaim(values, cands, claim, solution)` answers. The candidates are the
   hint candidates with each cell's solution digit put back, so a lost note can't make a
   claim look true. If a selected cell's notes are missing a candidate, the answer adds a
   "Careful" note. Pointing / Claiming tries pointing, then claiming.
   - Right: the coach shows a ✓ and the text, and the cells get a soft accent ping and
     ring. `sfx.checkYes` plays: a ratchet tick and a two-note rise, latch-like.
   - Wrong: the specific text, a 1.5 px nudge, and `sfx.checkNo`, a soft falling
     triangle-wave pair. It is never the error clunk.
5. The selection stays for another claim. The sheet's **Stop checking**, Esc, or Check
   with no cells selected leaves check mode. Pressing Hint also leaves check mode.

## Effects and sounds

- **Unit tint** (`.hl.u`): `--accent-same`, sweeps in along the unit at level 2.
- **Outlines:** pattern cells (`.hl.p`) and the target (`.hl.t`) get a 2 px accent outline.
- **Accent fill:** a placed digit (`.hl.f`, `--accent-glow`).
- **Removed candidates:** red and struck through (`.hx span.on`). They sit over the note
  position and hide the note under them, so they also show in cells without notes.
- **Particles** (`FX.hintTrace`): every particle has a source and a purpose.
  - Level 3: thin motes leave the pattern cells and travel to each eliminated candidate.
    Each candidate gets one mote from every pattern cell that shares a unit with it, up to
    32 motes. The red strike lands as the motes arrive.
  - Placements: motes from the other pattern cells to the target. A single has none, so
    it gets the select ring at level 3 and the normal placement spark at level 4.
  - Level 4 eliminations: the notes flick off with the normal note-removal effect.
  - Reduced motion: no particles and no sweeps, only the static highlights.
- **Sounds:**
  - `sfx.hint(level)`: a soft glassy ding with no click transient, rising one pentatonic
    step per level (880 Hz, then up), with ±5% jitter through `pj()`.
  - Level 4 uses the normal `pen`, `flick`, `scratch` and `erase` sounds.
  - The keys themselves use `mod` and the release sound, like every mod key.

## Tests

```
node tools/build.mjs
node tools/test-hints.mjs        # logic (also run by hints-test.py)
python3 tools/hints-test.py      # UI + layout screenshots -> /tmp/hints-shots/
python3 tools/parity-test.py     # parity + flow (unchanged except the band mask)
```

**Parity mask:** the build's Hint / Check band (`.hintbar`, at 390×844 the rectangle
x 14-376, y 520-615) is masked in the parity screenshots, along with the header band that
was already masked. The prototype has nothing there. Particles that cross that band are
also not compared there.
