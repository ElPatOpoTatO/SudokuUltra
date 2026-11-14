#!/usr/bin/env python3
"""freemode-test.py — Free Mode: Quick Play + Daily Puzzle (Playwright).

    node tools/build.mjs && python3 tools/freemode-test.py [daily streak quick feedback persist nav layout]

  daily     the daily index for several dates (incl. 2027 and the wrap at 400,
            plus a date before the epoch) matches shared.js dailyIndex and the
            Python-side day count; with a faked clock the screen shows that
            date's weekday · band and Play opens that date's puzzle.
  streak    faked clock: solve Mon → 1, Tue → 2, replay Tue → still 2, skip
            Wed, Thu shows 0 and a solve resets to 1; Wed solved from the week
            strip on Thu is marked late and does not count; the strip marks
            solved days; "Solved ✓" with the time.
  quick     bands locked with no mastery; tapping a locked card starts nothing;
            Challenge me opens them with the warning; a picked puzzle's
            hardest technique matches its band; no repeats until the band is
            exhausted (150 picks), then a reshuffle; hints limited to learned
            techniques (with and without mastery: an old sudoku.camp.v1 store
            migrated into the profile, then setProfile); solved
            count and best time on the card; Next puzzle from the toast.
  feedback  instant truth flags a wrong non-clashing digit at once; conflicts
            only keeps it silent; nothing shows no red even for a clash; the
            setting never touches campaign puzzles.
  persist   Free Mode state survives a reload (and step 7's solved event
            carries the contract's fields).
  nav       sudoku:nav {to:'free'} opens the screen, the Home key dispatches
            {to:'home'} and Home shows; Home's Free Mode key; no TEMP DEV chip;
            Escape; the header back control (#homeBtn) during Quick Play.
  layout    390x844 and 375x667, light / dark / reduced motion, SA and Cherry
            keycaps: no horizontal overflow, nothing outside the screen, no
            text overflowing its keycap, sections do not overlap; screenshots
            in /tmp/freemode/ (screen + the daily toast with its lit flame).
Exit code 1 on any failure.
"""
import asyncio, datetime as dt, json, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/freemode'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = int(os.environ.get('FM_PORT', 8774))   # merge: env override (parallel checkouts)
EPOCH = dt.date(2026, 1, 5)
failures, notes = [], []

def check(cond, msg):
    if not cond: failures.append(msg)
    return cond

def start_server():
    return subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

async def new_page(browser, hash_='', vp=(390, 844), scheme='light', motion='no-preference', storage=None, clock=None):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, device_scale_factor=2 if hash_ == '#shot' else 1,
                                    color_scheme=scheme, reduced_motion=motion)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    if clock: await page.clock.install(time=clock)
    if storage:
        await page.add_init_script(f"try {{ if (!sessionStorage.getItem('__seeded')) {{ for (const [k, v] of Object.entries({json.dumps(storage)})) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); }} }} catch (e) {{}}")
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{"" if hash_ == "#shot" else hash_}')
    await page.wait_for_function('() => window.__debug && window.__fm')
    return ctx, page, errs

async def tap(page, sel):
    b = await page.locator(sel).first.bounding_box()
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down(); await page.mouse.up()

async def fm(page, js): return await page.evaluate(f'() => {js}')

async def open_screen(page):
    await page.evaluate("() => document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to: 'free' } }))")
    await page.wait_for_timeout(60)

async def solve(page, wait_toast=True):
    """Fill every empty cell but the last with the solution, then place the last one through the UI."""
    last = await page.evaluate("""() => { const S = __debug.S; let last = -1;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i]) last = i;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i] && i !== last) { S.values[i] = S.sol[i]; S.notes[i] = 0; }
      __debug.refresh(); if (S.values[last]) { S.values[last] = 0; __debug.refresh(); } return [last, S.sol[last]]; }""")
    if await page.evaluate('() => __debug.S.selected') != last[0]:
        await tap(page, f'.cell[data-i="{last[0]}"]')
    await tap(page, f'.key.digit[data-d="{last[1]}"]')
    if wait_toast: await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=5000)
    return last[0]

def local_noon(d): return dt.datetime(d.year, d.month, d.day, 12, 0, 0)

