#!/usr/bin/env python3
"""token-test.py — step 9: the Backup code (SDK2) in the browser (Playwright).

    node tools/build.mjs && python3 tools/token-test.py [t1 t2 t3 t4 t5]

  t1  device A (one browser context): campaign levels played through the UI,
      Settings changed in the sheet, a Daily solved, a Quick Play left in
      progress (digits, notes, a mistake) -> header key -> Backup code -> Copy.
      Device B (a fresh context with its own progress): Home link -> paste ->
      Load (latch sound, Undo load shown) -> Home shows the same expertise and
      charges, the map the same worlds, Settings the same style / preset /
      unlocks, Free Mode the same streak and bands, Continue resumes the same
      board (notes, mistakes, clock). Undo load -> B exactly as before (every
      sudoku.* key, profile, settings, Free Mode, Continue).
  t2  error messages: damaged, newer version, unknown puzzle (SDK1 code of the
      prototype puzzle), empty paste; the gentle error sound (not blocked); no
      state touched.
  t3  an SDK1 code (one board) loads as board only: the board switches, the
      profile and settings are untouched.
  t4  entry points: the header key icon, Settings -> "Backup & restore", the
      Home link; the unified autosave (sudoku.backup.v2) follows changes.
  t5  layout at 375x667 and 390x844 (light / dark): the sheet fits with the
      Undo row, no horizontal overflow; screenshots -> /tmp/token/

TOKEN_PORT overrides the port (default 8803). Exit code 1 on any failure.
"""
import asyncio, json, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/token'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = int(os.environ.get('TOKEN_PORT', 8803))
failures, notes = [], []

def check(cond, msg):
    if not cond: failures.append(msg)
    return cond

async def new_page(browser, vp=(390, 844), storage=None, scheme='light', hash_=''):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, device_scale_factor=1, color_scheme=scheme)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=f'http://127.0.0.1:{PORT}')
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    seed = {'sudoku.settings.v1': json.dumps({'v': 1, 'sound': False})}
    seed.update(storage or {})
    await page.add_init_script(f"try {{ if (!sessionStorage.getItem('__seeded')) {{ for (const [k, v] of Object.entries({json.dumps(seed)})) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); }} }} catch (e) {{}}")
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{hash_}')
    await page.wait_for_function('() => window.__debug && window.__debug.prog && window.__fm && window.__debug.backup')
    await page.evaluate(WRAP_SFX)
    return ctx, page, errs

WRAP_SFX = """() => { const o = __debug.sfx; window.__sfx = [];
  for (const k of Object.keys(o)) { const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || typeof d.value !== 'function' || k === 'unlock') continue; const fn = d.value;
    o[k] = function (...a) { window.__sfx.push(k); return fn.apply(this, a); }; } }"""

async def ev(page, js, arg=None): return await page.evaluate(js, arg)
async def tap(page, sel):
    b = await page.locator(sel).first.bounding_box()
    assert b, f'not visible: {sel}'
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down(); await page.mouse.up()
async def click(page, sel):
    b = await page.locator(sel).first.bounding_box()
    assert b, f'not visible: {sel}'
    await page.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
async def cell(page, i):
    if await ev(page, '() => __debug.S.selected') != i: await tap(page, f'.cell[data-i="{i}"]')
async def screen(page): return await ev(page, '() => __debug.prog.screen()')
async def sheet_open(page): return await ev(page, "() => document.getElementById('sheet').classList.contains('show')")
async def msg(page): return await ev(page, "() => ({ text: document.getElementById('tokMsg').textContent, cls: document.getElementById('tokMsg').className })")
async def sfx_log(page): return await ev(page, '() => window.__sfx.splice(0)')

async def solve_free(page):
    last = await ev(page, """() => { const S = __debug.S; let last = -1;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i]) last = i;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i] && i !== last) { S.values[i] = S.sol[i]; S.notes[i] = 0; }
      __debug.refresh(); return [last, S.sol[last]]; }""")
    if await ev(page, '() => __debug.S.selected') != last[0]: await tap(page, f'.cell[data-i="{last[0]}"]')
    await tap(page, f'.key.digit[data-d="{last[1]}"]')
    await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=6000)

