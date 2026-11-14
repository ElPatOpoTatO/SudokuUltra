#!/usr/bin/env python3
"""integration-test.py — step 7 (progression, Home) + step 8 (Free Mode) together (Playwright).

    node tools/build.mjs && python3 tools/integration-test.py [i1 i2 i3 i4 i5 i6 i7]

  i1  launch -> Home (fresh: no Continue, no puzzle clock running) -> Free Mode
      -> Daily -> solve: ONE sudoku:solved event, the Free Mode toast with the
      streak flame, no charges card, expertise +N exactly once (N = band world
      + 1), Free Mode bookkeeping (daily solved, streak 1) -> header back ->
      Free Mode -> Home shows the new expertise.
  i2  Home -> Campaign -> World 0 -> Spot it 1 -> solve: the charges card, no
      Free Mode streak row; the Free Mode state is untouched.
  i3  Free Mode mastery follows the profile: World 2 mastered (DEV row /
      setProfile) -> the Easy band opens, hints learn naked singles; back off ->
      locked again.
  i4  Continue resumes a Quick Play puzzle: within the session and after a
      reload (same id, autosaved digit, Free Mode session + clock restored).
  i5  the header's one back control: Quick Play / Daily -> Free Mode; campaign
      runner and a world's Level 0 -> that world's level list; anything else
      -> Home. No #fmBack, no TEMP DEV chip.
  i6  375x667 and 390x844: header items do not overlap, the status line is not
      truncated (Free Mode and campaign puzzles).
  i7  screenshots (390x844 + 375x667): Home, Free Mode, a Free Mode puzzle
      header, a campaign puzzle header -> /tmp/integration/

INTEG_PORT overrides the port (default 8799). Exit code 1 on any failure.
"""
import asyncio, json, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/integration'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = int(os.environ.get('INTEG_PORT', 8799))
failures, notes = [], []

def check(cond, msg):
    if not cond: failures.append(msg)
    return cond

async def new_page(browser, hash_='', vp=(390, 844), storage=None, scale=1):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, device_scale_factor=scale)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    seed = {'sudoku.settings.v1': json.dumps({'v': 1, 'sound': False})}
    seed.update(storage or {})
    await page.add_init_script(f"try {{ if (!sessionStorage.getItem('__seeded')) {{ for (const [k, v] of Object.entries({json.dumps(seed)})) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); }} }} catch (e) {{}}")
    # count every solved event from the very start
    await page.add_init_script("window.__solved = []; document.addEventListener('sudoku:solved', e => window.__solved.push(e.detail));")
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{hash_}')
    await page.wait_for_function('() => window.__debug && window.__debug.prog && window.__fm')
    return ctx, page, errs

async def ev(page, js, arg=None): return await page.evaluate(js, arg)
async def tap(page, sel):
    b = await page.locator(sel).first.bounding_box()
    assert b, f'not visible: {sel}'
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down(); await page.mouse.up()
async def screen(page): return await ev(page, '() => __debug.prog.screen()')
async def fm_open(page): return await ev(page, '() => __fm.isOpen()')
async def prof(page): return await ev(page, '() => __debug.prog.getProfile()')
async def back_to(page): return await ev(page, "() => document.getElementById('homeBtn').dataset.to")

async def solve_free(page):
    """Fill every empty cell but the last with the solution, then place the last one through the UI."""
    last = await ev(page, """() => { const S = __debug.S; let last = -1;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i]) last = i;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i] && i !== last) { S.values[i] = S.sol[i]; S.notes[i] = 0; }
      __debug.refresh(); return [last, S.sol[last]]; }""")
    if await ev(page, '() => __debug.S.selected') != last[0]: await tap(page, f'.cell[data-i="{last[0]}"]')
    await tap(page, f'.key.digit[data-d="{last[1]}"]')
    await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=6000)