# ---------------------------------------------------------------------------
async def t_daily(browser):
    dates = [dt.date(2026, 1, 5), dt.date(2026, 1, 11), dt.date(2026, 11, 14), dt.date(2027, 2, 8), dt.date(2027, 2, 9),
             dt.date(2027, 6, 30), dt.date(2028, 2, 29), dt.date(2025, 12, 31)]
    ctx, page, errs = await new_page(browser)
    for d in dates:
        expect_day = (d - EPOCH).days
        r = await page.evaluate("""([y, m, dd]) => { const D = new Date(y, m - 1, dd, 12); const n = __fm.dayNumber(D), i = __fm.dailyIndex(D), info = __fm.dayInfo(n);
          return { n, i, info, viaInfo: info.index, id: __debug.entry(info.id) && __debug.entry(info.id).index }; }""", [d.year, d.month, d.day])
        exp_idx = expect_day % 400
        check(r['n'] == expect_day and r['i'] == exp_idx and r['viaInfo'] == exp_idx and r['id'] == exp_idx,
              f'daily index {d}: got {r}, expected day {expect_day} index {exp_idx}')
        bands = ['gentle', 'easy', 'easy', 'medium', 'medium', 'tricky', 'tricky']
        check(r['info']['band'] == bands[exp_idx % 7], f'daily band {d}: {r["info"]["band"]} vs rhythm {bands[exp_idx % 7]}')
    notes.append(f'daily: {len(dates)} dates checked (incl. 2027-02-08 idx 399, 2027-02-09 wrap to 0, 2025-12-31 before the epoch)')
    await ctx.close()
    # faked clock: the screen and Play follow the device date
    for d in (dt.date(2027, 2, 9), dt.date(2027, 3, 18)):
        ctx, page, errs = await new_page(browser, clock=local_noon(d))
        await open_screen(page)
        idx = (d - EPOCH).days % 400
        title = await page.inner_text('.fm-dtitle')
        wd = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][d.weekday()]
        band = ['Gentle', 'Easy', 'Easy', 'Medium', 'Medium', 'Tricky', 'Tricky'][idx % 7]
        check(title == f'{wd} · {band}', f'daily title on {d}: "{title}" expected "{wd} · {band}"')
        await tap(page, '.fm-play')
        await page.wait_for_timeout(100)
        sid = await fm(page, '__debug.S.id')
        check(sid == f'd-{idx:04d}' and not await fm(page, '__fm.isOpen()'), f'Play on {d} opened {sid}, expected d-{idx:04d}')
        check(not errs, f'daily {d} errors: {errs}')
        await ctx.close()

