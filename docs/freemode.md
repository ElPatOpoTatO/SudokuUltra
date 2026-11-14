# Free Mode: Quick Play and Daily Puzzle (step 8)

Free Mode is a single screen with two parts. The Daily card is at the top and the Quick Play band keycaps are below it, followed by the Free Mode feedback setting. Its keys are real `.key` elements, and `settings.js` dresses them like every other key, so the screen follows the player's keycap style (SA, Cherry, Low-profile) and colorway in light and dark.

| File | What it holds |
|---|---|
| `src/freemode.js` | The screen (DOM, presses, render). It also runs the Free Mode session around a puzzle: the play clock, the hint limit, the feedback rule, solve bookkeeping, the solved toast and the streak ignite |
| `src/freemode.css` | Screen styles. The build appends this file after `keys.css` |
| `src/daily.js` | Daily logic with no DOM: day number and index, week strip, streak, countdown |
| `src/quickplay.js` | Quick Play logic with no DOM: bands, what each needs, when each is offered, picking without repeats, time format |
| `src/fmstore.js` | `getFreeModeState()` / `setFreeModeState(obj)` / `updateFreeModeState(fn)`, stored under `sudoku.free.v1` |
| `src/fm-progress.js` | `masteredWorlds()` and `learnedTechniques()`. This is the only module that knows how mastery is stored |
| `tools/freemode-test.py` | Browser tests and screenshots (port 8774, `FM_PORT` overrides) |

Edits to shared files are fenced with `/* --- step8: … --- */ … /* --- end step8 --- */`:

- `src/state.js`: `ruleHooks.feedback`, `feedbackMode()`, `shownConflict(i)`. `wrongAt` also fires for `'instant'`, and `checkDeadEnd` only runs in `'conflicts'` mode.
- `src/board.js`: the red `conflict` class comes from `shownConflict(i)`.
- `src/actions.js`: applies the feedback rule in `consequences()`. (The TEMP solved emitter was removed on merge: step 7 emits `sudoku:solved`.)
- `src/main.js`: imports the module and calls `initFreeMode()` after `initCampaign()` and before step 7's `initProgress()`, so that it chains behind the campaign's toast and Next hooks and step 7 wraps last.
- `tools/build.mjs`: appends `freemode.css`.

## Contract with the progression step (step 7)

**Merged.** The final wiring is described in `docs/progression.md` → "Integration with Free Mode". In short: one `sudoku:solved` event from step 7, whose `ms` is this module's clock (`events.clockHooks.ms`); mastery from `profile.js getProfile().mastered`; Home's Free Mode key opens this screen and its Home key shows Home; the game header's single back control (step 7's `#homeBtn`) returns Free Mode puzzles here; the clock also pauses behind step 7's screens. The notes below are the original step 8 contract, updated where the merge changed it.


- **Navigation.** `sudoku:nav` with `{to:'free'}` calls `openFreeMode()`. The Home keycap (and Escape) dispatch `{to:'home'}`. Any `sudoku:nav` with another `to` closes the Free Mode screen, and step 7 shows Home / the map / Settings.
- **Solves.** The module listens to `sudoku:solved` with `{id, mode, world, mistakes, paidHints, silentWrong, ms, charges, clean}`. It recognises Free Mode puzzles by its session `id`, not by `mode`, and handles a solve once (`session.done`). The event's `ms` is this module's clock (it registers `events.clockHooks.ms`); if it were ever missing, it falls back to `elapsed()`.
- **Mastery.** `fm-progress.js` imports `getProfile()` from `profile.js` and reads `.mastered` (an array of worlds). If reading it throws, nothing is mastered. The old `sudoku.camp.v1` fallback is gone: the profile migrates that store once. Bands re-render on `onProfile`.
- **Data.** `fmstore.js` holds plain JSON, so the token v2 step can serialize it as is.

```
{ v: 1,
  played:  { gentle|easy|medium|tricky: [ids] },   // handed out since the band's last reshuffle
  solved:  { <band>: [ids] },                      // ever solved (the card's count)
  best:    { <band>: ms },
  current: { <band>: id },                         // puzzle in progress, resumed from the card
  clock:   { <id>: ms },                           // elapsed time of unfinished puzzles
  daily:   { solved: { <day>: ms }, late: { <day>: 1 }, streak, lastDay },
  feedback: 'instant' | 'conflicts' | 'nothing',   // default 'conflicts'
  challenge: false }
```