STATE_JS = """() => { const p = __debug.prog.getProfile(), s = __keys.getSettings(), f = __fm.state();
  return { levels: p.levels, mastered: p.mastered, expertise: p.expertise, fillNotes: p.unlocks.fillNotes, items: p.unlocks.items,
    skip: p.flags.skip, lastFree: p.flags.lastFree,
    settings: { style: s.style, layout: s.layout, preset: s.preset, sound: s.sound, vol: Math.round(s.switchVol * 100) },
    free: { solved: f.solved, played: Object.fromEntries(Object.entries(f.played).map(([b, l]) => [b, [...l].sort()])), best: Object.fromEntries(Object.entries(f.best).map(([b, ms]) => [b, Math.round(ms / 1000)])),
            current: f.current, feedback: f.feedback, challenge: f.challenge,
            daily: { days: Object.keys(f.daily.solved).sort(), late: Object.keys(f.daily.late).sort(), streak: f.daily.streak, lastDay: f.daily.lastDay } } }; }"""
HOME_JS = """() => { const x = document.querySelector('#home .xp'), t = __debug.prog.totals();
  return { tier: x.dataset.tier, inner: x.dataset.inner, label: x.getAttribute('aria-label'), totals: t,
    cont: document.querySelector('#home .key.cont').offsetParent !== null, contLabel: document.querySelector('#home .key.cont small').textContent }; }"""
MAP_JS = """() => [0, 1, 2, 3, 4].map(w => { const s = __debug.prog.worldStats(w); return [s.open, s.mastered, s.earned, s.gate, s.masterOpen]; })"""
BOARD_JS = """() => { const S = __debug.S; return { id: S.id, values: Array.from(S.values).join(''), notes: Array.from(S.notes).join(','), mistakes: S.mistakes,
  silentWrong: S.silentWrong, paidHints: S.paidHints, solved: S.solved }; }"""
SET_UI_JS = """() => { const q = s => document.querySelector(s);
  return { style: [...document.querySelectorAll('#setSheet .set-tile')].filter(t => t.getAttribute('aria-pressed') === 'true').map(t => t.dataset.style),
    preset: [...document.querySelectorAll('#setSheet .set-swatch')].filter(t => t.getAttribute('aria-pressed') === 'true').map(t => t.dataset.preset),
    locked: [...document.querySelectorAll('#setSheet .lockd')].map(e => e.dataset.style || e.dataset.preset || e.dataset.layout).sort(),
    vol: q('#setVol').value, sound: q('#setSheet .set-toggle').getAttribute('aria-checked') }; }"""
FM_UI_JS = """() => ({ streak: (document.querySelector('#fm .fm-streak') || {}).textContent || '',
  bands: [...document.querySelectorAll('#fm .fm-band')].map(b => [b.dataset.band, b.querySelector('.fm-bstat').textContent.trim().replace(/ · \\d+:\\d+$/, ' · m:ss'), b.classList.contains('locked')]),
  open: __fm.isOpen(),
  week: [...document.querySelectorAll('#fm .fm-day')].map(d => d.className.replace(/\\s+/g, ' ').trim()) })"""
STORAGE_JS = """() => { const m = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('sudoku.') && k !== 'sudoku.backup.v2') m[k] = localStorage.getItem(k); } return m; }"""

async def go_home(page):
    await ev(page, "() => { __debug.prog.hideToast(); __debug.prog.nav('home'); }"); await page.wait_for_timeout(450)