async def t_streak(browser):
    mon = dt.date(2026, 11, 9)       # a Monday; Tue 10, Wed 11, Thu 12 in the same week
    days = {k: (mon - EPOCH).days + i for i, k in enumerate(['mon', 'tue', 'wed', 'thu'])}
    ctx, page, errs = await new_page(browser, clock=local_noon(mon))
    async def streak_shown():
        await open_screen(page)
        return int(await page.inner_text('.fm-streak b'))
    async def set_day(d):
        await page.clock.set_system_time(local_noon(d))
        await page.wait_for_timeout(30)

    check(await streak_shown() == 0, 'streak: fresh state should show 0')
    await tap(page, '.fm-play'); await page.wait_for_timeout(80)
    check(await fm(page, '__debug.S.id') == f'd-{days["mon"] % 400:04d}', 'streak: Monday Play opened the wrong puzzle')
    await page.clock.run_for(4000)       # 4 s of play on the faked clock
    cell0 = await solve(page)
    ls = await fm(page, '__fm.lastSolve()')
    check(ls['streak'] == 1 and ls['streakUp'] and ls['first'] and ls['ms'] >= 4000, f'streak: Monday solve {ls}')
    check(ls['cell'] == cell0, f'streak: ignite source cell {ls["cell"]} != last placed {cell0}')
    await page.clock.run_for(2600); await page.wait_for_timeout(1000)
    lit = await page.evaluate("() => { const t = document.querySelector('.fm-tstreak'); return { on: t.classList.contains('on'), lit: t.classList.contains('lit'), n: t.querySelector('b').textContent, key: document.querySelector('#againKey .lbl').textContent }; }")
    check(lit == {'on': True, 'lit': True, 'n': '1', 'key': 'Free Mode'}, f'streak: toast flame {lit}')
    await tap(page, '#againKey'); await page.wait_for_timeout(60)
    check(await fm(page, '__fm.isOpen()'), 'streak: the toast keycap should open Free Mode')
    st = await page.evaluate("() => ({ done: document.querySelector('.fm-dfoot').classList.contains('done'), status: document.querySelector('.fm-dstatus').innerText, play: document.querySelector('.fm-play').innerText, mon: document.querySelector('.fm-day[data-day=\"%d\"]').className })" % days['mon'])
    check(st['done'] and 'Solved' in st['status'] and '0:04' in st['status'] and 'replay' in st['play'].lower() and 'latched' in st['mon'],
          f'streak: solved state on the card {st}')

    await set_day(mon + dt.timedelta(days=1))
    check(await streak_shown() == 1, 'streak: Tuesday before solving should still show 1')
    await tap(page, '.fm-play'); await page.wait_for_timeout(80)
    await solve(page)
    check((await fm(page, '__fm.lastSolve()'))['streak'] == 2, 'streak: Monday + Tuesday should be 2')
    # replay Tuesday: no increase
    await open_screen(page); await tap(page, '.fm-play'); await page.wait_for_timeout(80)
    check(await fm(page, '__debug.S.solved') is False, 'streak: Replay should start from the givens')
    await solve(page)
    ls = await fm(page, '__fm.lastSolve()')
    check(not ls['first'] and await fm(page, '__fm.state().daily.streak') == 2, f'streak: replay changed the streak {ls}')
    check(await page.inner_text('#toastTitle') == 'Solved again', 'streak: replay toast title')

    # skip Wednesday
    await set_day(mon + dt.timedelta(days=3))
    check(await streak_shown() == 0, 'streak: after a missed day it should show 0')
    # Wednesday from the strip (a past day): marked, late, no streak change
    await tap(page, f'.fm-day[data-day="{days["wed"]}"]'); await page.wait_for_timeout(80)
    check(await fm(page, '__debug.S.id') == f'd-{days["wed"] % 400:04d}', 'streak: strip Wednesday opened the wrong puzzle')
    await solve(page)
    ls = await fm(page, '__fm.lastSolve()')
    s = await fm(page, '__fm.state().daily')
    check(not ls['streakUp'] and s['streak'] == 2 and s['lastDay'] == days['tue'] and str(days['wed']) in s['late'], f'streak: past-day solve counted {ls} {s}')
    check(await streak_shown() == 0, 'streak: a past-day solve must not revive the streak')
    cls = await page.get_attribute(f'.fm-day[data-day="{days["wed"]}"]', 'class')
    check('late' in cls, f'streak: Wednesday should be marked late in the strip: {cls}')
    await tap(page, '.fm-play'); await page.wait_for_timeout(80)
    await solve(page)
    check((await fm(page, '__fm.lastSolve()'))['streak'] == 1, 'streak: the first solve after a gap should be 1')
    strip = await page.evaluate("() => { document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to: 'free' } })); return [...document.querySelectorAll('.fm-day')].map(k => k.className.replace(/\\b(key|fm-day|r\\d|ev)\\b/g, '').trim()); }")
    check('latched' in strip[0] and 'latched' in strip[1] and 'late' in strip[2] and 'latched' in strip[3] and 'today' in strip[3] and all('future' in x for x in strip[4:]),
          f'streak: week strip marks {strip}')
    await page.screenshot(path=str(OUT / 'streak-thursday.png'))
    notes.append('streak: Mon 1 -> Tue 2 -> replay 2 -> skip Wed -> 0 -> Wed late (no count) -> Thu 1')
    check(not errs, f'streak errors: {errs}')
    await ctx.close()

LEARNED0 = ['full-house', 'hidden-single-box', 'hidden-single-line']

