# Effects audit and pass (step 10): the non-board screens

The rule from the designer: every animation or particle has a **source** (it starts where the action happened) and a **purpose** (its motion explains something). There is no ambient sparkle and no confetti. Effects are few, small and short (250–700 ms). They animate transform and opacity only and use pooled canvas particles. Colours come from the theme variables. Every new sound goes through `pj()`. With reduced motion nothing travels: you get a static flash or crossfade, and the sounds still play. The board and pad were not touched.

Screenshots of every screen before the pass, at 390×844 and 375×667, light and dark: `/tmp/fx-audit/` (contact sheets `sheet-390x844-*.png`).

## 1. Audit (before step 10)

| Screen | What existed | What was missing | What broke the rule |
|---|---|---|---|
| **Screen changes** (Home, map, level list, Free Mode, game) | `screens.js`: a 28 px slide plus fade (deeper = from the right, back = from the left, to the game = 10 px drop). Free Mode had its own CSS transition (10 px rise). Reduced motion faded. | Any link to the key that was tapped. The destination came from a fixed direction, not from the key. Back was not the reverse of forward. Free Mode and the step 7 screens used different motions. | **No source**: a generic slide from the edge. The direction was arbitrary for Home → Free Mode, game → list, and the reward toast → map. |
| **Home** | Screen rise. The title keys can be pressed. The badge dot has a transition. | The title has no moment of its own. The expertise and total charge bars jump to their new values, so the player can't see what a solve earned. | — |
| **Campaign map** | Slide. The **build** (cap drops into its socket with the player's switch sound, a crackle from the socket base, a plate jolt; source = the socket). A locked socket shakes with the blocked sound. | Where you just were. The bars jump. | The open world's switch halo (`sw-wait`) ran **forever** (ambient), and it animated `box-shadow` (paint every frame, not transform or opacity). |
| **World level list** | Slide. When the runner hits a locked Master, the lock shakes. | Arrival order. Which levels just gained charges. The world bar jumps. Nothing marks the moment the Master gate is crossed. | — |
| **Results card** | A bolt from where each charge was earned (the winning cell or board edge, the Hint key, the Mistakes counter) into its cell, then the cell pops with a crackle and a rising `sfx.charge`. Motes feed the world bar, which surges. | A clear separate beat for "Master unlocked". | **Timing**: launches were 420 ms apart but bolts live up to 620 ms, so two bolts flew at once and the landings were uneven. "Master unlocked" was added to the note on the same beat as the bar fill (**overlap**). The meter animated `width` (layout) and the surge animated `filter` (paint). |
| **Free Mode** | CSS rise. Streak ignite: embers fly from the winning cell to the toast flame (good). The lock rattles when pressed and its shackle opens when Challenge me turns on. The feedback thumb springs. | Week-strip days just appear lit. Band counts and best times just change. Locks pop back without motion when Challenge me turns off. | The screen rise had no source. |
| **Settings** | The sheet slides up from the bottom whatever opened it. The swap wave starts at the tapped option (good). A locked tile shakes and plays the blocked sound. NEW tag and badge dot. | Any unlock moment: a freshly earned tile is simply unlocked. | The sheet has no source. **Bug found**: the NEW tag had no positioned parent, so it never showed on its tile. |
| **Backup sheet** | Slides from the bottom. Load success: a bolt from Load into the header key icon, which pops (good). Error: the paste box shakes and the error sound plays (good). | Copy only changed the text line. | The sheet has no source. |
| **Toast / other sheets** | CSS transition (scale .96 and a rise) for the solved toast, the Free Mode toast and the results card. The DEV sheet slides up. | Any link to what opened them. | No source. |

## 2. What was done

Every row is **source → purpose**.

### Transitions (`src/morph.js`, wired into `screens.js` and `freemode.js`)

- **Expand.** The tapped keycap or card → the next screen. A slab in the key's own face colour grows from the key to the screen and dissolves. Meanwhile the destination zooms out of the key's centre (scale .55 → 1, 260 ms, fast-out). The screen you leave stays put under it. If the destination is the board, that screen fades instead.
- **Collapse (back).** The screen you leave → shrinks into its **anchor**, the key that opened it, on the screen you return to (240 ms). The slab lands on that key and fades into it. Anchors: map → Home's Campaign key, Free Mode → Home's Free Mode key, a level list → that world's socket, a puzzle → its level tile, a Quick Play / Daily → its band card or day key / Play key, the game → Continue.
- **Every pair is covered.** Home ↔ map ↔ level list ↔ puzzle, Home ↔ Free Mode ↔ Quick / Daily puzzle, Continue, and the reward toast's Keyboard key → map (it collapses into the world's socket, where the build then plays).
- **Mode.** It is chosen once per navigation, in a microtask after the destination is painted. Rects are read once. Only transform and opacity animate.
- **Input never waits.** The destination takes taps at once (tested at 300 ms). The screen being left has `pointer-events: none`.
- **Interruptible.** A new navigation first finishes the running one at its end state. Inline styles are restored and `.leaving` is cleared.
- **No layout shift.** Transforms only.
- **No source or anchor** (Escape with no anchor, programmatic navigation): the old slide plays as the fallback.
- **Reduced motion**: a 140 / 110 ms crossfade. There is no slab and nothing moves.
- **The board never transforms.** Re-layering the whole board cost a dropped frame on a throttled CPU, so the slab carries the motion and the screen above fades.
- **Sound.** `sfx.swoosh(+1)` / `sfx.swoosh(-1)` (the **2 new sounds**): a soft band-passed air swell that rises into the new screen and falls back into the key, with a faint low body. Gain is about 0.05, with ±5 % pitch via `pj()`. It also plays with reduced motion.