async def play_device_a(page):
    """Device A: campaign + settings + daily + a Quick Play in progress. Returns the copied code."""
    # earlier progress: Worlds 0-1 mastered (so Cherry / Ink are unlocked), then real levels on top
    await ev(page, """() => { const P = __debug.prog, ids = w => P.levelIds(w), lv = {};
      for (const w of [0, 1]) ids(w).forEach((id, k) => { lv[id] = k === 0 ? 0 : 2; });
      P.setProfile({ v: 1, levels: lv, mastered: [0, 1], expertise: { tier: 1, inner: 4, points: 20 }, unlocks: { fillNotes: true }, flags: { skip: { 0: true } } }); }""")
    # campaign: World 2 Use it 1 (clean) and Use it 2 (one clash) through the board
    for k, slip in [(7, False), (8, True)]:
        await ev(page, f'() => {{ __debug.prog.hideScreens(); __debug.camp.start(2, {k}); }}'); await page.wait_for_timeout(350)
        for _ in range(2 if slip else 0):
            bad = await ev(page, """() => { const S = __debug.S; for (let i = 0; i < 81; i++) if (!S.values[i]) for (const j of [0,1,2,3,4,5,6,7,8].map(c => Math.floor(i / 9) * 9 + c)) if (S.values[j]) return [i, S.values[j]]; }""")
            await cell(page, bad[0]); await tap(page, f'.key.digit[data-d="{bad[1]}"]'); await page.wait_for_timeout(900)
            await ev(page, f'() => {{ const S = __debug.S; S.values[{bad[0]}] = 0; __debug.refresh(); }}')
        await solve_free(page); await page.wait_for_timeout(1800)
    lv = await ev(page, "() => { const P = __debug.prog, ids = P.levelIds(2); return [P.getProfile().levels[ids[7]], P.getProfile().levels[ids[8]]]; }")
    check(lv[0] == 3 and lv[1] == 2, f't1 A: campaign levels played (World 2 Use it 1 = 3, Use it 2 = 2 charges): {lv}')
    # Settings through the sheet: Cherry keycaps, Ink colorway, volume
    await go_home(page)
    await tap(page, '#home .key.set'); await page.wait_for_timeout(400)
    await click(page, '#setSheet .set-tile[data-style="cherry"]'); await page.wait_for_timeout(250)
    await click(page, '#setSheet .set-swatch[data-preset="ink"]'); await page.wait_for_timeout(250)
    await ev(page, "() => { const v = document.getElementById('setVol'); v.value = 37; v.dispatchEvent(new Event('input')); }")
    await ev(page, "() => document.querySelector('#setSheet .set-x').click()"); await page.wait_for_timeout(300)
    # Daily: Free Mode -> Play -> solve
    await tap(page, '#home .hbig.free'); await page.wait_for_timeout(400)
    await tap(page, '.fm-play'); await page.wait_for_timeout(300)
    await solve_free(page); await page.wait_for_timeout(1500)
    st = await ev(page, '() => __fm.state().daily')
    check(st['streak'] == 1, f't1 A: daily solved, streak 1: {st}')
    # Free Mode feedback + a Quick Play left in progress (digits, notes, a mistake)
    await ev(page, "() => { __debug.prog.hideToast(); __debug.prog.nav('free'); }"); await page.wait_for_timeout(400)
    await ev(page, "() => { const s = __fm.state(); s.feedback = 'instant'; __fm.setState(s); }")
    await tap(page, '.fm-band[data-band="gentle"]'); await page.wait_for_timeout(400)
    cells = await ev(page, "() => { const S = __debug.S, out = []; for (let i = 0; i < 81 && out.length < 3; i++) if (!S.values[i]) out.push([i, S.sol[i]]); return out; }")
    for i, d in cells[:2]:
        await cell(page, i); await tap(page, f'.key.digit[data-d="{d}"]'); await page.wait_for_timeout(250)
    i, d = cells[2]
    await cell(page, i); await tap(page, f'.key.digit[data-d="{d % 9 + 1}"]'); await page.wait_for_timeout(900)   # a wrong digit (instant: a mistake)
    await ev(page, f'() => {{ const S = __debug.S; S.values[{i}] = 0; S.notes[{i}] = (1 << ({d} - 1)) | 1 | 256; S.notes[{i} + 0] |= 0; __debug.refresh(); }}')
    await page.wait_for_timeout(1200)
    board = await ev(page, BOARD_JS)
    check(board['mistakes'] >= 1, f't1 A: the board has a mistake: {board["mistakes"]}')
    # header key -> sheet -> Copy
    await tap(page, '#tokenBtn'); await page.wait_for_timeout(450)
    out = await ev(page, "() => document.getElementById('tokOut').value")
    meta = await ev(page, "() => document.getElementById('tokMeta').textContent")
    await click(page, '#copyKey'); await page.wait_for_timeout(200)
    clip = await ev(page, '() => navigator.clipboard.readText()')
    check(clip == out and clip.startswith('SDK2.'), f't1 A: Copy puts the code on the clipboard: {clip[:16]!r} vs {out[:16]!r}')
    check('Quick Play' in meta and 'Gentle' in meta, f't1 A: the code says it carries the puzzle in progress: {meta!r}')
    check((await msg(page))['text'].startswith('Copied'), 't1 A: "Copied" message')
    a_elapsed = await ev(page, '() => __fm.session().elapsed')
    await tap(page, '#closeKey'); await page.wait_for_timeout(350)
    return clip, board, a_elapsed

B_PROFILE = {'v': 1, 'levels': {'w0-l0': 0}, 'mastered': [], 'expertise': {'tier': 1, 'inner': 2, 'points': 7}, 'flags': {'skip': {'0': True}}}
B_SETTINGS = {'v': 1, 'style': 'sa', 'layout': 'plain', 'preset': 'retro', 'sound': False, 'switchVol': 0.5}