async def t_quick(browser):
    ctx, page, errs = await new_page(browser)
    await open_screen(page)
    locked = await page.evaluate("() => [...document.querySelectorAll('.fm-band')].map(k => [k.dataset.band, k.classList.contains('locked')])")
    check(locked == [['gentle', False], ['easy', True], ['medium', True], ['tricky', True]], f'quick: locked without mastery {locked}')
    check('Master World 3' in await page.inner_text('.fm-band[data-band="medium"]'), 'quick: medium should say Master World 3')
    check('needs Pairs' in await page.inner_text('.fm-band[data-band="tricky"]'), 'quick: tricky card should show "needs Pairs"')
    before = await fm(page, '__debug.S.id')
    await tap(page, '.fm-band[data-band="tricky"]'); await page.wait_for_timeout(60)
    check(await fm(page, '__fm.isOpen()') and await fm(page, '__debug.S.id') == before, 'quick: a locked band must not start a puzzle')
    check(not await page.is_visible('.fm-warn'), 'quick: warning visible before Challenge me')
    await tap(page, '.fm-ch .set-toggle'); await page.wait_for_timeout(60)
    locked = await page.evaluate("() => [...document.querySelectorAll('.fm-band')].map(k => k.classList.contains('locked'))")
    warn = await page.is_visible('.fm-warn')
    check(not any(locked) and warn and "learned" in await page.inner_text('.fm-warn'), f'quick: Challenge me should open every band with the warning ({locked}, warn={warn})')
    await page.screenshot(path=str(OUT / 'quick-challenge.png'))
    info = await fm(page, '__fm.BAND_INFO')
    for b in ['tricky', 'medium', 'easy', 'gentle']:
        await open_screen(page)
        await tap(page, f'.fm-band[data-band="{b}"]'); await page.wait_for_timeout(80)
        r = await page.evaluate("() => { const e = __debug.entry(__debug.S.id); return { id: __debug.S.id, kind: e.kind, band: e.band, hardest: e.item.hardest, open: __fm.isOpen(), unlocked: __debug.hintState().unlocked }; }")
        check(r['kind'] == 'quick' and r['band'] == b and r['hardest'] in info[b]['techs'] and not r['open'], f'quick {b}: picked {r}')
        check(r['unlocked'] == LEARNED0, f'quick {b}: hints should use learned techniques only, got {r["unlocked"]}')
        # a hint never names a technique beyond the learned ones
        await page.evaluate('() => __debug.hintTap()')
        h = await fm(page, '__debug.hintState()')
        check(h['kind'] in ('none', 'wrong', 'missing') or (h['step'] and h['step']['tech'] in LEARNED0), f'quick {b}: hint used {h["kind"]} {h["step"]}')
        if b == 'tricky': notes.append(f'quick: tricky hint with nothing mastered -> kind={h["kind"]} "{h["coach"]}"')
    # solve the gentle one: count + best time + Next puzzle
    gid = await fm(page, '__debug.S.id')
    await page.wait_for_timeout(1100)
    await solve(page)
    await page.wait_for_timeout(200)
    t = await page.evaluate("() => ({ title: document.getElementById('toastTitle').textContent, msg: document.getElementById('toastMsg').textContent, key: document.querySelector('#againKey .lbl').textContent })")
    check(t['key'] == 'Next puzzle' and t['msg'].startswith('Gentle · 0:01'), f'quick: solved toast {t}')
    st = await fm(page, '__fm.state()')
    check(st['solved']['gentle'] == [gid] and st['best']['gentle'] >= 1000 and 'gentle' not in st['current'], f'quick: state after solve {st["solved"]} {st["best"]} {st["current"]}')
    await tap(page, '#againKey'); await page.wait_for_timeout(80)
    nid = await fm(page, '__debug.S.id')
    check(nid != gid and nid.startswith('q-gentle-') and not await fm(page, '__debug.S.solved'), f'quick: Next puzzle gave {nid}')
    await open_screen(page)
    card = await page.inner_text('.fm-band[data-band="gentle"]')
    check('Resume' in card, f'quick: in-progress card should offer Resume: {card!r}')
    await tap(page, '.fm-band[data-band="gentle"]'); await page.wait_for_timeout(80)
    check(await fm(page, '__debug.S.id') == nid, 'quick: Resume should reopen the puzzle in progress')
    await solve(page)
    await open_screen(page)
    card = await page.inner_text('.fm-band[data-band="gentle"]')
    check('2 solved' in card and 'best' in card, f'quick: card stats {card!r}')

    # no repeats until exhausted (150 picks on a scratch state), then reshuffle
    r = await page.evaluate("""() => { const s = { played: {} }; const seen = new Set(); let dup = 0, wrong = 0;
      const list = __debug.allIds().filter(id => id.startsWith('q-medium-'));
      for (let k = 0; k < list.length; k++) { const id = __fm.pickPuzzle(s, 'medium'); if (seen.has(id)) dup++; seen.add(id);
        if (!__fm.BAND_INFO.medium.techs.includes(__debug.entry(id).item.hardest)) wrong++; }
      const last = s.played.medium[s.played.medium.length - 1];
      const next = __fm.pickPuzzle(s, 'medium');
      return { n: list.length, uniq: seen.size, dup, wrong, reshuffled: s.played.medium.length === 1, notLast: next !== last }; }""")
    check(r['uniq'] == r['n'] == 150 and r['dup'] == 0 and r['wrong'] == 0 and r['reshuffled'] and r['notLast'], f'quick: no-repeat picking {r}')
    # through the UI: two puzzles left in the band -> exactly those two, then a reshuffle
    left = await page.evaluate("""() => { const ids = __debug.allIds().filter(id => id.startsWith('q-easy-')); const s = __fm.state();
      s.played.easy = ids.slice(0, ids.length - 2); delete s.current.easy; __fm.setState(s); return ids.slice(-2); }""")
    got = []
    for _ in range(3):
        await open_screen(page)
        await tap(page, '.fm-band[data-band="easy"]'); await page.wait_for_timeout(80)
        got.append(await fm(page, '__debug.S.id'))
        await solve(page)
    pl = await fm(page, '__fm.state().played.easy')
    check(sorted(got[:2]) == sorted(left) and got[2] != got[1] and pl == [got[2]], f'quick: exhaust + reshuffle got {got}, left {left}, played after {pl}')
    notes.append(f'quick: 150 medium picks unique; UI exhaust {got[:2]} then reshuffle -> {got[2]}')
    check(not errs, f'quick errors: {errs}')
    await ctx.close()

    # mastery via the old campaign store, migrated into the profile (step 7): World 2 mastered -> Easy offered, hints add naked single
    ctx, page, errs = await new_page(browser, storage={'sudoku.camp.v1': json.dumps({'done': {'w2-master-01': True}})})
    await open_screen(page)
    locked = await page.evaluate("() => [...document.querySelectorAll('.fm-band')].map(k => k.classList.contains('locked'))")
    check(locked == [False, False, True, True], f'quick: World 2 mastered -> {locked}')
    await tap(page, '.fm-band[data-band="easy"]'); await page.wait_for_timeout(80)
    un = (await fm(page, '__debug.hintState()'))['unlocked']
    check(un == LEARNED0 + ['naked-single'], f'quick: learned with World 2 mastered {un}')
    # merge: mastery is read from the progression profile (profile.js getProfile().mastered)
    await page.evaluate("() => { const p = __debug.prog.getProfile(); p.mastered = [2, 3, 4]; __debug.prog.setProfile(p); }")
    check(await fm(page, '__fm.mastered()') == [2, 3, 4], 'quick: mastery should follow the profile')
    # a campaign puzzle afterwards: hints back to the world's own set
    await page.evaluate("() => __debug.startPuzzle('w1-use-01')")
    un = (await fm(page, '__debug.hintState()'))['unlocked']
    check(un == LEARNED0, f'quick: campaign hints after Free Mode {un}')
    check(not errs, f'quick mastery errors: {errs}')
    await ctx.close()