### Sheets and toasts (`regSheet` in `morph.js`)

- **The control that opened them → spring out of it.** The transform-origin is set at the source, clamped to the sheet's edge. The sheet starts at scale .84 and drifts 30 % from the source, 340 ms, slight overshoot. It closes back into the same point (190 ms) and ignores taps while closing.
- This applies to Settings, Backup, DEV and the solved toast. For the toast the source is the winning cell, so the results card and the Free Mode toast are covered too.
- It watches the `show` class, so every opener works unchanged. The CSS transition is switched off while the spring runs, then restored.
- It is skipped in the debug-only classic look, so parity with the prototype holds. Reduced motion: a fade.

### Home (`home.js`)

- **The SUDOKU keys → each one drops in turn.** Once per session (`sessionStorage`). The steps are 55 ms apart and each takes 300 ms. Each key lands with the player's own switch at 28 % volume (`swPress`, the existing switch voices). Reduced motion: each key fades in, with the same ticks.
- **Expertise.** The segments → fill from the value last seen to now (scaleX on a child element). Each inner level crossed gives one `noteTick`, climbing the pentatonic ladder, and the "Level n" number steps up with a small pop. The DOM (`data-inner`, aria) is final at once.
- **Total charges bar** → grows by the delta only (scaleX from the old width, the number counts up), with a hot-core opacity flash.
- **"Last seen" store.** It lives in `sudoku.ui.v1` (`src/uistate.js`, separate from the profile and the backup code). Saves are batched. On the first run the store is seeded from the current profile and Free Mode state, so old progress never replays. The map uses the same keys: a delta animates once, on whichever screen shows it first.

### Campaign map (`campmap.js`)

- **The world just played → pulses once on arrival** (a lift of 1.06, 420 ms, 4 sparks at its top). Purpose: "you are here". It is set when a campaign level starts and used up on the next map visit. Locked and future sockets never animate.
- **The open world's halo → breathes twice when the map opens, then rests.** It is now an opacity animation of a pseudo element. Before, it was an infinite `box-shadow` loop.
- **The build** was verified. When you arrive from the reward toast (Keyboard), the game collapses into that world's socket, and the cap drops in there 420 ms later. The source is unchanged: the socket.
- The next-world card's bar shows its own delta once (`wc`).

### World level list

- **Tiles → settle in reading order:** a 6 px rise and fade, 120 ms each, starts spread over 80 ms, so 200 ms in all.
- **Charges since last seen** → those pip cells fill on their tile. The DOM is final at once; a `fx-wait` class holds the paint and the cell's own CSS fill spring plays. The cells go one after another (110 ms apart, at most 600 ms in all), each with a `noteTick`. Then the **world bar delta** grows, then the **gate meter delta**.
- **The Master gate crossed → the lock pops off the Master tile.** It jumps up, tumbles and falls along a gravity parabola (560 ms), with `sfx.latch`, a soft tile bump and 6 sparks. The tile lights from 40 % to full. Reduced motion: the lock fades out and the tile flashes.

### Results card (`chargeui.js`)

- **Even beats.** Each bolt's life is computed up front, and each launch is timed so its cell **lands on a beat 380 ms after the last one**. The three charges read one by one, and the rising `sfx.charge` marks each. Measured: landings 380 / 384 ms apart.
- **Sequence:** charges → (280 ms) motes into the bar → bar delta (520 ms) → **unlock beat**. "Master unlocked" or "World N mastered" gets its own line: it is reserved from the start, so there is no layout shift, and it lights with a lock wiggle, 6 sparks and `sfx.latch`. `RC.phase`: `charging → feeding → unlock → done`. The beats never overlap.
- **The reward** (end-of-world toast) comes after the player presses Finish, so it never overlaps either.
- **Meters animate scaleX, not width.** The surge is an opacity flash of a hot core (`::after`) instead of `filter`.
- Reduced motion: cells flash in place 300 ms apart, the bar jumps, and the unlock line fades in.

### Free Mode (`freemode.js`)

