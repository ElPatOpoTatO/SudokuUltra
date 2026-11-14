# Progression: power charges, gates, bars, expertise, the keyboard map, unlocks, Home

Step 7 turns the campaign into something you build up. Every level pays out **power charges** (⚡). Charges open each world's **Master** level. Clearing Master **masters** the world: its keycap is set into your **keyboard** (the campaign map), the next world opens, and Settings gains new **keycaps and colorways**. Clean solves raise your **expertise**. The app now opens on a **Home** screen.

| File | What it holds |
|---|---|
| `src/progcfg.js` | Every tuning number: `MISTAKE_LIMIT`, `MASTER_GATE`, charges per level, sockets, world names, the unlock table, expertise tiers |
| `src/events.js` | `chargesFor()` (the charge rule), `emitSolved()` / `solvedDetail()` (the `sudoku:solved` event), `nav()` (the `sudoku:nav` event), the per-puzzle clock |
| `src/profile.js` | The progress profile: storage, validation, migration, queries (`worldStats`, `totals`, `expertise`, gates), unlock checks, and recording a solve |
| `src/sparks.js` | The energy effects: its own pooled canvas, with `bolt`, `crackle` and `pulse` |
| `src/chargeui.js` | The charge cell, pips, the charge meter (bars), the `sfx.charge` / `sfx.crackle` sounds, and the results card |
| `src/screens.js` | Full-screen layers over the game (one at a time, transform and opacity transitions) |
| `src/home.js` | The Home screen and the expertise block |
| `src/campmap.js` | The keyboard map (16 sockets), the build animation, and a world's level list |
| `src/unlockui.js` | Locked and new tiles in Settings, the gear badge, and the reward on the end-of-world toast |
| `src/fillnotes.js` | The "Fill all candidates" key |
| `src/progress.js` | Wiring: hooks, the results card, the reward toast, Continue, navigation, the in-game Home button |
| `src/devprog.js` | DEV menu rows (unlock all, master worlds, fill a gate, reset) |
| `src/progress.css` | All step 7 styles (the build appends it after `keys.css`) |
| `tools/progress-test.py` | Browser tests P1 to P6, with screenshots in `/tmp/progress/` |

Edits to shared files are small and fenced with `/* --- step7 --- */`:

- `actions.js`: `emitSolved()` at the two solve points (a solved board, a found Spot it).
- `campaign.js`: its store is a live view of the profile, the Master gate in `next()`, `campHooks`, `campCurrent()`, and `startCampaign(w, k, restore)`.
- `settings.js`: `settingsGate`. Locked items fall back to the defaults.
- `settingsui.js`: `setHooks` (sync, open, close).
- `devmenu.js`: the progression rows.
- `main.js`: `initProgress()`, called last.
- `tools/build.mjs`: appends `progress.css`.

## Power charges

A level awards up to **3 charges**:

1. **Solved.**
2. **No paid hints**: `S.paidHints === 0`. Hint levels 3 and 4 are paid.
3. **Few mistakes**: `S.mistakes <= MISTAKE_LIMIT` (1). A dead-end Rewind counts as 1 mistake (`doRewind` adds it).

