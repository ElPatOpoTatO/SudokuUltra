# Sudoku game: solver core

`src/solver.js` is a human-style sudoku solver written as a plain ES module. It has no dependencies and uses no DOM or Node APIs, so the same file runs in Node 18+ and in browsers. It rates puzzles, gives hints, powers "check my thinking", and detects dead ends.

## Data

- Cells are numbered 0..80 in reading order: `row = i/9|0`, `col = i%9`, `box = (row/3|0)*3 + (col/3|0)`.
- `values`: an array or `Int8Array` of 81 digits. `0` means empty.
- `cands`: a `Uint16Array(81)` of bitmasks. Bit `d-1` is set when digit `d` is still possible. Filled cells have `0`.
- Text uses 1-based names: `r4c6`, `row 4`, `column 6`, `box 5`. Boxes are numbered left to right, top to bottom.

## Exports

| Export | Purpose |
|---|---|
| `TECHNIQUES` | Technique ids, easiest first: `full-house`, `hidden-single-box`, `hidden-single-line`, `naked-single`, `pointing`, `claiming`, `naked-pair`, `hidden-pair` |
| `TECH_INFO` | Maps an id to `{name, world}`. Worlds: full house 0, hidden singles 1, naked single 2, pointing/claiming 3, pairs 4 |
| `computeCands(values)` | Candidates from scratch, using basic peer elimination only |
| `nextStep(values, cands, allowed?)` | The easiest step among `allowed` (an array or Set of ids), or `null`. Does not change its inputs |
| `allSteps(values, cands, allowed?)` | Generator that yields every available step, easiest first |
| `applyStep(values, cands, step)` | Changes the board in place: places a digit and updates its peers, or removes candidates |
| `solveLogically(values, allowed?)` | `{solved, steps, values}`. Works on copies |
| `rate(values)` | `{solved, hardest, counts, steps}`. `hardest` is the hardest technique used, even when the puzzle is unsolved, so check `solved` |
| `countSolutions(values, limit=2)` | Bitmask backtracking that tries the most constrained cell first. Used only to check uniqueness |
| `findSolution(values)` / `uniqueSolution(values)` | The first solution, or the solution only when it is unique (otherwise `null`) |
| `isValidGrid`, `findConflicts`, `isDeadEnd` | Board checks. A dead end is a conflict, an empty cell with no candidates, or a digit with no place in some unit |
| `checkClaim(values, cands, claim, solution?)` | "Check my thinking". Returns `{ok, text}` |
| `ROWS`, `COLS`, `BOXES`, `units`, `peers`, `CELL_UNITS` | Board layout helpers. Units are numbered 0-8 for rows, 9-17 for columns and 18-26 for boxes |
| `parseGrid`, `gridToString`, `cellName`, `unitName`, `bit`, `digitsOf`, `popcount` | Small utilities |

## Step format

Each step is a plain object you can turn into JSON:

```js
{ tech: 'naked-pair',
  unit: { type: 'row', index: 3 },   // or null (naked single)
  pattern: [30, 34],                 // cells that form the pattern
  digits: [2, 7],
  place: null,                       // or { cell, digit }
  eliminate: [[27, 2], [27, 7], ...],
  text: 'r4c4 and r4c8 can only be 2 or 7, so no other cell in row 4 can be 2 or 7.' }
```

The scan order is fixed: units go rows, then columns, then boxes; digits go 1 to 9; cells go in reading order. The same board always gives the same step. Elimination steps are reported only when they remove at least one candidate.

## checkClaim

- `{type:'pattern', tech, cells, digits?}` where `tech` is one of `naked-pair`, `hidden-pair`, `pointing`, `claiming`, `naked-single`, `hidden-single`. If you leave out `digits`, the solver works them out.
- `{type:'place', cell, digit}` / `{type:'eliminate', cell, digit}`. These are checked against `solution`. When you don't pass one, it is computed if the puzzle has a unique solution. The reply also says whether the current board already proves the claim.