async def wrong_cell(page, clash):
    """An empty cell + a wrong digit that does (clash=True) or does not clash with a peer."""
    return await page.evaluate("""(clash) => { const S = __debug.S, P = (i) => { const r = i / 9 | 0, c = i % 9, out = [];
        for (let j = 0; j < 81; j++) if (j !== i && ((j / 9 | 0) === r || j % 9 === c || (((j / 9 | 0) / 3 | 0) === ((r / 3) | 0) && (((j % 9) / 3) | 0) === ((c / 3) | 0)))) out.push(j); return out; };
      for (let i = 0; i < 81; i++) { if (S.values[i]) continue; const peers = P(i);
        for (let d = 1; d <= 9; d++) { if (d === S.sol[i]) continue; const cl = peers.some(j => S.values[j] === d); if (cl === clash) return [i, d]; } }
      return null; }""", clash)

async def place(page, i, d):
    if await page.evaluate('() => __debug.S.selected') != i:    # tapping the selected cell would deselect it
        await tap(page, f'.cell[data-i="{i}"]')
    await tap(page, f'.key.digit[data-d="{d}"]')
    await page.wait_for_timeout(250)
    return await page.evaluate("(i) => ({ red: document.querySelector(`.cell[data-i=\"${i}\"]`).classList.contains('conflict'), m: __debug.S.mistakes, sw: __debug.S.silentWrong })", i)

async def t_feedback(browser):
    ctx, page, errs = await new_page(browser)
    for mode, label in (('instant', 'Instant truth'), ('conflicts', 'Conflicts only'), ('nothing', 'Nothing')):
        await open_screen(page)
        await page.click(f'.fm-seg button[data-fb="{mode}"]')
        check(await fm(page, '__fm.state().feedback') == mode, f'feedback: seg {mode} not stored')
        await tap(page, '.fm-band[data-band="gentle"]'); await page.wait_for_timeout(80)
        await page.evaluate("() => __debug.startPuzzle(__debug.S.id, false)")     # from the givens
        check(await fm(page, '__fm.feedback()') == mode, f'feedback: rule for Quick Play should be {mode}')
        i, d = await wrong_cell(page, False)
        r = await place(page, i, d)
        if mode == 'instant': check(r['red'] and r['m'] == 1, f'feedback instant: wrong non-clashing digit {r}')
        else: check(not r['red'] and r['m'] == 0 and r['sw'] == 1, f'feedback {mode}: wrong non-clashing digit {r}')
        await page.keyboard.press('u'); await page.wait_for_timeout(100)
        i, d = await wrong_cell(page, True)
        r = await place(page, i, d)
        if mode == 'nothing':
            red = await page.evaluate("() => document.querySelectorAll('.cell.conflict').length")
            check(red == 0 and r['m'] == 0, f'feedback nothing: a clash showed red ({red}) or counted {r}')
            await page.screenshot(path=str(OUT / 'feedback-nothing.png'))
        else: check(r['red'] and r['m'] >= 1, f'feedback {mode}: clashing digit {r}')
        if mode == 'instant': await page.screenshot(path=str(OUT / 'feedback-instant.png'))
    # campaign puzzles ignore the Free Mode setting
    await page.evaluate("() => __debug.startPuzzle('w2-use-01', false)")
    check(await fm(page, '__fm.feedback()') == 'conflicts', 'feedback: campaign puzzle should use conflicts only')
    i, d = await wrong_cell(page, False)
    r = await place(page, i, d)
    check(not r['red'] and r['m'] == 0, f'feedback: campaign wrong digit with "nothing" set {r}')
    check(not errs, f'feedback errors: {errs}')
    await ctx.close()