Only the best result is kept. A worse replay shows "Best kept: 3 ⚡". **Level 0** gives no charges but counts as done (`levels[w-l0] = 0`). Time is not counted, and there is no time badge yet. Spot it levels use the same rule; their mistakes are the instant ones (a wrong digit, or erasing the cell's real candidate).

**Look.** A charge cell is a small battery cell with a bolt (`chargeCell()` → `span.cc`). An empty cell is outlined. A filled cell (`.on`) is charged amber with a glow. The energy colours are `--charge`, `--charge-hot`, `--charge-ink` and `--charge-glow`, with light and dark values. They are the same in every colorway, so a ⚡ always reads as a ⚡.

**Earning (the results card).** When a campaign level is complete, the toast shows 3 empty cells labelled Solved / No hints / ≤ 1 mistake. A missed criterion is labelled with its reason, for example "Hint used" or "2 mistakes". Each earned charge is an energy bolt that travels from where it was earned into its cell:

| Charge | Source |
|---|---|
| Solved | The winning cell. If the card covers it, the board's edge at that cell's height, on its side |
| No hints | The Hint key (in the bar or in the header) |
| Few mistakes | The Mistakes counter |

The bolt crackles along a bowed curve: a jagged trail re-rolled every frame, with a hot core. When it lands, the cell fills with a pop, a burst of sparks and `sfx.charge(n)`. The sound is a rising sawtooth buzz with a tremolo, then a soft zap. It rises 3 semitones for each charge across the three, with ±5 % pitch jitter via `pj()`. While a bolt is in flight, `sfx.crackle()` plays very quietly. Next, every cell above the old best sends a glowing mote into the **world charge meter** on the card, and the meter surges up to its new value. A line reads "+2 ⚡ for World 0" (plus "· Master unlocked" when this solve opens the gate). With **reduced motion** there are no bolts or motes: the cells fill in place with a flash, one after another, and the meter jumps.

The card does not change the toast's title, message or keycap. Free Mode solves show no charge cells, but they still emit the event.

## Gates

- **World 0 is open from the start.** World *w* opens when World *w − 1* is mastered.
- Inside an open world, every level can be played in any order. Level 0 is recommended first but locks nothing.
- **Master** unlocks at `MASTER_GATE` = **24** of the 36 charges from the world's Spot it and Use it levels. The level list shows a locked slot with "24⚡ to unlock" and a gate meter (for example 17/24). If the runner's Next would lead into a locked Master, the runner stops and the world's level list opens, with the lock shaking. A DEV hash `#camp=w.13` still opens Master directly.
- **Clearing Master** (1 or more charges) masters the world. That opens the next world, queues the keyboard build, adds the world's unlocks, sets the gear badge and marks the new items NEW. The Master results card is followed by the end-of-world toast: the reward, a world meter, **Keyboard** (opens the map, where the build plays) and **Next world** / **Done**.

## Bars (charge meters)

`meter()` / `setMeter(m, earned, available, all)`. A meter is a capsule track with a battery nub, a dim fill and a bright amber fill on top, plus a tick for every level (13 per world).

| Bar | Bright | Dim | Track |
|---|---|---|---|
| World | Charges earned in the world | 39 (13 levels × 3, Master included) | 39 |
| Total (Home, map) | All charges earned | 39 × open worlds | 39 × every world (5 × 39 = 195) |
| Master gate | Charges from Spot it + Use it | 24 | 24 |

## Expertise

Tiers 1 and 2 exist now (5 are planned): **Novice** from the start, which covers mastering W0 to W2, and **Solver** once **World 3** is mastered. Each tier has an inner level from 1 to 10, shown on Home and on the map as a tier pill, "Level n", 10 segments (the current one partly filled) and 5 tier diamonds.

- A **clean** solve (3 charges) adds `world + 1` points. In Free Mode the band gives the world: gentle 1, easy 2, medium 3, tricky 4.
- A campaign level counts the first time it reaches 3 charges. A Free Mode puzzle counts unless it is the same id as the previous counted Free Mode solve (a "Play again" loop).
- Inner level = `1 + floor(points / perInner)`, with `perInner` 6 for Novice and 10 for Solver, capped at 10. It **never drops**, not even through `setProfile()`.
- A new tier starts at inner level 1 with 0 points.
- Free Mode clean solves arrive through the `sudoku:solved` event, like everything else.

## The campaign screen: a keyboard being built

The map is a 4 × 4 macropad, "SDK·16", with a case, a plate, screws and an LED. It has **16 sockets**, one per planned world, and 5 worlds exist now. Each socket shows its world's state:

| State | Look | Tap |
|---|---|---|
| Mastered | A keycap in your current style and colorway (sculpted rows for Cherry, checkerboard parity), with the world number and the trick's short name | Opens the level list |
| Open | A bare switch with a softly pulsing amber halo, "W1" printed on the plate | Opens the level list |
| Locked | An empty socket with a lock and "W3" | Blocked sound + shake + "Master World 2 to open World 3." |
| Future | An empty socket with a "+" stem mark | Blocked sound + "More worlds are on the way." |

**The build animation.** Worlds mastered since the map was last seen (`flags.pendingBuild`) start as open switches. The cap then drops in: it falls from above with a slight overshoot, the shadow grows, the plate gives a tiny jolt, sparks fly from the socket's base, and the player's own switch plays (`sfx.pen()` + `sfx.release()`, which the switch voice routes). Each build plays once. With reduced motion the cap fades in, with the same sound.

Under the keyboard, a card for the world to play next (name, world meter, Open / Replay) and a caption.

**A world's level list.** The header has back (to the keyboard) and Home buttons. Below it: the world meter, then the Level 0 key ("Learn the trick", "Start here" or "✓ Done"), Spot it 1–6 and Use it 1–6 as rows of keycaps on a plate (each with its number and 3 pips, plus the section's total, for example 12/18 ⚡), and Master (an accent keycap with pips, or the locked slot with the gate meter). Tapping a key starts the runner at that level.