async def t1_transfer(browser):
    ctx, a, errs_a = await new_page(browser)
    code, a_board, a_elapsed = await play_device_a(a)
    await a.wait_for_timeout(100)
    a_state = await ev(a, STATE_JS)
    await go_home(a)
    a_home = await ev(a, HOME_JS); a_map = await ev(a, MAP_JS)
    await tap(a, '#home .key.set'); await a.wait_for_timeout(350); a_set = await ev(a, SET_UI_JS)
    await ev(a, "() => document.querySelector('#setSheet .set-x').click()"); await a.wait_for_timeout(300)
    await tap(a, '#home .hbig.free'); await a.wait_for_timeout(400); a_fm = await ev(a, FM_UI_JS)
    check(not errs_a, f't1 A errors: {errs_a}')

    # device B: its own progress and its own puzzle in progress
    ctxb, b, errs_b = await new_page(browser, storage={'sudoku.profile.v1': json.dumps(B_PROFILE), 'sudoku.settings.v1': json.dumps(B_SETTINGS)})
    await ev(b, "() => { __debug.prog.hideScreens(); __debug.startPuzzle(__debug.allIds().find(i => i.startsWith('q-easy')), false); }")
    await b.wait_for_timeout(300)
    bcell = await ev(b, "() => { const S = __debug.S; for (let i = 0; i < 81; i++) if (!S.values[i]) return [i, S.sol[i]]; }")
    await tap(b, f'.cell[data-i="{bcell[0]}"]'); await tap(b, f'.key.digit[data-d="{bcell[1]}"]'); await b.wait_for_timeout(500)
    await go_home(b)
    b_before = await ev(b, STATE_JS); b_store = await ev(b, STORAGE_JS); b_home0 = await ev(b, HOME_JS)
    b_board0 = await ev(b, BOARD_JS)

    # Home link -> paste -> Load
    await tap(b, '#home .home-bk'); await b.wait_for_timeout(450)
    check(await sheet_open(b), 't1 B: the Home link opens the Backup code sheet')
    title = await ev(b, "() => document.querySelector('#sheet h2').textContent.trim() + ' | ' + document.querySelector('#sheet .sub').textContent")
    check(title == 'Backup code | Moves all your progress, settings and your current puzzle to another device. Not a password.', f't1 sheet copy: {title!r}')
    check(not await ev(b, "() => document.getElementById('undoRow').classList.contains('show')"), 't1 B: no Undo load before a load')
    await sfx_log(b)
    await b.fill('#tokIn', '\n  ' + code[:40] + '\n' + code[40:90] + ' ' + code[90:] + '\n')      # line breaks / spaces from a paste
    await tap(b, '#loadKey'); await b.wait_for_timeout(900)
    m = await msg(b); fx = await sfx_log(b)
    check('ok' in m['cls'] and m['text'].startswith('Loaded'), f't1 B: load message: {m}')
    check('latch' in fx and 'error' not in fx, f't1 B: latch sound on load: {fx}')
    check(await ev(b, "() => document.getElementById('undoRow').classList.contains('show')"), 't1 B: Undo load shown after the load')
    check(await ev(b, "() => document.getElementById('tokOut').value") == code, 't1 B: the sheet now shows the same code as A')
    await tap(b, '#closeKey'); await b.wait_for_timeout(400)

    b_state = await ev(b, STATE_JS)
    for k in ['levels', 'mastered', 'expertise', 'fillNotes', 'items', 'skip', 'lastFree', 'settings']:
        check(a_state[k] == b_state[k], f't1 B {k} differs from A: A={a_state[k]} B={b_state[k]}')
    for k in ['solved', 'played', 'best', 'current', 'feedback', 'challenge', 'daily']:
        check(a_state['free'][k] == b_state['free'][k], f't1 B free.{k} differs: A={a_state["free"][k]} B={b_state["free"][k]}')
    b_home = await ev(b, HOME_JS)
    check(await screen(b) == 'home', 't1 B: still on Home after the load')
    for k in ['tier', 'inner', 'label', 'totals', 'cont']:
        check(a_home[k] == b_home[k], f't1 B Home {k}: A={a_home[k]} B={b_home[k]}')
    check(b_home['contLabel'] == 'Quick Play · Gentle', f't1 B Continue label: {b_home["contLabel"]!r}')
    check(await ev(b, MAP_JS) == a_map, f't1 B map worlds differ: {await ev(b, MAP_JS)} vs {a_map}')
    await tap(b, '#home .key.set'); await b.wait_for_timeout(350)
    b_set = await ev(b, SET_UI_JS)
    check(b_set == a_set, f't1 B Settings sheet differs: A={a_set} B={b_set}')
    check(await ev(b, "() => document.documentElement.classList.contains('ks-cherry') && document.documentElement.classList.contains('cw-ink')"), 't1 B: Cherry + Ink applied')
    await ev(b, "() => document.querySelector('#setSheet .set-x').click()"); await b.wait_for_timeout(300)
    await tap(b, '#home .hbig.free'); await b.wait_for_timeout(400)
    b_fm = await ev(b, FM_UI_JS)
    check(b_fm == a_fm, f't1 B Free Mode screen differs: A={a_fm} B={b_fm}')
    await ev(b, "() => __debug.prog.nav('home')"); await b.wait_for_timeout(400)
    # Continue resumes the same board
    await tap(b, '#home .key.cont'); await b.wait_for_timeout(500)
    b_board = await ev(b, BOARD_JS)
    for k in ['id', 'values', 'notes', 'mistakes', 'silentWrong', 'paidHints', 'solved']:
        check(a_board[k] == b_board[k], f't1 B Continue board {k}: A={a_board[k]} B={b_board[k]}')
    sess = await ev(b, '() => __fm.session()')
    check(sess and abs(sess['elapsed'] - a_elapsed) < 1600, f't1 B: the Free Mode clock resumes near A\'s ({a_elapsed} ms): {sess}')
    check(await ev(b, '() => __debug.S.mistakes') == a_board['mistakes'] and await ev(b, "() => document.getElementById('mist').textContent") == str(a_board['mistakes']), 't1 B: mistakes counter shows A\'s count')

    # Undo load (the sheet from the header this time)
    await tap(b, '#tokenBtn'); await b.wait_for_timeout(450)
    check(await ev(b, "() => document.getElementById('undoRow').classList.contains('show')"), 't1 B: Undo load still offered in this session')
    await tap(b, '#undoKey'); await b.wait_for_timeout(500)
    m = await msg(b)
    check('undone' in m['text'], f't1 B: undo message: {m}')
    await tap(b, '#closeKey'); await b.wait_for_timeout(350)
    b_after = await ev(b, STATE_JS); b_store2 = await ev(b, STORAGE_JS)
    check(b_after == b_before, f't1 B: Undo load restores profile / settings / Free Mode: before={b_before} after={b_after}')
    diff = sorted(set(k for k in set(b_store) | set(b_store2) if b_store.get(k) != b_store2.get(k)))
    # the board saves are re-encoded with a fresh random SDK1 salt when the game writes them again: compare their content
    diff = [k for k in diff if not (k.startswith('sudoku.save.v1.') and k in b_store and k in b_store2 and
            await ev(b, '([x, y]) => JSON.stringify(Array.from(__debug.Token.decode(x))) === JSON.stringify(Array.from(__debug.Token.decode(y)))', [b_store[k], b_store2[k]]))]
    check(not diff, f't1 B: Undo load restores every sudoku.* key: differs {diff}')
    b_board2 = await ev(b, BOARD_JS)
    check(b_board2['id'] == b_board0['id'] and b_board2['values'] == b_board0['values'], f't1 B: after Undo the board is B\'s own puzzle again: {b_board2["id"]} vs {b_board0["id"]}')
    await go_home(b)
    check(await ev(b, HOME_JS) == b_home0, f't1 B: Home after Undo equals before the load')
    check(not errs_b, f't1 B errors: {errs_b}')
    notes.append(f'T1 code {len(code)} chars; A board {a_board["id"]} with {sum(1 for c in a_board["values"] if c != "0")} digits, {a_board["mistakes"]} mistakes')
    await ctx.close(); await ctxb.close()