async def t_persist(browser):
    ctx, page, errs = await new_page(browser)
    await open_screen(page)
    await page.click('.fm-seg button[data-fb="nothing"]')
    await tap(page, '.fm-ch .set-toggle'); await page.wait_for_timeout(40)
    await tap(page, '.fm-band[data-band="medium"]'); await page.wait_for_timeout(80)
    mid = await fm(page, '__debug.S.id')
    await page.evaluate("() => { window.__ev = null; document.addEventListener('sudoku:solved', e => { window.__ev = e.detail; }); }")
    await page.wait_for_timeout(600)
    await solve(page)
    ev = await fm(page, 'window.__ev')
    check(ev and set(ev) >= {'id', 'mode', 'world', 'mistakes', 'paidHints', 'silentWrong', 'ms', 'charges', 'clean'} and ev['id'] == mid, f'persist: solved event detail {ev}')
    await open_screen(page); await tap(page, '.fm-play'); await page.wait_for_timeout(80)
    await solve(page)
    before = await fm(page, '__fm.state()')
    await page.reload(); await page.wait_for_function('() => window.__fm')
    after = await fm(page, '__fm.state()')
    check(before == after and after['feedback'] == 'nothing' and after['challenge'] and after['solved']['medium'] == [mid] and after['daily']['streak'] == 1,
          f'persist: state changed across reload\n{before}\n{after}')
    await open_screen(page)
    ui = await page.evaluate("() => ({ seg: document.querySelector('.fm-seg [aria-checked=\"true\"]').dataset.fb, ch: document.querySelector('.fm-ch .set-toggle').getAttribute('aria-checked'), med: document.querySelector('.fm-band[data-band=\"medium\"]').innerText, streak: document.querySelector('.fm-streak b').textContent })")
    check(ui['seg'] == 'nothing' and ui['ch'] == 'true' and '1 solved' in ui['med'] and ui['streak'] == '1', f'persist: screen after reload {ui}')
    raw = await fm(page, "JSON.parse(localStorage.getItem('sudoku.free.v1'))")
    check(raw and raw['v'] == 1 and 'played' in raw and 'daily' in raw, 'persist: stored under sudoku.free.v1')
    check(not errs, f'persist errors: {errs}')
    await ctx.close()

async def t_nav(browser):
    ctx, page, errs = await new_page(browser)
    check(not await fm(page, '__fm.isOpen()'), 'nav: screen open at boot without #free')
    await open_screen(page)
    check(await fm(page, '__fm.isOpen()') and await page.is_visible('#fm'), 'nav: {to:free} should open the screen')
    await page.evaluate("() => { window.__nav = []; document.addEventListener('sudoku:nav', e => window.__nav.push(e.detail.to)); }")
    await tap(page, '.fm-back'); await page.wait_for_timeout(300)
    check(await fm(page, 'window.__nav') == ['home'] and not await fm(page, '__fm.isOpen()'), f'nav: Home key {await fm(page, "window.__nav")}')
    check(await fm(page, '__debug.prog.screen()') == 'home' and await page.is_visible('#home'), 'nav: Home key should show Home')
    # merge: the entry is Home's Free Mode keycap (the TEMP DEV chip is gone)
    await tap(page, '#home .hbig.free'); await page.wait_for_timeout(350)
    check(await fm(page, '__fm.isOpen()') and await fm(page, '__debug.prog.screen()') is None, 'nav: Home Free Mode key should open the screen alone')
    await tap(page, '#pid'); await page.wait_for_timeout(200)
    check(await page.locator('#devSheet .chip[data-nav="free"]').count() == 0, 'nav: the TEMP DEV chip should be gone')
    await page.evaluate("() => __debug.closeDev()"); await page.wait_for_timeout(100)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
    check(not await fm(page, '__fm.isOpen()') and await fm(page, '__debug.prog.screen()') == 'home', 'nav: Escape should go back Home')
    await tap(page, '#home .hbig.free'); await page.wait_for_timeout(350)
    # keyboard input does not reach the board while the screen is open
    await open_screen(page)
    v0 = await fm(page, 'Array.from(__debug.S.values).join("")')
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('5')
    check(await fm(page, 'Array.from(__debug.S.values).join("")') == v0 and await fm(page, '__debug.S.selected') == -1, 'nav: keys leaked to the board')
    # merge: the header's one back control goes to Free Mode during a Free Mode puzzle (step 7's #homeBtn)
    await tap(page, '.fm-band[data-band="gentle"]'); await page.wait_for_timeout(100)
    check(await page.locator('#fmBack').count() == 0, 'nav: the old #fmBack button should be gone')
    check(await page.get_attribute('#homeBtn', 'data-to') == 'free', 'nav: header back should target Free Mode during Quick Play')
    await tap(page, '#homeBtn'); await page.wait_for_timeout(100)
    check(await fm(page, '__fm.isOpen()'), 'nav: header back should open Free Mode')
    await page.evaluate("() => { __fm.close(); __debug.startPuzzle('w1-use-01'); }")
    check(await page.get_attribute('#homeBtn', 'data-to') == 'home', 'nav: header back outside Free Mode should target Home')
    # #free boot
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1#free'); await page.reload(); await page.wait_for_function('() => window.__fm')
    check(await fm(page, '__fm.isOpen()'), 'nav: #free should open the screen at boot')
    check(not errs, f'nav errors: {errs}')
    await ctx.close()