- **The streak rose → an ember leaves the flame for each newly solved day** and lights that day key on arrival. The key latches down with the player's switch at 32 % volume and a climbing `noteTick`. The streak number flips in.
- **A band's solved count went up → the number flips in** (rotateX). **A better best time → the time blinks twice** (opacity) with a tick. Shown once (`fm` in the store).
- **Challenge me off → locks slide back in and their shackles close** (new `.closing`, mirrors `.opening`).
- The screen became a morph layer: it expands from Home's key and collapses into it, and a puzzle collapses into its band or day.
- The DOM (`latched`, texts) is final at once, so the step 8 tests read the true state.

### Settings (`unlockui.js`)

- **The gear badge → one spark flies into the sheet**, to the freshly unlocked tile. It goes from the Home Settings key's dot, or from the header gear.
- **The tile → its lock pops off** (a coin that jumps, tumbles and falls with gravity, then fades). The tile lights: a charge-coloured ring flashes on it and its preview loses the locked desaturation. A soft `sfx.latch` plays.
- It happens once, the first time Settings opens after the unlock (`flags.fresh`). Tiles out of view simply show unlocked.
- The existing swap wave is unchanged.
- The NEW tag now sits on its tile (its parent is positioned).

### Backup sheet (`backup.js`, `particles.js`)

- **Copy → three accent motes travel from the Copy key into the code box**, which answers with a ring (an opacity flash) and a tick. Purpose: it confirms what was copied. A new `FX.carry` emitter, pooled. The FX canvas is lifted above the sheet only while the effect runs.
- The **Load bolt** (Load → the header key icon, then a pop and a crackle) and the **error shake** of the paste box with `sfx.error` were verified and kept.

## 3. What was skipped, and why

- **Transforming the board in a transition.** It costs a dropped frame on a throttled CPU (re-rastering 81 cells into their own layer). The slab and the fading screen carry the expand and the collapse instead.
- **A crackle on every level-list pip.** It was decoration: the cell's own fill spring and the climbing tick already say "charged". It also added main-thread canvas work while the screen arrives.
- **Animating expertise across a tier change.** The new tier starts at level 1, so a fill from the old tier's segments would show something false. It stays static.
- **A sound for the total bar.** Home appearing should not buzz. The motion is enough, and the expertise ticks already sound.
- **The hint claim sheet** (Check my thinking). It is part of the board UI, and board and pad behaviour stay as they are.
- **The title's switch sound on the very first launch.** Browsers keep Web Audio locked until the first tap, so on the first launch the keys settle silently. Audio unlocks on the first press anywhere.

## 4. Performance

`tools/effects-test.py perf` measures rAF deltas over every transition. Each transition runs 3 times, and the "last seen" store is reset before each round, so every round replays the same gains: Home's bars, the next-world card, world 1's list with 21 new pips, its bar and the gate meter.

| | Unthrottled avg / p95 | CPU 4× avg / p95 |
|---|---|---|
| This build | 17.3 / **16.8 ms** | 22.3 / 33–50 ms (run to run) |
| Step 9 build, same flows | 17.0 / 16.8 ms | 20.3 / 33.4 ms |

- **Throttled run, per transition** (frames over 20 ms / all frames): Home → map 15/94, map → level list 23/79 (the heaviest: list DOM build plus pips, bar and gate), list → puzzle 14/92, puzzle → list 12/97, list → map → Home 18/176, Home ↔ Free Mode 10/89 and 10/88.
- **This container has no GPU** (software compositing, 2 cores). A pure compositor animation of a whole screen still runs at p95 16.7 ms when throttled.
- **Where the long frames come from.** A trace shows that while any animation runs, every frame commits on the main thread, and most of that time is `Layerize` and `Commit`: every keycap cap has `will-change: transform`, so the page has many layers.
  - The step 9 build pays the same per-frame cost during its 280 ms slide. Its throttled p95 is 33.4 ms.
  - This build's arrival effects keep frames going for longer (up to about 1.5 s on a level list with many gains), so more of them land on the slow side.
- **Mitigations in place**:
  - The board never transforms.
  - Pips fill tile by tile: one style change and one composited pop per tile, not 21 SVG transitions.
  - Meter numbers count in at most 6 text steps, not every frame.
  - The surge is a WAAPI opacity animation on `::after`, so there is no forced reflow.
  - "Last seen" writes are batched (one write per 400 ms burst).
  - Rects are read once per transition.
- **Target not met here.** The **p95 < 20 ms at 4× throttling target is not met in this environment, by this build or by the step 9 build.** The test checks unthrottled p95 < 20 ms and throttled p95 < 51 ms (at most two vsyncs). The throttled check sits close to its limit (p95 33–50 ms), so it can be flaky on a busy machine.
- **Worth checking on a real device** with GPU compositing. If it lags there, the next lever is fewer permanent layers: drop `will-change` from caps that are not on screen.

## 5. Tests

`tools/effects-test.py` (EFFECTS_PORT, default 8801) runs `nav interrupt reduced deltas layout fx perf shots`. See the file header. Screenshots go to `/tmp/effects/`.
