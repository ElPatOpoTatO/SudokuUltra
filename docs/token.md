# Backup code (progress token v2, step 9)

The **backup code** moves the player's whole game to another browser or device: copy it, paste it in the other session, and that session has the same everything (campaign charges, mastered worlds, expertise, unlocks, settings, Free Mode history, the Daily streak, and the puzzle in progress). It is scrambled and checksummed, so typos and edits are rejected. The UI labels it honestly as a backup code: it is not a password and it is not cheat-proof (the scramble key is in the game's code).

| File | What it holds |
|---|---|
| `src/tokencodec.js` | The envelope shared by SDK1 and SDK2: salt, mulberry32 keystream scramble with byte chaining, CRC32, strict base64url, the 0x00/0xFF RLE, the SDK1 puzzle tag. Pure (no DOM) |
| `src/tokenformat.js` | `makeFormat(DATA)`: the SDK2 payload (pack / unpack + full validation), SDK1 migration, `encode` / `decode` of code strings, the error messages. Pure; the shipped puzzle data is passed in |
| `src/backup.js` | The game side: the snapshot read from the per-module stores, the atomic apply and **Undo load**, the unified autosave, the Backup code sheet, the Settings row and the Home link |
| `src/backup.css` | Sheet, Settings row and Home link styles (the build appends it after `freemode.css`) |
| `src/token.js` | Unchanged role: the SDK1 **local** per-puzzle save (`sudoku.save.v1.<id>`). The sheet UI moved out; it gained `packBoard`, `readSave`, `writeSave`, `removeSave`, `cancelSave`, `sheetHooks` |
| `tools/token-test.mjs` | Node: codec + format (round trip, edits, migration, sizes) |
| `tools/token-test.py` | Browser: device A → device B transfer, Undo load, errors, SDK1, entry points, layout |

Small fenced edits (`step 9`): `fmstore.js` (`daily.older`, `onFreeModeState`), `freemode.js` (`resetFreeSession`, `syncFreeMode`, `freeModeOpen`, `flushFreeClock`), `progress.js` (`resumeAfterRestore`), `home.js` (`forgetSessionPlayed`), `devmenu.js` (the DEV chip opens the sheet through `sheetHooks`), `main.js` (`initBackup()` last), `index.html` (the sheet markup), `build.mjs` (`backup.css`).

## Code string

```
"SDK2." + base64url( salt | scramble( payload | crc32(salt | payload) ) )
```

- **salt**: 1 byte, the top byte of `crc32(payload)`. The same data always gives the same code (SDK1 keeps its random salt, as in the prototype).
- **scramble**: `out[i] = plain[i] ^ keystream() ^ out[i-1]` (with `out[-1]` = salt), keystream = mulberry32 seeded from `KEY ^ (salt+1) * 0x9E3779B1`.
- **crc32** (IEEE, big-endian) over salt + payload.
- **base64url**, no padding. Decoding is strict: only the 64 characters, no `=`, and the unused low bits of the last character must be zero, so no two strings decode to the same bytes.
- Pasting tolerates whitespace anywhere (spaces, tabs, line breaks, NBSP, zero-width spaces).

## Payload

`payload = version (1 byte) | RLE(body)`. The version byte is outside the compression so that any future format can still be recognised.