GEOM_JS = """() => {
  const fm = document.getElementById('fm'), sc = fm.querySelector('.fm-scroll'), W = innerWidth, bad = [];
  if (document.documentElement.scrollWidth > W || sc.scrollWidth > sc.clientWidth + 1) bad.push(`horizontal overflow ${sc.scrollWidth}/${sc.clientWidth}`);
  for (const e of fm.querySelectorAll('.fm-top, .fm-card, .fm-quick, .fm-fb, .key, .fm-dtitle, .fm-streak, .fm-seg')) {
    const r = e.getBoundingClientRect();
    if (r.width && (r.left < -0.5 || r.right > W + 0.5)) bad.push(`${e.className} outside x: ${r.left.toFixed(1)}..${r.right.toFixed(1)}`);
  }
  for (const k of fm.querySelectorAll('.fm-band, .fm-play, .fm-back, .fm-day')) {
    const cap = k.querySelector('.cap').getBoundingClientRect();
    for (const t of k.querySelectorAll('.fm-bn, .fm-bneeds, .fm-bstat, .fm-block, .lbl, .lg, .fm-wd')) {
      const r = t.getBoundingClientRect(); if (!r.width || getComputedStyle(t).opacity === '0') continue;
      if (r.left < cap.left - 0.5 || r.right > cap.right + 0.5 || r.top < cap.top - 0.5 || r.bottom > cap.bottom + 0.5 || t.scrollWidth > t.clientWidth + 1)
        bad.push(`text overflows its cap: ${k.className.split(' ').slice(0, 3).join('.')} ${t.className} "${t.textContent.trim()}"`);
    }
  }
  const secs = [...fm.querySelectorAll('.fm-top, .fm-card, .fm-quick, .fm-fb')].map(e => e.getBoundingClientRect());
  for (let i = 1; i < secs.length; i++) if (secs[i].top < secs[i - 1].bottom - 0.5) bad.push(`sections overlap ${i - 1}/${i}`);
  const b = [...fm.querySelectorAll('.fm-band')].map(e => e.getBoundingClientRect());
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const A = b[i], B = b[j];
    if (A.left < B.right - 0.5 && B.left < A.right - 0.5 && A.top < B.bottom - 0.5 && B.top < A.bottom - 0.5) bad.push(`band cards ${i}/${j} overlap`); }
  const dh = fm.querySelector('.fm-dhead'), t1 = fm.querySelector('.fm-dtitle').getBoundingClientRect(), t2 = fm.querySelector('.fm-streak').getBoundingClientRect();
  if (t1.right > t2.left) bad.push('daily title runs into the streak');
  const st = fm.querySelector('.fm-dstatus').getBoundingClientRect(), pl = fm.querySelector('.fm-play').getBoundingClientRect();
  if (st.right > pl.left + 0.5) bad.push('daily status runs into Play');
  return { bad, scroll: sc.scrollHeight > sc.clientHeight + 1, fits: sc.scrollHeight - sc.clientHeight };
}"""