## Unlocks

Keycaps are earned. The table lives in `progcfg.js`:

| Mastered | Unlocks |
|---|---|
| (start) | SA style, Plain layout, Retro preset |
| World 0 | Ink preset |
| World 1 | Cherry style (brown tactile switch) |
| World 2 | Checkerboard layout + Mint preset |
| World 3 | Low-profile style (clicky switch) + Rose preset |
| World 4 | Ocean + Forest presets |

To change a reward, edit `UNLOCKS` (and `FREE_ITEMS`). An id missing from the table is never locked.

- **Settings.** A locked tile is dimmed: its preview keys desaturated at 38 %, with a lock coin over them. Its small line is replaced by "🔒 Master World N". The Checkerboard segment shows the requirement on a second line. Locked tiles refuse taps: a capture-phase guard plays the blocked sound and shakes the tile. A newly unlocked item wears a **NEW** tag until Settings is closed.
- **Badge.** An amber dot sits on the header gear and on Home's Settings key until Settings is opened.
- **Reward moment.** On the end-of-world toast: "Keycap set — World N is in your keyboard." Then a small plate where three keys wearing the reward (its style, preset or layout) drop in one after another, each with that switch's own sound. Next to it: "New keycaps: Cherry OEM — Pick it in Settings".
- **Old saves** that reference a locked item fall back to the defaults, field by field (`settingsGate` in `settings.js`). Turning DEV "unlock all" off does the same.
- **DEV.** "Unlock all" in the DEV menu (`flags.devUnlockAll`) unlocks every item, every world and every Master gate.

## Fill all candidates

The key is unlocked by finishing World 2's Level 0 (`unlocks.fillNotes`, set by campaign.js). It is a compact mod keycap, **Fill**, left of Hint / Check, in the hint bar or in the header fallback. One press writes every empty cell's candidates (`computeCands`, basic peer elimination) as notes. Cells that already match are left alone.

- It is **one undo step**. Using it is free: no mistake, no paid hint.
- Effect: a pencil-write wave across the board that starts at the cells nearest the key and sweeps outward. Notes pop in, flecks fly, and there are a few pencil scratches (at most 10).
- It is not shown before the unlock, in Level 0, or in **Spot it**. Spot it boards come with their candidates written, and in W3/W4 some were already eliminated, so refilling would undo the lesson. It is also hidden on a solved board.

## Home

At launch the app shows Home, unless the URL opens something directly (`#p=`, `#camp=`, `#l0=`, which the tests use). The game still boots underneath.

- **Title.** SUDOKU spelled in keycaps on a plate. You can press them.
- **Expertise card.** Tier, inner level, and the total charge bar.
- **Continue** (accent spacebar). Resumes the last played puzzle, labelled "World 1 · Spot it 3", "Quick Play · Gentle" and so on. It resumes the campaign runner at that level, with the autosave restored. It is hidden on a fresh profile. Within a session it simply returns to the game underneath, so the runner state stays intact.
- **Campaign** (→ the keyboard map), **Free Mode** (dispatches `sudoku:nav {to:'free'}` and leaves the screens), **Settings** (with the badge dot).
- A footer explains the three charges. **DEV** (top left) opens the dev menu.

Every screen has a way back Home: back / home buttons on the screens, and a Home button at the left of the game header. Escape on a desktop keyboard goes back. While a screen is up, keyboard input does not reach the board.

## Profile format

`localStorage['sudoku.profile.v1']`, plain JSON. `getProfile()` returns a deep copy. `setProfile(obj)` validates the object, applies it, saves it, notifies listeners (the screens re-render) and re-checks the settings gate.