**RLE.** A byte other than `0x00` / `0xFF` stands for itself. `0x00` or `0xFF` is followed by a count byte `n`: a run of `n + 1` copies (1 to 256). Runs are greedy and maximal, so each body has exactly one encoding; the decoder refuses anything the encoder would not produce (a dangling escape, two runs of the same byte that should have been one). It pays off clearly: most of the body is empty bitsets and unused world slots (a fresh profile's 267-byte body packs into 15 bytes), and full bitsets (every Quick Play solved, every charge earned) are runs of `0xFF`.

All multi-byte numbers are big-endian. Bit `i` of a bitset is bit `7 - (i % 8)` of byte `i >> 3` (MSB first).

### Body (uncompressed offsets)

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | **flags**: bit0 board present · bit1 `unlocks.fillNotes` · bit2 `flags.badge` (Settings dot) · bit3 `flags.devUnlockAll` · bit4 Free Mode `challenge` · bit5 sound on · bits 6-7 zero |
| 1 | 56 | **campaign**: 224 two-bit slots, slot = `world * 14 + k` (16 worlds × 14 levels, sized for the full game), 4 slots per byte, MSB first. `k = 0` (Level 0): bit0 = done, bit1 = Spot it 1 skip flag (`flags.skip`). `k = 1..13`: best charges 0-3 (0 = not done) |
| 57 | 2 | **mastered** worlds, bit `w` |
| 59 | 2 | **pendingBuild** worlds (keyboard build animations still to play), bit `w`; must be a subset of mastered |
| 61 | 1 | expertise **tier** (1-based) |
| 62 | 1 | expertise **inner** level (1-10) |
| 63 | 2 | expertise **points** (clamped to 65535) |
| 65 | 3 | **lastFree**: puzzle ref of the last counted Free Mode clean solve (the "same id twice in a row" guard), or none |
| 68 | 3 | **last**: puzzle ref of the puzzle Continue resumes (a shipped puzzle or a Level 0), or none |
| 71 | 1 | **settings**: bits 7-6 style (`sa`, `cherry`, `lp`) · bit 5 layout (`plain`, `checker`) · bits 4-2 preset (`retro`, `ink`, `mint`, `rose`, `ocean`, `forest`) · bits 1-0 Free Mode feedback (`instant`, `conflicts`, `nothing`) |
| 72 | 1 | switch **volume** 0-100 (`round(switchVol * 100)`; the slider's own step is 1 %) |
| 73 | 4 × 42 | **Quick Play**, bands in order gentle, easy, medium, tricky. Per band (`+0` = 73 + 42·b): `+0` 19 B **solved** bitset (150 bits, bit = index in the band's list) · `+19` 19 B **played** bitset · `+38` u16 **best** time in seconds (0 = none) · `+40` u16 **current** (index + 1, 0 = none) |
| 241 | 2 | Daily **streak** |
| 243 | 2 | Daily **lastDay** (day number, `0xFFFF` = none) |
| 245 | 2 | **anchor** = the most recent solved day (or lastDay if later), `0xFFFF` = none |
| 247 | 2 | the anchor day's solve time in seconds |
| 249 | 2 | **total** dailies ever solved |
| 251 | 8 | **solved days**: bit `i` = day `anchor - i` was solved (the last 64 days) |
| 259 | 8 | **late days**: bit `i` = day `anchor - i` was solved late; subset of the solved bits |
| 267 | 141 | **board** (only when flags bit0): `+0` 41 B values, one nibble per cell, high nibble first (cell 81's low nibble is zero) · `+41` 92 B notes, 9 bits per cell (bit for digit 1 first), 729 bits + 7 zero bits · `+133` u16 mistakes · `+135` u8 paid hints · `+136` u16 silentWrong · `+138` u16 elapsed seconds |

Body: 267 bytes, 407 with a board (version byte not counted).

**Puzzle ref** (3 bytes): byte 0 = `kind << 4 | sub`, then a u16 index. Kinds: 0 none (all three bytes zero), 1 Spot it, 2 Use it, 3 Master (`sub` = world, index into that world's pool), 4 Quick Play (`sub` = band 0-3, index into the band), 5 Daily (`sub` 0, index into the 400 dailies), 6 Level 0 (`sub` = world, index 0). The index is the position in the shipped list, so a code is tied to the puzzle data of its version (a data change that reorders lists needs a new `FORMAT_VERSION`).

**Day numbers** are days since `DAILY_EPOCH` (Monday 2026-01-05), as stored by Free Mode. The code stores them as they are; nothing is computed from today's date.

### What is derived, quantized or dropped

| Data | In the code |
|---|---|
| `unlocks.items` | Derived from mastered on load (profile.js does it) |
| tier | Stored, and must be at least what mastered gives |
| Campaign level done with 0 charges (`k ≥ 1`) | Dropped: a solved level always has at least 1 charge; 0 only exists for a moment before the charge is recorded |
| `flags.clean` | Dropped: step 6 bookkeeping that nothing reads any more (the skip flag that came from it is kept) |
| `flags.fresh` (NEW tags in Settings) | Dropped: the new device shows no NEW tags (the badge dot is kept) |
| Settings `switchVol` | 1 % steps |
| Quick Play `best` | Whole seconds (at least 1 s) |
| Quick Play `played` | A set: the order is the list order |
| Quick Play `current` of other bands | Kept (the puzzle id; their boards stay on the old device, so they resume from the givens) |
| Free Mode `clock` | Only the board's puzzle (its elapsed time); other unfinished clocks are dropped |
| Daily solve times | Only the anchor day's (the one "✓ Solved 4:07" can show); the other days get 0 |
| Daily days older than 64 days before the anchor | Become a count, `daily.older` in `sudoku.free.v1` (new optional field; total dailies = `older` + solved days) |
| Board `elapsed` | Whole seconds, at most 65535 (18 h) |
| Board of a Spot it | Its erased candidates are re-derived from the notes (start candidates the board no longer has) |
| Board notes on filled cells | Dropped (they are never shown) |

### Which board is included

The **last** puzzle is the one Continue resumes (`lastPlayed()`: the session's puzzle, else `sudoku.lastctx`). Its board goes into the code when it is a shipped puzzle, not solved, and has player input (a digit, a changed note, a mistake or a paid hint). It is read from the screen when that puzzle is on the board, otherwise from its local save. A Level 0 is only carried as **last** (it has no board). When the last puzzle has no progress, loading the code removes the other device's save of that puzzle, so it starts fresh as it would on the first device.

**Time.** The board's elapsed time comes from Free Mode's running clock (`clockHooks.ms`, based on `Date.now`) when that puzzle is being played; this is the only field that depends on the clock. Everything else is read from stored data, so the same stored state always gives the same code.

## Loading

`decode` → checksum → version → full validation → only then apply. Order of work:

1. **Prefix.** `SDK2.` → this format. `SDK1.` → migration (below). `SDK3.` or higher → refused as newer. Anything else: "That isn't a backup code." (or damaged when it starts with `SDK`).
2. **Checksum** (CRC32) and strict base64url. Any failure: damaged.
3. **Version byte**: higher than 2 → newer; lower → damaged.
4. **RLE** must be canonical; the body must be exactly 267 bytes (407 with the board flag).
5. **Validation** of every field:
   - reserved flag bits zero; padding bits zero (the 7 note bits, the last value nibble, the 2 bits after 150 in each Quick Play bitset);
   - a charged Master (≥ 1) implies its world is mastered; pendingBuild ⊆ mastered;
   - tier ≥ the tier mastered gives; inner level 1-10 and at least what the points give;
   - style / layout / preset / feedback in range, volume ≤ 100; **no locked item**: the code's style, layout and preset must be unlocked by the code's own mastery (or its DEV unlock-all flag). A code that breaks this was edited (the game never produces one), so it is **refused** as damaged rather than sanitized;
   - puzzle refs: kind 1-6, `sub` in range; lastFree must be a Quick Play or Daily;
   - Daily: late ⊆ solved, lastDay ≤ anchor, total ≥ the solved bits in the window, streak ≤ total, no day before day 0, the anchor time only with the anchor bit, and everything zero when there is no anchor;
   - board: only with a shipped **last** puzzle (not a Level 0), values 0-9, the givens match the puzzle, notes only on empty cells.
6. **Data this version does not have.** A charge, mastery or skip flag for a world that does not exist here, a Quick Play bit past the band's list, a tier above the known tiers: "This code is from a newer version — update the game first." A puzzle index past its list, or a board whose givens differ from the puzzle: "This code is for a puzzle this version doesn't have." (Newer wins when both apply.)
7. **Apply, atomically.** `backup.js` first captures every `sudoku.*` key plus the in-memory profile, settings and Free Mode state (after flushing the board's pending save and Free Mode's running clock). Then it writes the profile (`setProfile`), the settings (`setSettings`), the Free Mode state (`setFreeModeState`), the board's local save and `sudoku.lastctx` / `sudoku.last`. If anything throws, the captured state is written back. Then the game underneath is told the stored state changed (`resumeAfterRestore`): with the board showing (the sheet was opened in a game) the loaded puzzle starts at once; behind Home, Continue starts it.
8. **Undo load.** The captured state is kept for the session; the sheet shows **Undo load** after a successful load (also when it is opened again later). Undo writes every `sudoku.*` key back exactly as it was (keys the load added are removed), re-applies the old profile, settings and Free Mode state, and restarts the old puzzle the same way.

Errors play the existing gentle error (`sfx.error`, a low double clunk, not a buzzer), shake the paste box and say why. Nothing is changed by a failed load.

### Migration (SDK1)

An SDK1 code is the prototype-era token: one board, 208 bytes (`version 1 | puzzle tag | mistakes u16 | solved | 41 B values | 81 × u16 notes`). Byte 1 is only a one-byte hash of the puzzle id, so the loader looks for the shipped puzzle whose tag matches **and** whose givens fit the board (preferring the puzzle on screen, then the one with the most givens). It loads as **board only**: that puzzle's local save and Continue are set, the board starts when it is showing, and the profile, settings and Free Mode data are not touched. A tag of 0 (the prototype's own puzzle) or no fitting puzzle: "This code is for a puzzle this version doesn't have."

### Versioning

- `FORMAT_VERSION` (the first payload byte) is 2. Any change to the body layout, the enum tables (`STYLES_F`, `LAYOUTS_F`, `PRESETS_F`, `FEEDBACK_F`, `BANDS_F`) or the order of the shipped puzzle lists needs a new version. Older payload versions are migrated forward in `unpack`; there is only SDK1 so far.
- New worlds (up to 16), levels within the 14 slots and new Quick Play puzzles within 150 per band fit the current layout. A code that uses them loads on an older game only as far as "update the game first".

## Unified autosave

The per-module keys stay the source of truth and keep their formats (`sudoku.profile.v1`, `sudoku.settings.v1`, `sudoku.free.v1`, `sudoku.save.v1.<id>` + `sudoku.meta.v1.<id>`, `sudoku.lastctx`, `sudoku.last`). On top of them, `backup.js` writes **one snapshot**, `localStorage['sudoku.backup.v2']` = the current backup code, 250 ms after any change (profile, settings, Free Mode, or a board refresh) and on `pagehide` / when the page is hidden. The sheet builds its code on demand from the stores, exactly like the snapshot. The board's own save keeps its separate 250 ms timer in `token.js` (unchanged, so the parity test's random-number sequence is unchanged).

## UI

- **Backup code sheet** (`#sheet`): title with a key icon, "Moves all your progress, settings and your current puzzle to another device. Not a password.", the code (monospace, read-only, selectable) with its length and the puzzle it carries, **Copy**, a paste box, **Load**, **Close**, the message line, and **Undo load** after a success. Fits 375 × 667 with the Undo row (the sheet scrolls if a phone is shorter).
- **Load success**: the latch sound, an energy bolt from the Load key into the sheet's key icon, which pops with a burst of sparks (the spark canvas is lifted above the sheet for that moment). Reduced motion: no bolt, the icon pops in place.
- **Entry points**: the header key icon (in a game), Settings → **Backup & restore**, the small **Backup** link at the top right of Home, and the DEV menu's "Backup code" chip.

## Sizes

From `node tools/token-test.mjs` (characters including `SDK2.`):

| State | Code | Payload (after RLE / before) |
|---|---|---|
| Fresh profile | 33 | 16 B / 268 B |
| Mid-campaign (W0-W1 mastered, W2 half, some Quick Play, a 12-day daily run) | 95 | 62 B / 268 B |
| Everything maxed (5 worlds × 3 charges, every Quick Play solved, 320 dailies) | 125 | 85 B / 268 B |
| Mid-campaign + a Quick Play board in progress (20 digits, notes) | 251 | 179 B / 408 B |
| Maxed + a board with every empty cell full of notes | 335 | 242 B / 408 B |

Random states in the round-trip test range from 172 to 527 characters; the long ones have hundreds of Quick Play puzzles played in random order (dense, unordered bitsets do not compress). The browser test's device A code (campaign, settings, a daily, a Quick Play with a few digits and a note) is about 150 characters.

## Tests

```
node tools/token-test.mjs        # codec + format; prints the sizes (--n 500 --seed 9)
node tools/build.mjs && python3 tools/token-test.py     # browser (TOKEN_PORT, default 8803); screenshots in /tmp/token/
```

| Test | What it checks |
|---|---|
| T1 (node) | base64url strict and equal to Node's; RLE round trip over 2000 arrays and refusal of non-canonical input; seal / unseal; the SDK2 salt is deterministic |
| T2 (node) | 500 random valid states (charges, mastery, settings within unlocks, Free Mode, Daily history, with and without a board, Level 0 as last): `decode(encode(s))` equals the documented normalization, and re-encoding gives the same code |
| T3 (node) | Every single-character edit of three sample codes (about 43 000 edits) is rejected (none decodes, not even to identical data); every truncation, extension and 300+ garbage strings are rejected; whitespace and zero-width characters inside a code are tolerated |
| T4 (node) | SDK1 codes of every pool kind load as board only; the prototype's SDK1 code and a mismatching board are "puzzle"; newer version byte / `SDK3.` / a world-7 charge / a world-9 mastery / tier 9 are "newer"; locked style or preset refused (allowed with the mastery or DEV unlock-all); out-of-range puzzle, givens mismatch, value 10, reserved flags, a charged Master without mastery, volume 101, inner below points, extra or missing bytes |
| T5 (node) | The size report above |
| t1 (browser) | Device A plays two World 2 levels through the board (3 and 2 charges), changes keycaps / colorway / volume in Settings, solves the Daily, leaves a Quick Play with digits, a note and a mistake, copies the code from the header key. Device B (its own profile, settings and puzzle) opens the sheet from Home, pastes the code with line breaks, loads it: latch sound, Undo shown, same profile / settings / Free Mode data, same Home expertise and totals, same map, same Settings sheet (selection and locks), same Free Mode screen, Continue resumes the same board with the same notes, mistakes and clock. Undo load restores every `sudoku.*` key, the profile, settings, Free Mode, Home and B's own board |
| t2 (browser) | Damaged, truncated, newer, empty, not-a-code and unknown-puzzle (SDK1 prototype) messages; the gentle error sound; no Undo; nothing stored changes |
| t3 (browser) | An SDK1 code loads its board on screen (digits, note, mistakes), leaves profile and settings alone, and points Continue at it |
| t4 (browser) | The Settings row and the header key open the sheet; the code is monospace, read-only, selectable; the unified snapshot follows a digit, a setting and a Free Mode change, and is written on pagehide; the code is deterministic; the per-module keys keep their formats |
| t5 (browser) | 375 × 667 and 390 × 844, light and dark: the Home link fits, the sheet fits with and without the Undo row, no overflow; screenshots of Home, the sheet, the load effect, the loaded state, an error and the Settings row |