`<day>` is the **day number**: the number of days since `DAILY_EPOCH` (Monday 2026-01-05), *not* wrapped. The puzzle index is `dailyIndex(date)` from `shared.js`, which equals the day number mod 400. Day 400 and day 0 share a puzzle but are different days for the streak.

## Quick Play

| Band | Hardest technique | Card label | Offered when |
|---|---|---|---|
| Gentle | full house, hidden single | needs Hidden Singles | always |
| Easy | naked single | needs Naked Singles | World 2 mastered |
| Medium | pointing / claiming | needs Pointing | World 3 mastered |
| Tricky | pairs | needs Pairs | World 4 mastered |

- A band that is not offered shows a lock and "Master World N" with dimmed legends. Pressing it plays the blocked sound and rattles the lock, and nothing starts.
- **Challenge me** opens every band. A note appears ("Bands past your mastered worlds are open. Hints only use techniques you've learned."), and on each card that opens, the lock's shackle swings open where it sits and fades.
- **Hints in Free Mode** (Quick Play and Daily) only use `learnedTechniques()`. That is Gentle's set (`ALLOW[1]`) plus the techniques of every mastered world, with or without Challenge me. When a Free Mode puzzle starts, the module sets `hintOpts.unlocked`. When any other puzzle starts, it clears the value, but only if Free Mode set it.
- **Pick:** a random puzzle from the band that has not been handed out since the last reshuffle. Starting a puzzle counts as playing it. When a band is exhausted, `played` resets and the puzzle just played is not picked first. `current[band]` remembers the unfinished puzzle, and the card then shows a lit LED, a latched cap and "Resume · 1:14". Pressing the card resumes that puzzle with its autosave and clock.
- **Card stats:** the solved count and the best time. **Toast:** "Solved" (or "New best"), then "Gentle · 4:07 · clean", with a **Next puzzle** keycap that gives a new puzzle from the same band.

## Daily Puzzle

- **Today** is the device's local date. The index uses the existing rule (`shared.dailyIndex`), so everyone gets the same puzzle on that date with no server. The band follows the weekly rhythm in the data, and the title shows it, for example "Thursday · Medium".
- **Week strip:** seven small keycaps, Monday to Sunday. A day solved on its own date shows a latched cap, a lit LED and the latch colour. A day solved late shows a small check and no LED. Future days are empty outlined slots on the plate, and pressing one plays the blocked sound. Today has a mark on the plate under its key. Pressing a past day opens that day's puzzle.
- **Footer:** "Play" (or "Resume · time") on an accent keycap. Once today is solved, it shows "✓ Solved 4:07" and the keycap becomes **Replay**, which restarts from the givens. Under it: "Next daily in 5h 12m" (refreshed every 20 s while the screen is open, and the screen re-renders when the date changes).
- **Streak** = consecutive days whose daily was solved *on that day*:
  - The first solve of today: if the last streak day was yesterday, the streak goes up by 1. If it was today, nothing changes. Otherwise the streak restarts at 1.
  - A replay changes nothing (`daily.solved[day]` keeps the first time).
  - A past day solved from the strip is marked solved and `late` but never counts. Yesterday counts as a past day too.
  - The streak shown is 0 once a day has been missed (`lastDay < today − 1`).
  - Midnight grace: a daily opened on its own day and finished just after midnight still counts.
  - When a daily is opened without the screen (for example the last puzzle restored at boot), its day is the most recent day ≤ today that has that puzzle index.

## Free Mode feedback (Free Mode only)

| Setting | Wrong digit with no clash | Digit that clashes | Dead-end banner |
|---|---|---|---|
| Instant truth | red at once, counts as a mistake (shake, chip) | red, mistake | off (wrong digits are already flagged) |
| Conflicts only (default) | silent (`silentWrong`) | red, mistake | on |
| Nothing | silent | **no red**, not a mistake (`silentWrong`) | off |