async def t2_errors(browser):
    ctx, page, errs = await new_page(browser)
    code = await ev(page, '() => __debug.backup.currentCode()')
    before = await ev(page, STORAGE_JS)
    cases = [
        ('damaged', code[:20] + ('B' if code[20] == 'A' else 'A') + code[21:], 'This code is damaged or was edited.'),
        ('truncated', code[:-4], 'This code is damaged or was edited.'),
        ('newer', 'SDK3.' + code[5:], 'This code is from a newer version — update the game first.'),
        ('empty', '   ', 'Paste a backup code first.'),
        ('not a code', 'hello there', "That isn't a backup code."),
    ]
    # an SDK1 code for the prototype puzzle (tag 0): not shipped
    proto = await ev(page, """() => { const g = '530070000600195000098000060800060003400803001700020006060000280000419005000080079', b = new Uint8Array(208);
      b[0] = 1; b[1] = 0; for (let i = 0; i < 81; i++) b[5 + (i >> 1)] |= (+g[i]) << ((i & 1) ? 0 : 4); return __debug.Token.encode(b); }""")
    cases.append(('unknown puzzle', proto, "This code is for a puzzle this version doesn't have."))
    # a v2 code whose version byte is newer (built with the game's own codec pieces)
    await tap(page, '#home .home-bk'); await page.wait_for_timeout(400)
    for name, text, want in cases:
        await page.fill('#tokIn', text); await sfx_log(page)
        await tap(page, '#loadKey'); await page.wait_for_timeout(350)
        m = await msg(page); fx = await sfx_log(page)
        check(m['text'] == want and 'bad' in m['cls'], f't2 {name}: message {m!r}, want {want!r}')
        check('error' in fx and 'blocked' not in fx and 'latch' not in fx, f't2 {name}: the gentle error sound: {fx}')
        check(not await ev(page, "() => document.getElementById('undoRow').classList.contains('show')"), f't2 {name}: no Undo after a failed load')
    check(await ev(page, STORAGE_JS) == before, 't2 failed loads change nothing')
    check(not errs, f't2 errors: {errs}')
    await ctx.close()