## Tests

```
cd /home/claude/sudoku/game
node tools/test-solver.mjs
```

The script prints PASS or FAIL for each test, then the spread of "hardest technique needed" across 300 seeded random puzzles, the share solved, and the average time per `rate()` call. It exits with 1 if any test fails. `tools/puzzle-gen.mjs` is the seeded generator the tests use: it builds a random full grid, then removes clues in 180°-symmetric pairs as long as the solution stays unique.

## Offline puzzle pipeline

```
node tools/generate.mjs [--seed N] [--out data/puzzles.json] [--quick] [--budget SECONDS]
node tools/validate-puzzles.mjs [data/puzzles.json]
```

`generate.mjs` builds all the puzzles the game ships with and writes:

- `data/puzzles.json`: campaign pools, Quick Play and Daily (about 290 KB).
- `data/backlog.json`: up to 300 puzzles that need techniques beyond world 4, kept for slice 2. Each one stores where the solver got stuck (`stuck.values`, `stuck.cands`, the last technique used).
- `data/pipeline-report.md`: counts, candidates tried per accepted puzzle, clue ranges and timing.

The default seed is `20261112`. A full run takes about 15 s on one core, validation included. `--quick` builds a small stock in about 2 s. The output is deterministic for a given seed: only `generatedAt` changes between runs. The one exception is when the time budget runs out (`--budget`, default 600 s). In that case the script writes what it has and reports the shortfall. At the end, generation runs the same validation as `validate-puzzles.mjs` and exits with 1 on any failure.

The rules live in `tools/pipeline-common.mjs` (`ALLOW`, `RULES`, bands, the daily rhythm, the canonical form and the cands encoding), so the generator and the validator share them.

### Worlds and classification

`ALLOW[w]` is the set of techniques from worlds 0..w: W0 full house, W1 hidden singles (box, then row/column), W2 naked single, W3 pointing and claiming, W4 naked and hidden pairs. A puzzle belongs to world `w` when `solveLogically(p, ALLOW[w])` solves it and `solveLogically(p, ALLOW[w-1])` does not.

The solver always takes the easiest step, and every `ALLOW[w]` is a prefix of its technique order. So the `ALLOW[w]` solve is exactly the start of the full solve, up to the first step from a higher world. This means the generator can classify a puzzle with one full solve: the puzzle belongs to the world of its hardest step. The validator checks this independently, the slow way, with two solves per puzzle.

`targetUses` is the number of steps from world `w`'s techniques in the `ALLOW[w]` solve. For W0 it counts full houses in the `ALLOW[1]` solve.

| World | Use it | Master |
|---|---|---|
| W0 | 10-25 empty cells, solvable with W0+W1, at least 70% of steps are full houses | 36-40 clues, solvable with W0+W1, at least 90% of steps are full house or hidden single (box), at least 3 full houses |
| W1 | belongs to W1, 38-46 clues, at least 1 hidden single (row/column) | belongs to W1, 30 clues or fewer, at least 20 hidden singles (at least 4 of them row/column), at least 1 full house |
| W2 | belongs to W2, 26-36 clues, 1-3 naked singles | belongs to W2, 30 clues or fewer, at least 6 naked singles |
| W3 | belongs to W3, 1-3 pointing/claiming steps | belongs to W3, 30 clues or fewer, at least 3 pointing/claiming steps, at least 1 naked single |
| W4 | belongs to W4, 1-3 pair steps | belongs to W4, 30 clues or fewer, at least 3 pair steps, at least 1 pointing/claiming step |

A Master puzzle must also use a technique from the world before (W2 uses hidden singles, W3 naked singles, W4 pointing/claiming).

**Free Mode bands:** gentle means the puzzle belongs to W0 or W1 (28-38 clues), easy W2, medium W3, tricky W4. Quick Play has 150 per band. Daily is 400 puzzles, where `daily[i]` is the puzzle for day offset `i mod 400` and day 0 is a Monday. The weekly rhythm is Mon gentle, Tue and Wed easy, Thu and Fri medium, Sat and Sun tricky. 400 is not a multiple of 7, so when the list wraps the rhythm shifts by one day.