```js
{
  v: 1,
  levels:   { "w0-spot-01": 3, "w0-l0": 0, ... },   // best charges per level id; present = done
  mastered: [0, 1],                                 // also inferred: a Master with >= 1 charge
  expertise:{ tier: 1, inner: 3, points: 14 },
  unlocks:  { fillNotes: true, items: ["preset:ink", "style:cherry"] },  // items = derived from mastered
  flags:    { skip: { "0": true },        // Level 0 shows Skip (campaign.js)
              clean: { "w0-spot-01": true },
              badge: false,               // Settings gear dot
              fresh: ["style:cherry"],    // NEW tags in Settings
              pendingBuild: [1],          // keyboard build animations still to play
              devUnlockAll: false,
              lastFree: "q-easy-007" }    // last counted Free Mode clean solve
}
```

Validation drops unknown level ids, clamps charges to 0–3 (Level 0 is always 0), recomputes `mastered`, `unlocks.items` and the tier, and keeps the inner level at or above what the points give.

**Migration.** If there is no profile yet, the step 6 store `sudoku.camp.v1` is migrated once: done levels become 1 charge, done-and-clean (no mistakes) becomes 2 (hints were not recorded then), Level 0 becomes 0, and the skip flags and `unlock.fillNotes` are carried over. campaign.js now reads and writes the profile through `campStore()`, so `__debug.camp.state().store` still has the same shape.

**Continue** uses `localStorage['sudoku.lastctx']` = `{id, world?, k?}`, written whenever a puzzle starts after boot.

## Events contract (with Free Mode)

```js
// Navigation (any module may dispatch; Home listens for home / campaign / settings; Free Mode for free)
document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to: 'home' | 'campaign' | 'free' | 'settings' } }));

// Emitted ONCE for every solved puzzle, campaign or free, from actions.js (events.js emitSolved)
document.addEventListener('sudoku:solved', e => {
  const { id, mode /* 'campaign' | 'free' */, kind, world, mistakes, paidHints, silentWrong,
          ms /* since the puzzle was opened this session */, charges /* 0-3 */, clean /* charges === 3 */, cell } = e.detail;
});
```

- `world` for Free Mode is the band's world (gentle 1, easy 2, medium 3, tricky 4).
- `kind` is the puzzle kind (`useIt`, `quick`, `daily`, `level0`, …).
- `cell` is the winning cell.
- profile.js records every event. Campaign levels keep their best result, and clean solves feed expertise.
- On `to:'free'` this branch only hides its screens. The Free Mode screens (src/freemode.js) take over from there.

## Tests

```
node tools/build.mjs
python3 tools/progress-test.py        # P1..P6, screenshots in /tmp/progress (P7_PORT overrides the port, default 8797)
```

| Test | What it checks |
|---|---|
| P1 | The charge rule table. Through the UI: clean → 3; paid hint → 2; 2 mistakes → 2; both → 1; dead-end Rewind counts 1 (→ 3, + a clash → 2); a worse replay keeps the best ("Best kept"); Level 0 → 0 charges, done; the event detail |
| P2 | The gate at 23 (runner Next → level list, Master refused) and at 24. Clearing Master → mastered, next world open, reward toast, gear badge, keyboard build (once). Settings: Ink NEW + selectable, Cherry / Checkerboard / Mint locked with "Master World N", taps refused. DEV unlock all; off → fallback. Locked saved settings → defaults |
| P3 | Total, world and gate meters equal the computed values. Expertise rises on clean (synthetic Free Mode) solves and never drops; Solver after World 3; a campaign level counts once |
| P4 | Fill: hidden before the unlock; after it, placed left of Hint, notes = computed candidates in one undo step, free; one Undo restores; hidden in Level 0 and Spot it |
| P5 | Home on launch (no Continue when fresh); Campaign / back; nav events; the map tile starts the runner; header Home → Continue resumes; reload → Home + Continue → same level; profile persists; migration |
| P6 | Screenshots at 390×844 and 375×667 in light, dark and reduced motion: Home, map (empty, mid-build, 3 built), World 3 list, Settings with locks, results card mid-charge and done, unlock reward. No horizontal overflow, no overlaps between main blocks, toast in view |

The older suites now account for Home: they open puzzles with URL hashes that skip it. `keys-test.py` seeds a profile with `devUnlockAll`, so its style / preset matrix can select locked items. `level0-test.py` and `worlds-test.py` read the migrated store from `sudoku.profile.v1`.