async def t3_sdk1(browser):
    ctx, page, errs = await new_page(browser, storage={'sudoku.profile.v1': json.dumps(B_PROFILE)})
    prof0 = await ev(page, '() => JSON.stringify(__debug.prog.getProfile())'); set0 = await ev(page, '() => JSON.stringify(__keys.getSettings())')
    # an SDK1 code (the old single-board format) of a medium Quick Play with two digits and a note
    sdk1 = await ev(page, """() => { const id = 'q-medium-012', b = __debug.boardFor(id), v = Array.from(b.values); let n = 0;
      for (let i = 0; i < 81 && n < 2; i++) if (!v[i]) { v[i] = b.sol[i]; n++; }
      const p = new Uint8Array(208); p[0] = 1; p[1] = __debug.backup.tag(id); p[3] = 2;
      for (let i = 0; i < 81; i++) p[5 + (i >> 1)] |= v[i] << ((i & 1) ? 0 : 4);
      const e = v.indexOf(0); p[46 + e * 2] = 0x01; p[47 + e * 2] = 0x23;
      return { code: __debug.Token.encode(p), values: v.join(''), e, id }; }""")
    await ev(page, '() => __debug.prog.hideScreens()'); await page.wait_for_timeout(300)
    await tap(page, '#tokenBtn'); await page.wait_for_timeout(400)
    await page.fill('#tokIn', sdk1['code']); await tap(page, '#loadKey'); await page.wait_for_timeout(600)
    m = await msg(page)
    check('ok' in m['cls'] and 'older code' in m['text'], f't3 SDK1 load message: {m}')
    bd = await ev(page, BOARD_JS)
    check(bd['id'] == sdk1['id'] and bd['values'] == sdk1['values'] and bd['mistakes'] == 2 and bd['notes'].split(',')[sdk1['e']] == str(0x123),
          f't3 the SDK1 board is on screen: {bd["id"]} mistakes {bd["mistakes"]}')
    check(await ev(page, '() => JSON.stringify(__debug.prog.getProfile())') == prof0 and await ev(page, '() => JSON.stringify(__keys.getSettings())') == set0,
          't3 SDK1 load leaves the profile and settings alone')
    check(await ev(page, "() => JSON.parse(localStorage.getItem('sudoku.lastctx')).id") == sdk1['id'], 't3 Continue points at the loaded board')
    check(not errs, f't3 errors: {errs}')
    await ctx.close()