### Generation

- **Candidates:** the generator builds a random full grid by backtracking and reuses it for 6 hole patterns. It removes clues in symmetric orbits (central twice as often as the others, diagonal, left-right mirror, or no symmetry) for as long as the solution stays unique. Each pool has a recipe that can **stop removal early** at a target clue count: near-full (56-71 clues), 36-40, 38-46, 30-36, 27-32, or minimal.
- **Pools** are filled round-robin, one candidate per open pool's recipe. Every candidate is offered to all open pools in priority order: campaign (Master before Use it, W0 to W4), then Quick Play, then Daily, then backlog. It goes to the first pool that accepts it. A puzzle whose canonical form has already been accepted is rejected, so no puzzle appears in two pools.
- **Spot it** snapshots come from Quick Play and Daily puzzles of the matching band (gentle for W0/W1, easy for W2, medium/tricky for W3, tricky for W4), never from campaign puzzles. The generator replays `solveLogically(p, ALLOW[w])` and takes a snapshot right before each world-`w` step. Since the solver always takes the easiest step, at that moment no step from an earlier world exists, and `nextStep(values, cands, ALLOW[w])` returns that exact step. W0 snapshots come from the `ALLOW[1]` replay, because a full-house-only replay of a real puzzle stalls right away. The selection is greedy and prefers: a single available target step (`alts` = how many world-`w` steps exist on that board, capped at 5), an even split of techniques (box/line hidden singles, pointing/claiming, naked/hidden pairs), varied digits, boxes and units, and one snapshot per source puzzle.
- **Canonical form (dedup):** the lexicographically smallest string over 288 cell permutations (8 rotations/reflections × 6 band orders × 6 stack orders), each followed by relabeling digits in order of first appearance. It takes about 0.03 ms per puzzle. It does not cover swapping rows inside a band or columns inside a stack, which would make it 1296 times slower.

### puzzles.json format

```
{ version: 1, seed, generatedAt,
  worlds: [ { world,
              spotIt: [ { id: "w3-spot-01", values, cands?, step, source, alts } ],
              useIt:  [ { id: "w3-use-01",  givens, solution, targetUses, steps, clues, counts } ],
              master: [ { id: "w3-master-01", ... same ... } ] } ],
  quick: { gentle|easy|medium|tricky: [ { id: "q-medium-001", givens, solution, hardest, steps, clues } ] },
  daily: [ { id: "d-0000", givens, solution, band } ] }
```

- Grids are 81-character strings, with `0` for an empty cell. `steps` is the number of solver steps. `counts` is the number of steps per technique.
- `spotIt.values` is the board at the snapshot. `cands` is stored only for W3 and W4, as 81 × 3 hex characters, one bitmask per cell (`decodeCands` in `pipeline-common.mjs`). Earlier pointing or claiming eliminations matter there. For W0-W2, use `computeCands(values)`. `step` is the solver's step object. `source` is the id of the Quick Play or Daily puzzle the snapshot came from.
- If the file ever grows past 400 KB, the generator drops `solution` from quick and daily and sets `solutionsOmitted`. The game can get a solution back with `findSolution(parseGrid(givens))`, which takes about 1 ms. At the current size (about 290 KB) solutions are kept.

### Validation

`validate-puzzles.mjs` re-derives every item from scratch and exits with 1 on any failure. It checks:

- exactly one solution (`countSolutions`), and the stored solution matches `findSolution`
- world membership, with two solves per puzzle
- `targetUses`, `steps` and `clues` recomputed, and the Use it and Master bars
- every Spot it: `nextStep(values, cands, ALLOW[w])` returns the stored step (same tech, placement and set of eliminations); no `ALLOW[w-1]` step is available; the values and cands are consistent with the source puzzle's solution; the placement and eliminations agree with that solution
- Quick Play and Daily band tags re-derived, `hardest` and `steps` match `rate()`, and the daily rhythm holds
- unique ids, and no duplicate canonical form across any pool, the backlog included
- backlog puzzles really are unsolvable with the 8 techniques
- finally, it runs `tools/test-solver.mjs`