`freemode.js` sets `ruleHooks.feedback = () => kind is quick/daily ? setting : 'conflicts'`, so campaign puzzles, Spot it and Level 0 never change. When the setting changes during a Free Mode puzzle, the board refreshes at once.

## Effects and sound (source and purpose)

- **Keycap presses:** the cap goes down and the switch sound (`sfx.mod`, routed to the player's switch) plays on pointerdown, with release on the upstroke, like the pad. On this scrollable screen the *action* runs on release, and dragging more than 10 px cancels it (it is a scroll). Enter and Space work on focused keys. While the screen is open, `UI.sheetOpen` keeps keyboard input away from the board.
- **Streak ignite:** when a daily solve raises the streak, the toast shows a streak row with an unlit flame outline. Nine embers rise from **the cell that finished the puzzle** (found from the last undo snapshot) along bowed paths to the flame. The first ember to arrive lights it: a scale pop, a soft low-pass "fwoomp" (synthesized with `sfx.prims`, ±5% pitch via `pj()`) and a latch chime. With reduced motion there are no embers and the flame fades in.
- **Lock:** rattles when pressed while locked, and the shackle opens when Challenge me unlocks the card.
- **Screen:** fades in and rises 10 px (opacity only with reduced motion).

## Game-side additions

- **Header back control:** step 7's `#homeBtn` (left of the header). During a Free Mode puzzle it shows a chevron and opens this screen (`nav('free')`). The old `#fmBack` button was removed on merge.
- **Clock:** runs while a Free Mode puzzle is on screen, unsolved and the tab is visible. It pauses while the Free Mode screen or any step 7 screen (Home, map, level list) is open. A puzzle that was only booted behind Home does not run or persist a clock until it is shown. It is saved to `clock[id]` on pause and pagehide, and restored on resume. A solved board brought back into play continues the clock, or starts it over when the board is back to the givens (restart).
- **Boot:** the app opens on Home (step 7); `#free` opens this screen over Home.

## Tests

```
node tools/build.mjs && python3 tools/freemode-test.py [daily streak quick feedback persist nav layout]
```

Each test:

- **daily:** checks 8 dates (including 2027-02-08 = 399, the wrap 2027-02-09 = 0, and a date before the epoch) against `shared.dailyIndex` and a day count done in Python. The band follows the rhythm. With a faked clock, the screen title and Play follow the device date.
- **streak:** uses a faked clock: Monday 1, Tuesday 2, replay still 2, skip Wednesday so Thursday shows 0, Wednesday solved from the strip is late and not counted, then Thursday 1. It also checks the strip marks, the "Solved ✓ 0:04" footer, the toast flame lit, and that the ignite source is the last cell placed.
- **quick:** bands locked with no mastery, a locked press starts nothing, Challenge me opens them with the warning, the hardest technique matches the band, and hints stay within the learned set (also with World 2 mastered via an old `sudoku.camp.v1` store migrated into the profile, and after `setProfile()` changes `mastered`). It checks the solved count, best time, Next puzzle and Resume. It makes 150 picks with no repeat, then reshuffles, and through the UI it runs the last two puzzles of a band and then the reshuffle.
- **feedback:** instant truth flags a wrong digit that does not clash; conflicts only stays silent; nothing shows no red even for a clash; a campaign puzzle ignores the setting.
- **persist:** the state is the same after a reload, the screen reflects it, and the solved event carries the contract's fields.
- **nav:** checks the nav events, the Home key dispatching `home` and showing Home, Home's Free Mode key, that the TEMP DEV chip is gone, Escape back to Home, that keys don't leak to the board, the header back control (`#homeBtn data-to="free"` during Quick Play, `home` outside Free Mode, no `#fmBack`), and `#free`.
- **layout:** covers 390×844 and 375×667, light, dark and reduced motion, in SA/Retro and Cherry/Ink. Geometry checks: no horizontal overflow, nothing off screen, no text outside its keycap, no overlapping sections or cards. It also takes screenshots of the Challenge state, the scrolled bottom at 375×667, and the daily toast with the lit flame, all in `/tmp/freemode/`.