async def t4_entry(browser):
    ctx, page, errs = await new_page(browser)
    # Settings -> Backup & restore
    await tap(page, '#home .key.set'); await page.wait_for_timeout(400)
    await ev(page, "() => { const s = document.getElementById('setSheet'); s.scrollTop = s.scrollHeight; }"); await page.wait_for_timeout(100)
    row = await ev(page, "() => { const b = document.querySelector('#setSheet .set-bk'); return b ? b.textContent : null; }")
    check(row and 'Backup & restore' in row, f't4 Settings has a "Backup & restore" row: {row!r}')
    await click(page, '#setSheet .set-bk'); await page.wait_for_timeout(450)
    check(await sheet_open(page) and not await ev(page, "() => document.getElementById('setSheet').classList.contains('show')"), 't4 the row opens the Backup code sheet (Settings closes)')
    await tap(page, '#closeKey'); await page.wait_for_timeout(350)
    check(not await sheet_open(page) and not await ev(page, '() => __debug.UI.sheetOpen'), 't4 Close closes the sheet')
    # header key icon (in a game)
    await ev(page, "() => { __debug.prog.hideScreens(); __debug.startPuzzle('q-gentle-004', false); }"); await page.wait_for_timeout(300)
    await tap(page, '#tokenBtn'); await page.wait_for_timeout(400)
    check(await sheet_open(page), 't4 the header key icon opens the sheet')
    sel = await ev(page, "() => { const t = document.getElementById('tokOut'); return { ro: t.readOnly, font: getComputedStyle(t).fontFamily, us: getComputedStyle(t).userSelect }; }")
    check(sel['ro'] and 'mono' in sel['font'].lower() and sel['us'] != 'none', f't4 the code is monospace, read-only and selectable: {sel}')
    await tap(page, '#closeKey'); await page.wait_for_timeout(300)
    # unified autosave: a digit, a setting, a Free Mode change -> sudoku.backup.v2 follows within ~250 ms
    c = await ev(page, "() => { const S = __debug.S; for (let i = 0; i < 81; i++) if (!S.values[i]) return [i, S.sol[i]]; }")
    await tap(page, f'.cell[data-i="{c[0]}"]'); await tap(page, f'.key.digit[data-d="{c[1]}"]'); await page.wait_for_timeout(400)
    # (the board's elapsed time is the one Date.now-based field: the Free Mode clock is running, so compare without it)
    snap = await ev(page, "() => { const D = __debug.backup, s = localStorage.getItem(D.SNAPSHOT_KEY), a = D.F.decode(s).snap, b = D.F.decode(D.currentCode()).snap; a.board.elapsed = b.board.elapsed = 0; return { same: JSON.stringify(a) === JSON.stringify(b), board: !!a.board, last: a.last }; }")
    check(snap['same'] and snap['board'] and snap['last'] == 'q-gentle-004', f't4 the unified snapshot follows a digit: {snap}')
    await ev(page, "() => __keys.setSettings({ switchVol: 0.21 })"); await page.wait_for_timeout(350)
    check(await ev(page, "() => __debug.backup.F.decode(localStorage.getItem(__debug.backup.SNAPSHOT_KEY)).snap.settings.switchVol") == 0.21, 't4 the snapshot follows a setting')
    await ev(page, "() => { const s = __fm.state(); s.challenge = true; __fm.setState(s); }"); await page.wait_for_timeout(350)
    check(await ev(page, "() => __debug.backup.F.decode(localStorage.getItem(__debug.backup.SNAPSHOT_KEY)).snap.free.challenge") is True, 't4 the snapshot follows Free Mode')
    await ev(page, "() => { localStorage.removeItem(__debug.backup.SNAPSHOT_KEY); window.dispatchEvent(new Event('pagehide')); }")
    check(await ev(page, "() => localStorage.getItem(__debug.backup.SNAPSHOT_KEY) === __debug.backup.currentCode()"), 't4 the snapshot is written on pagehide')
    # the code depends on nothing but the stored data: two codes a second apart are identical (no clock running on Home)
    await go_home(page)
    c1 = await ev(page, '() => __debug.backup.currentCode()'); await page.wait_for_timeout(1100); c2 = await ev(page, '() => __debug.backup.currentCode()')
    check(c1 == c2, 't4 the code is deterministic')
    # per-module keys keep their formats
    k = await ev(page, "() => ({ p: JSON.parse(localStorage.getItem('sudoku.profile.v1')).v, s: JSON.parse(localStorage.getItem('sudoku.settings.v1')).v, f: JSON.parse(localStorage.getItem('sudoku.free.v1')).v, save: (localStorage.getItem('sudoku.save.v1.q-gentle-004') || '').slice(0, 5) })")
    check(k == {'p': 1, 's': 1, 'f': 1, 'save': 'SDK1.'}, f't4 per-module keys unchanged: {k}')
    check(not errs, f't4 errors: {errs}')
    await ctx.close()

LAYOUT_JS = """() => { const s = document.getElementById('sheet'), r = s.getBoundingClientRect(), bad = [];
  if (r.top < 0) bad.push('sheet taller than the viewport: top ' + r.top.toFixed(1));
  if (s.scrollHeight > s.clientHeight + 1) bad.push('sheet scrolls: ' + s.scrollHeight + ' > ' + s.clientHeight);
  if (document.documentElement.scrollWidth > innerWidth + 1 || s.scrollWidth > s.clientWidth + 1) bad.push('horizontal overflow');
  for (const id of ['tokOut', 'copyKey', 'tokIn', 'loadKey', 'closeKey', 'tokMsg', 'undoKey']) { const e = document.getElementById(id), q = e.getBoundingClientRect();
    if (e.offsetParent === null) continue;
    if (q.bottom > innerHeight + 0.5 || q.top < 0 || q.left < 0 || q.right > innerWidth + 0.5) bad.push(id + ' out of view'); }
  return { bad, h: Math.round(r.height), vh: innerHeight }; }"""