def progress_state(today_day):
    solved = {str(today_day - k): 150000 + k * 9000 for k in (1, 2, 3)}
    return json.dumps({'v': 1, 'played': {'gentle': ['q-gentle-001', 'q-gentle-002', 'q-gentle-003'], 'easy': ['q-easy-001'], 'medium': [], 'tricky': []},
                       'solved': {'gentle': ['q-gentle-001', 'q-gentle-002'], 'easy': ['q-easy-001'], 'medium': [], 'tricky': []},
                       'best': {'gentle': 251000, 'easy': 402000}, 'current': {'gentle': 'q-gentle-003'}, 'clock': {'q-gentle-003': 74000},
                       'daily': {'solved': solved, 'late': {}, 'streak': 3, 'lastDay': today_day - 1}, 'feedback': 'conflicts', 'challenge': False})

async def t_layout(browser):
    today = dt.date(2026, 11, 12)    # a Thursday: Mon-Wed solved, streak 3 alive
    tday = (today - EPOCH).days
    combos = []
    for style in ('sa', 'cherry'):
        for vp in ((390, 844), (375, 667)):
            for scheme, motion in (('light', 'no-preference'), ('dark', 'no-preference'), ('light', 'reduce')):
                combos.append((style, vp, scheme, motion))
    shots = 0
    for style, vp, scheme, motion in combos:
        storage = {'sudoku.settings.v1': json.dumps({'v': 1, 'style': style, 'layout': 'plain', 'preset': 'retro' if style == 'sa' else 'ink', 'sound': False, 'switchVol': .8}),
                   'sudoku.free.v1': progress_state(tday), 'sudoku.camp.v1': json.dumps({'done': {'w2-master-01': True}})}
        ctx, page, errs = await new_page(browser, '#shot', vp, scheme, motion, storage, clock=local_noon(today))
        await open_screen(page); await page.wait_for_timeout(350)
        tag = f'{style}-{vp[0]}x{vp[1]}-{scheme}{"-rm" if motion == "reduce" else ""}'
        g = await page.evaluate(GEOM_JS)
        check(not g['bad'], f'layout {tag}: {g["bad"]}')
        await page.screenshot(path=str(OUT / f'screen-{tag}.png')); shots += 1
        if vp == (375, 667):
            await page.evaluate("() => { const s = document.querySelector('.fm-scroll'); s.scrollTop = s.scrollHeight; }")
            await page.wait_for_timeout(80)
            await page.screenshot(path=str(OUT / f'screen-{tag}-bottom.png')); shots += 1
        if motion == 'no-preference' and scheme == 'light':
            # Challenge me on: warning + opened bands
            await page.evaluate("() => { document.querySelector('.fm-scroll').scrollTop = 0; }")
            await tap(page, '.fm-ch .set-toggle'); await page.wait_for_timeout(650)
            g = await page.evaluate(GEOM_JS)
            check(not g['bad'], f'layout {tag} challenge: {g["bad"]}')
            await page.screenshot(path=str(OUT / f'screen-{tag}-challenge.png')); shots += 1
        if vp == (390, 844) and motion == 'no-preference':
            # the daily toast with its lit flame (embers from the last cell)
            await tap(page, '.fm-play'); await page.wait_for_timeout(80)
            await solve(page)
            await page.clock.run_for(2600); await page.wait_for_timeout(1000)
            lit = await page.evaluate("() => document.querySelector('.fm-tstreak').classList.contains('lit')")
            check(lit, f'layout {tag}: toast flame not lit')
            await page.screenshot(path=str(OUT / f'toast-{tag}.png')); shots += 1
        check(not errs, f'layout {tag} errors: {errs}')
        await ctx.close()
    notes.append(f'layout: {len(combos)} combinations, {shots} screenshots in {OUT}')

async def main():
    which = set(sys.argv[1:]) or {'daily', 'streak', 'quick', 'feedback', 'persist', 'nav', 'layout'}
    subprocess.run(['node', str(ROOT / 'tools/build.mjs')], check=True, stdout=subprocess.DEVNULL)
    srv = start_server(); time.sleep(0.6)
    t0 = time.time()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME)
            for name, fn in (('daily', t_daily), ('streak', t_streak), ('quick', t_quick), ('feedback', t_feedback),
                             ('persist', t_persist), ('nav', t_nav), ('layout', t_layout)):
                if name not in which: continue
                n0 = len(failures)
                try: await fn(browser)
                except Exception as e: failures.append(f'{name}: exception {type(e).__name__}: {e}')
                print(f'{"PASS" if len(failures) == n0 else "FAIL"} {name}')
            await browser.close()
    finally:
        srv.terminate()
    for n in notes: print('  ·', n)
    for f in failures: print('FAIL:', f)
    print(f'{"OK" if not failures else "FAILED"} ({len(failures)} failures, {time.time() - t0:.1f}s)')
    sys.exit(1 if failures else 0)

asyncio.run(main())