A pool that comes up short is reported in the stock summary but does not count as a validation error.

## Game shell (browser)

```
node tools/build.mjs            # -> dist/index.html (+ sw.js, manifest, icons), deterministic
node tools/serve.mjs --port 8080
python3 tools/parity-test.py    # parity with the feel prototype + game-flow tests (Playwright)
```

The shell modules live in `src/` (see `docs/shell-map.md` for what each holds and `docs/shell-report.md` for test results). `src/index.html` is the HTML template; the build inlines `style.css`, the module graph from `src/main.js` and `data/puzzles.json`. URL options: `#p=<puzzle id>` opens a puzzle (`#p=proto` = the prototype's puzzle, DEV), `?debug=1` exposes `window.__debug` for tests. Tap the DEV label in the header for the puzzle menu.

### Screens

The app opens on **Home**; the board always stays loaded underneath the screens.

| Screen | How you get there | What it holds |
|---|---|---|
| **Home** (`src/home.js`) | launch; Home buttons; Free Mode's Home key; Escape | SUDOKU title, expertise (tier + level), total charge bar, **Continue** (resumes the last puzzle played: a campaign level, a Quick Play or a Daily), **Campaign**, **Free Mode**, **Settings**, DEV |
| **Campaign map** (`src/campmap.js`) | Home → Campaign | The keyboard being built (one socket per world), the next world's card |
| **World level list** | a world's key on the map; the game header's back control during a campaign level | Level 0, Spot it 1–6, Use it 1–6, Master (with the 24 ⚡ gate) |
| **Free Mode** (`src/freemode.js`) | Home → Free Mode (`sudoku:nav {to:'free'}`); the game header's back control during a Quick Play / Daily puzzle | Daily card (week strip, streak, Play), Quick Play bands (locked by mastered worlds, Challenge me), the Free Mode feedback setting |
| **Game** | starting any puzzle; Continue | The board. The header's one back control (left) goes to Free Mode during a Quick Play / Daily puzzle, to the world's level list during a campaign level or a world's Level 0, and Home otherwise |
| **Settings** (sheet) | Home → Settings; the header gear | Keycap style, layout, colorway, sound (locked items are earned in the campaign) |

After a solve, a campaign level shows the **power charges** card on the toast; a Free Mode puzzle shows the Free Mode toast (time, "New best", and for a Daily the streak flame). Free Mode solves give no charges, but clean ones raise expertise. Details: `docs/progression.md` (step 7) and `docs/freemode.md` (step 8); the combined events contract is at the end of `docs/progression.md`.

URL options for tests: `#p=<id>`, `#camp=w.k`, `#l0=wN` open the game directly (skipping Home); `#free` opens Free Mode over Home.

```
python3 tools/integration-test.py   # Home + campaign + Free Mode together (INTEG_PORT, default 8799)
```

### Backup code (step 9)

The key icon in the game header, Settings → **Backup & restore** and the small **Backup** link on Home open the **Backup code** sheet: a short code (`SDK2.…`, about 30-130 characters, about 250 with a puzzle in progress) that moves the whole game (charges, mastery, expertise, unlocks, settings, Free Mode, the Daily streak and the current puzzle) to another browser or device. Paste it there and press Load; **Undo load** puts the previous state back. It is scrambled and checksummed (typos and edits are rejected), not a password. Old SDK1 codes still load as a single board. Format, validation and sizes: `docs/token.md`.

```
node tools/token-test.mjs           # codec + format: round trip, edits, migration, sizes
python3 tools/token-test.py         # browser: device A -> device B, Undo, errors (TOKEN_PORT, default 8803)
```