async def t5_layout(browser):
    for vp in [(375, 667), (390, 844)]:
        for scheme in ['light', 'dark']:
            tag = f'{vp[0]}x{vp[1]}-{scheme}'
            ctx, page, errs = await new_page(browser, vp=vp, scheme=scheme, storage={'sudoku.profile.v1': json.dumps(B_PROFILE)})
            await page.wait_for_timeout(300)
            await page.screenshot(path=str(OUT / f'{tag}-home.png'))
            hb = await ev(page, "() => { const a = document.querySelector('#home .home-bk').getBoundingClientRect(), d = document.querySelector('#home .home-dev').getBoundingClientRect(); return { right: a.right, vw: innerWidth, apart: a.left > d.right }; }")
            check(hb['right'] <= hb['vw'] and hb['apart'], f't5 {tag}: Home link fits: {hb}')
            # a code with a board in progress (the longest typical code)
            await ev(page, "() => { __debug.prog.hideScreens(); __debug.startPuzzle('q-gentle-010', false); const S = __debug.S; let n = 0; for (let i = 0; i < 81; i++) if (!S.values[i]) { if (n++ < 12) S.values[i] = S.sol[i]; else S.notes[i] = 0x1FF ^ (1 << (i % 9)); } __debug.refresh(); }")
            await page.wait_for_timeout(300)
            code = await ev(page, '() => __debug.backup.currentCode()')
            await tap(page, '#tokenBtn'); await page.wait_for_timeout(500)
            lay = await ev(page, LAYOUT_JS)
            check(not lay['bad'], f't5 {tag} sheet: {lay}')
            await page.screenshot(path=str(OUT / f'{tag}-sheet.png'))
            await page.fill('#tokIn', code); await tap(page, '#loadKey'); await page.wait_for_timeout(200)
            await page.screenshot(path=str(OUT / f'{tag}-load-fx.png'))
            await page.wait_for_timeout(700)
            lay = await ev(page, LAYOUT_JS)
            check(not lay['bad'] and await ev(page, "() => document.getElementById('undoKey').offsetParent !== null"), f't5 {tag} sheet after a load (Undo row): {lay}')
            await page.screenshot(path=str(OUT / f'{tag}-loaded.png'))
            await page.fill('#tokIn', code[:-6]); await tap(page, '#loadKey'); await page.wait_for_timeout(400)
            await page.screenshot(path=str(OUT / f'{tag}-error.png'))
            await tap(page, '#closeKey'); await page.wait_for_timeout(300)
            await ev(page, "() => __debug.prog.nav('settings')"); await page.wait_for_timeout(400)
            await ev(page, "() => { const s = document.getElementById('setSheet'); s.scrollTop = s.scrollHeight; }"); await page.wait_for_timeout(150)
            await page.screenshot(path=str(OUT / f'{tag}-settings-row.png'))
            ov = await ev(page, "() => { const s = document.getElementById('setSheet'); return s.scrollWidth > s.clientWidth + 1; }")
            check(not ov, f't5 {tag}: Settings sheet overflows horizontally')
            check(not errs, f't5 {tag} errors: {errs}')
            await ctx.close()
    notes.append(f'T5 screenshots in {OUT}')

async def main():
    assert (DIST / 'index.html').exists(), 'run node tools/build.mjs first'
    srv = subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            only = [a for a in sys.argv[1:] if a.startswith('t')]
            for name, fn in [('t1', t1_transfer), ('t2', t2_errors), ('t3', t3_sdk1), ('t4', t4_entry), ('t5', t5_layout)]:
                if only and name not in only: continue
                t0 = time.time()
                try:
                    await fn(browser)
                except Exception as e:
                    failures.append(f'{name} crashed: {type(e).__name__}: {e}')
                notes.append(f'{name.upper()} took {time.time() - t0:.1f}s')
            await browser.close()
    finally:
        srv.terminate()
    print('TOKEN (browser)')
    for n in notes: print('  ' + n)
    if failures:
        print(f'\nFAIL ({len(failures)})')
        for f in failures: print('  - ' + f)
        sys.exit(1)
    print('\nPASS')

if __name__ == '__main__':
    asyncio.run(main())