async def toast_view(page):
    return await ev(page, """() => ({ title: document.getElementById('toastTitle').textContent,
      msg: document.getElementById('toastMsg') ? document.getElementById('toastMsg').textContent : '',
      rc: !!document.querySelector('#toast .rc') && document.querySelector('#toast .rc').offsetParent !== null,
      cells: document.querySelectorAll('#toast .rc .cc').length,
      streak: document.querySelector('#toast .fm-tstreak').classList.contains('on'),
      lit: document.querySelector('#toast .fm-tstreak').classList.contains('lit'),
      key: document.querySelector('#againKey .lbl').textContent })""")

# ---------------------------------------------------------------------------
async def i1_daily(browser):
    ctx, page, errs = await new_page(browser)
    h = await ev(page, "() => ({ scr: __debug.prog.screen(), cont: document.querySelector('#home .key.cont').offsetParent !== null, sess: __fm.session() })")
    check(h['scr'] == 'home' and not h['cont'], f'i1 launch -> Home, no Continue on a fresh profile: {h}')
    await page.wait_for_timeout(250)
    s = await ev(page, '() => __fm.session()')
    check(not s or not s['running'], f'i1 the boot puzzle behind Home does not run a clock: {s}')
    check(await ev(page, "() => localStorage.getItem('sudoku.lastctx')") is None, 'i1 the boot puzzle is not recorded as played')
    exp0 = (await prof(page))['expertise']
    await tap(page, '#home .hbig.free'); await page.wait_for_timeout(400)
    check(await fm_open(page) and await screen(page) is None, 'i1 Home Free Mode key -> Free Mode screen on top')
    vis = await ev(page, "() => { const r = document.getElementById('fm').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, 120); return !!(e && e.closest('#fm')); }")
    check(vis, 'i1 the Free Mode screen is the top layer')
    await tap(page, '.fm-play'); await page.wait_for_timeout(250)
    today = await ev(page, '() => __fm.today()')
    sid = await ev(page, '() => __debug.S.id')
    check(sid == today['id'] and not await fm_open(page), f'i1 Daily Play opens today\'s daily: {sid} vs {today["id"]}')
    check(await back_to(page) == 'free', 'i1 header back targets Free Mode during the daily')
    await page.wait_for_timeout(1100)
    run = await ev(page, '() => __fm.session()')
    check(run and run['running'] and run['elapsed'] >= 900, f'i1 the Free Mode clock runs during the daily: {run}')
    await solve_free(page)
    await page.wait_for_timeout(1400)    # embers + flame
    t = await toast_view(page)
    sol = await ev(page, '() => window.__solved')
    world = {'gentle': 1, 'easy': 2, 'medium': 3, 'tricky': 4}[today['band']]
    p1 = await prof(page)
    st = await ev(page, '() => __fm.state()')
    ls = await ev(page, '() => __fm.lastSolve()')
    check(len(sol) == 1 and sol[0]['id'] == sid and sol[0]['mode'] == 'free' and sol[0]['kind'] == 'daily' and sol[0]['world'] == world,
          f'i1 exactly one solved event with the right detail: {sol}')
    check(sol and isinstance(sol[0]['ms'], (int, float)) and ls and abs(sol[0]['ms'] - ls['ms']) <= 5 and sol[0]['ms'] >= 900,
          f'i1 the event ms is the Free Mode clock: event {sol and sol[0]["ms"]} vs toast {ls and ls["ms"]}')
    check(t['streak'] and t['lit'] and t['title'] == 'Daily solved' and not t['rc'] and t['cells'] == 0,
          f'i1 Free Mode toast with the lit streak flame, no charges card: {t}')
    check(p1['expertise']['points'] - exp0['points'] == world + 1, f'i1 expertise +{world + 1} once: {exp0} -> {p1["expertise"]}')
    check(not p1['levels'], f'i1 no campaign charges from a Free Mode solve: {p1["levels"]}')
    check(str(today['day']) in {str(k) for k in st['daily']['solved']} and st['daily']['streak'] == 1, f'i1 daily bookkeeping: {st["daily"]}')
    # a toast re-render (hooks firing again) must not count anything twice
    await ev(page, '() => { for (let k = 0; k < 3; k++) document.dispatchEvent(new Event("visibilitychange")); }')
    p1b = await prof(page)
    check(p1b['expertise'] == p1['expertise'] and len(await ev(page, '() => window.__solved')) == 1, 'i1 nothing counted twice')
    # back -> Free Mode -> Home with the new expertise
    await tap(page, '#homeBtn'); await page.wait_for_timeout(400)
    check(await fm_open(page), 'i1 header back -> Free Mode')
    fmv = await ev(page, "() => ({ streak: document.querySelector('.fm-streak b').textContent, done: document.querySelector('.fm-dfoot').classList.contains('done') })")
    check(fmv['streak'] == '1' and fmv['done'], f'i1 Free Mode shows the solved daily + streak 1: {fmv}')
    await tap(page, '.fm-back'); await page.wait_for_timeout(450)
    hv = await ev(page, "() => ({ scr: __debug.prog.screen(), inner: document.querySelector('#home .xp').dataset.inner, cont: document.querySelector('#home .key.cont small').textContent })")
    want_inner = str(max(exp0['inner'], 1 + (world + 1) // 6))
    check(hv['scr'] == 'home' and hv['inner'] == want_inner and hv['cont'].startswith('Daily'), f'i1 Home shows the updated expertise (inner {want_inner}) and Continue: {hv}')
    check(not errs, f'i1 errors: {errs}')
    notes.append(f'i1 daily {sid} ({today["band"]}): 1 event, ms {sol and sol[0]["ms"]} = Free Mode clock, toast "{t["title"]}" + flame, expertise {exp0["points"]} -> {p1["expertise"]["points"]}, Home inner {hv["inner"]}')
    await ctx.close()

async def i2_campaign(browser):
    ctx, page, errs = await new_page(browser)
    fm0 = await ev(page, '() => JSON.stringify(__fm.state())')
    await tap(page, '#home .key.camp'); await page.wait_for_timeout(450)
    await tap(page, '#campMap .key.wk[data-world="0"]'); await page.wait_for_timeout(450)
    await tap(page, '#campWorld .key[data-level="0.1"]'); await page.wait_for_timeout(450)
    cs = await ev(page, '() => __debug.camp.state()')
    check(cs['active'] and cs['world'] == 0 and cs['k'] == 1 and await screen(page) is None, f'i2 World 0 Spot it 1 started from the map: {cs}')
    check(await back_to(page) == 'world', 'i2 header back targets the world list in the campaign')
    step = await ev(page, '() => __debug.S.spot.step')
    pl = step['place']
    if await ev(page, '() => __debug.S.selected') != pl['cell']: await tap(page, f'.cell[data-i="{pl["cell"]}"]')
    await tap(page, f'.key.digit[data-d="{pl["digit"]}"]')
    await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=9000)
    await page.wait_for_function("() => ['done', 'idle'].includes(__debug.prog.RC.phase)", timeout=9000)
    t = await toast_view(page)
    sol = await ev(page, '() => window.__solved')
    p = await prof(page)
    check(t['rc'] and t['cells'] == 3 and not t['streak'], f'i2 the charges card, no Free Mode streak row: {t}')
    check(len(sol) == 1 and sol[0]['mode'] == 'campaign' and p['levels'].get(cs['id']) == 3, f'i2 one campaign event, 3 charges kept: {sol} {p["levels"]}')
    check(await ev(page, '() => JSON.stringify(__fm.state())') == fm0 and await ev(page, '() => __fm.lastSolve()') is None, 'i2 Free Mode bookkeeping untouched by a campaign solve')
    check(t['key'] == 'Next', f'i2 the toast keycap is the runner\'s Next: {t["key"]}')
    check(not errs, f'i2 errors: {errs}')
    notes.append(f'i2 campaign {cs["id"]}: results card with {t["cells"]} cells, no streak row, profile {p["levels"]}')
    await ctx.close()

async def i3_mastery(browser):
    ctx, page, errs = await new_page(browser)
    await ev(page, "() => __debug.prog.nav('free')"); await page.wait_for_timeout(300)
    locked = lambda: ev(page, "() => [...document.querySelectorAll('.fm-band')].map(k => k.classList.contains('locked'))")
    l0 = await locked()
    check(l0 == [False, True, True, True], f'i3 nothing mastered -> only Gentle open: {l0}')
    # DEV: master worlds 0-2 through the profile (the DEV menu row does the same through devMaster)
    await ev(page, "() => __debug.prog.devMaster(2)")
    await page.wait_for_timeout(150)
    l1 = await locked()
    m = await ev(page, '() => __fm.mastered()')
    check(2 in m and l1[:2] == [False, False] and l1[2:] == [True, True], f'i3 World 2 mastered -> Easy open (re-rendered live): {m} {l1}')
    await tap(page, '.fm-band[data-band="easy"]'); await page.wait_for_timeout(150)
    un = (await ev(page, '() => __debug.hintState()'))['unlocked']
    check('naked-single' in un and 'pointing' not in un, f'i3 hints learn World 2 (naked single), not World 3: {un}')
    await ev(page, "() => { const p = __debug.prog.getProfile(); p.mastered = []; p.levels = {}; __debug.prog.setProfile(p); }")
    check(await ev(page, '() => __fm.mastered()') == [], 'i3 mastery removed from the profile -> none in Free Mode')
    await ev(page, "() => __debug.prog.nav('free')"); await page.wait_for_timeout(300)
    check(await locked() == [False, True, True, True], 'i3 bands lock again')
    check(not errs, f'i3 errors: {errs}')
    notes.append(f'i3 mastery via the profile: none {l0} -> devMaster(2) {l1} -> cleared')
    await ctx.close()

async def i4_continue(browser):
    ctx, page, errs = await new_page(browser)
    await ev(page, "() => __debug.prog.nav('free')"); await page.wait_for_timeout(300)
    await tap(page, '.fm-band[data-band="gentle"]'); await page.wait_for_timeout(250)
    qid = await ev(page, '() => __debug.S.id')
    i, d = await ev(page, '() => { const S = __debug.S; for (let i = 0; i < 81; i++) if (!S.values[i]) return [i, S.sol[i]]; }')
    await tap(page, f'.cell[data-i="{i}"]'); await tap(page, f'.key.digit[data-d="{d}"]')
    await page.wait_for_timeout(700)
    await tap(page, '#homeBtn'); await page.wait_for_timeout(350)
    await tap(page, '.fm-back'); await page.wait_for_timeout(450)
    sub = await ev(page, "() => document.querySelector('#home .key.cont small').textContent")
    check(sub == 'Quick Play · Gentle', f'i4 Continue label: {sub}')
    s_home = await ev(page, '() => __fm.session()')
    await page.wait_for_timeout(500)
    s_home2 = await ev(page, '() => __fm.session()')
    check(s_home and not s_home2['running'] and abs(s_home2['elapsed'] - s_home['elapsed']) < 30, f'i4 the clock is paused while Home is up: {s_home} {s_home2}')
    await tap(page, '#home .key.cont'); await page.wait_for_timeout(350)
    v = await ev(page, f'() => ({{ id: __debug.S.id, v: __debug.S.values[{i}], scr: __debug.prog.screen(), fm: __fm.isOpen(), s: __fm.session() }})')
    check(v['id'] == qid and v['v'] == d and v['scr'] is None and not v['fm'] and v['s'] and v['s']['running'], f'i4 Continue (same session) resumes the Quick Play puzzle: {v}')
    await page.wait_for_timeout(400)
    await ev(page, '() => __debug.saveNow()')
    await page.reload(); await page.wait_for_function('() => window.__debug && window.__debug.prog && window.__fm')
    sub2 = await ev(page, "() => ({ scr: __debug.prog.screen(), sub: document.querySelector('#home .key.cont small').textContent })")
    check(sub2['scr'] == 'home' and sub2['sub'] == 'Quick Play · Gentle', f'i4 after reload: Home + Continue label {sub2}')
    await tap(page, '#home .key.cont'); await page.wait_for_timeout(400)
    v2 = await ev(page, f'() => ({{ id: __debug.S.id, v: __debug.S.values[{i}], scr: __debug.prog.screen(), s: __fm.session(), back: document.getElementById("homeBtn").dataset.to }})')
    check(v2['id'] == qid and v2['v'] == d and v2['scr'] is None and v2['s'] and v2['s']['id'] == qid and v2['s']['acc'] > 0 and v2['back'] == 'free',
          f'i4 Continue after reload resumes the same Quick Play puzzle with its autosave + clock: {v2}')
    check(not errs, f'i4 errors: {errs}')
    notes.append(f'i4 Continue: {qid} resumed in-session and after reload (digit kept, clock {v2["s"] and round(v2["s"]["acc"])} ms restored)')
    await ctx.close()

async def i5_back(browser):
    ctx, page, errs = await new_page(browser)
    check(await page.locator('#fmBack').count() == 0, 'i5 the old #fmBack header button is gone')
    await tap(page, '#home .home-dev'); await page.wait_for_timeout(200)
    check(await page.locator('#devSheet .chip[data-nav="free"]').count() == 0, 'i5 the TEMP DEV "Free Mode" chip is gone')
    await ev(page, '() => __debug.closeDev()')
    res = {}
    # a Daily puzzle
    await ev(page, "() => { __debug.prog.nav('free'); }"); await page.wait_for_timeout(300)
    await tap(page, '.fm-play'); await page.wait_for_timeout(250)
    res['daily'] = await back_to(page)
    await tap(page, '#homeBtn'); await page.wait_for_timeout(350)
    res['daily->'] = 'free' if await fm_open(page) else await screen(page)
    # campaign runner
    await ev(page, "() => { __fm.close(); __debug.prog.hideScreens(); __debug.camp.start(1, 3); }"); await page.wait_for_timeout(300)
    res['camp'] = await back_to(page)
    await tap(page, '#homeBtn'); await page.wait_for_timeout(450)
    res['camp->'] = await screen(page)
    wl = await ev(page, "() => document.querySelector('#campWorld').dataset.world || (document.querySelector('#campWorld h1, #campWorld .cw-t') || {}).textContent || ''")
    # a world's Level 0 on its own
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1#l0=w2'); await page.reload(); await page.wait_for_function('() => window.__debug && window.__debug.prog')
    await page.wait_for_timeout(300)
    res['l0'] = await back_to(page)
    await tap(page, '#homeBtn'); await page.wait_for_timeout(450)
    res['l0->'] = await screen(page)
    # a puzzle outside both (a Spot it opened directly)
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1#p=w1-use-01'); await page.reload(); await page.wait_for_function('() => window.__debug && window.__debug.prog')
    await page.wait_for_timeout(200)
    res['other'] = await back_to(page)
    await tap(page, '#homeBtn'); await page.wait_for_timeout(450)
    res['other->'] = await screen(page)
    want = {'daily': 'free', 'daily->': 'free', 'camp': 'world', 'camp->': 'world', 'l0': 'world', 'l0->': 'world', 'other': 'home', 'other->': 'home'}
    check(res == want, f'i5 back control targets: {res} (world list: {wl!r})')
    check(not errs, f'i5 errors: {errs}')
    notes.append(f'i5 back control: {res}')
    await ctx.close()

HDR_JS = """() => {
  const vis = e => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const items = ['homeBtn', 'pid', 'status'].map(id => document.getElementById(id)).concat([document.querySelector('.hdr .stat')], [...document.querySelectorAll('.hdr .hbtns .hbtn, .hdr .hkeys .key')]).filter(vis);
  const R = items.map(e => [e.id || e.className.split(' ')[0], e.getBoundingClientRect()]);
  const bad = [];
  for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) {
    const [n1, A] = R[a], [n2, B] = R[b];
    if (A.left < B.right - 0.5 && B.left < A.right - 0.5 && A.top < B.bottom - 0.5 && B.top < A.bottom - 0.5) bad.push(`${n1} overlaps ${n2}`);
  }
  for (const [n, r] of R) if (r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`${n} off screen`);
  const st = document.getElementById('status');
  if (st.scrollWidth > st.clientWidth + 1) bad.push(`status truncated: "${st.innerText}"`);
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('horizontal overflow');
  return { bad, status: st.innerText };
}"""

async def i6_header(browser):
    for vp in ((375, 667), (390, 844)):
        for h in ('#p=q-gentle-010', '#p=d-0005', '#camp=0.1', '#camp=2.8', '#l0=w1'):
            ctx, page, errs = await new_page(browser, h, vp)
            await page.wait_for_timeout(250)
            r = await ev(page, HDR_JS)
            # selected cell + loaded digit states too
            if 'l0' not in h:
                i = await ev(page, '() => { const S = __debug.S; for (let i = 0; i < 81; i++) if (!S.values[i]) return i; return 0; }')
                await tap(page, f'.cell[data-i="{i}"]'); await page.wait_for_timeout(60)
                r2 = await ev(page, HDR_JS)
                r['bad'] += r2['bad']
            check(not r['bad'], f'i6 header {vp[0]}x{vp[1]} {h}: {r}')
            check(not errs, f'i6 errors {h}: {errs}')
            await ctx.close()
    notes.append('i6 header: no overlaps, status not truncated, at 375x667 and 390x844 (Quick Play, Daily, World 0/2 runner, Level 0)')

async def i7_shots(browser):
    shots = []
    for vp in ((390, 844), (375, 667)):
        tag = f'{vp[0]}x{vp[1]}'
        ctx, page, errs = await new_page(browser, '', vp, scale=2,
                                         storage={'sudoku.profile.v1': json.dumps({'v': 1, 'levels': {}, 'mastered': [0, 1, 2], 'expertise': {'tier': 1, 'inner': 3, 'points': 14}})})
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / f'{tag}-home.png')); shots.append(f'{tag}-home.png')
        await tap(page, '#home .hbig.free'); await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / f'{tag}-freemode.png')); shots.append(f'{tag}-freemode.png')
        await tap(page, '.fm-band[data-band="easy"]'); await page.wait_for_timeout(450)
        await page.screenshot(path=str(OUT / f'{tag}-free-puzzle.png')); shots.append(f'{tag}-free-puzzle.png')
        await page.screenshot(path=str(OUT / f'{tag}-free-header.png'), clip={'x': 0, 'y': 0, 'width': vp[0], 'height': 110}); shots.append(f'{tag}-free-header.png')
        await ev(page, '() => __debug.camp.start(1, 8)'); await page.wait_for_timeout(450)
        await page.screenshot(path=str(OUT / f'{tag}-campaign-puzzle.png')); shots.append(f'{tag}-campaign-puzzle.png')
        await page.screenshot(path=str(OUT / f'{tag}-campaign-header.png'), clip={'x': 0, 'y': 0, 'width': vp[0], 'height': 110}); shots.append(f'{tag}-campaign-header.png')
        check(not errs, f'i7 errors {tag}: {errs}')
        await ctx.close()
    notes.append(f'i7 {len(shots)} screenshots in {OUT}: ' + ', '.join(shots))

async def main():
    assert (DIST / 'index.html').exists(), 'run node tools/build.mjs first'
    srv = subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            only = [a for a in sys.argv[1:] if a.startswith('i')]
            for name, fn in [('i1', i1_daily), ('i2', i2_campaign), ('i3', i3_mastery), ('i4', i4_continue), ('i5', i5_back), ('i6', i6_header), ('i7', i7_shots)]:
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
    print('INTEGRATION')
    for n in notes: print('  ' + n)
    if failures:
        print(f'\nFAIL ({len(failures)})')
        for f in failures: print('  - ' + f)
        sys.exit(1)
    print('\nPASS')

if __name__ == '__main__':
    asyncio.run(main())
