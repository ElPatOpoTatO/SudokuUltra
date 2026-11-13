#!/usr/bin/env python3
"""level0-test.py — Level 0 engine, World 0 script and the world runner (Playwright).

    node tools/build.mjs && python3 tools/level0-test.py

  T1 validator: content/level0/*.json pass (node tools/validate-level0.mjs, which
     also checks that deliberately broken scripts are rejected); the same check
     in the browser bundle; a broken script refuses to start.
  T2 W0 Level 0 end to end through the real UI (pointer + keyboard): a wrong
     action -> nudge, no mistake; three wrong -> "show me" plays the move and
     puts the board back, then the player repeats it; pencil on, a note, erase
     it, pencil off; the full-house chain; the outro.
  T3 World 0 runner: Level 0 -> Spot it 1-6 (stored step through the UI) ->
     Use it 1-6 and Master (solution typed through the UI) -> end-of-world
     toast; per-level completion in localStorage; Skip appears after a clean
     Spot it 1.
  T4 layout: coach steps at 390x844 and 375x667, light / dark / reduced motion:
     geometry checks (no overlap, no scrolling, the board never moves between
     steps, every coach text fits) + screenshots in /tmp/level0/.
Exit code 1 on any failure.
"""
import asyncio, json, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/level0'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = 8771             # not the parity test's ports, so both can run side by side

WRAP_SFX = """() => {
  const o = window.__debug.sfx; window.__sfxLog = [];
  for (const k of Object.keys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || typeof d.value !== 'function' || k === 'unlock') continue;
    const fn = d.value; o[k] = function (...a) { window.__sfxLog.push(k); return fn.apply(this, a); };
  }
}"""

failures, notes = [], []
def check(cond, msg):
    if not cond: failures.append(msg)
    return cond


async def new_page(browser, hash_='', vp=(390, 844), scheme='light', motion='no-preference', storage=None):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, device_scale_factor=1,
                                    color_scheme=scheme, reduced_motion=motion)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    if storage:
        await page.add_init_script(f"try {{ for (const [k, v] of Object.entries({json.dumps(storage)})) localStorage.setItem(k, v); }} catch (e) {{}}")
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{hash_}')
    await page.wait_for_function('() => window.__debug')
    await page.evaluate(WRAP_SFX)
    return ctx, page, errs

async def tap(page, sel):
    b = await page.locator(sel).first.bounding_box()
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down(); await page.mouse.up()

async def cell(page, i):
    if await page.evaluate('() => __debug.S.selected') != i:   # tapping the selected cell deselects it
        await tap(page, f'.cell[data-i="{i}"]')
async def key(page, d): await tap(page, f'.key.digit[data-d="{d}"]')
async def mod(page, label): await tap(page, f'.pad .key.mod[aria-label="{label}"]')
async def coach_key(page): await tap(page, '.coach .key.ck.show:not(.skip)')
async def l0(page): return await page.evaluate('() => __debug.L0.state()')
async def S(page, js): return await page.evaluate(f'() => {{ const S = __debug.S; return {js}; }}')

async def wait_step(page, k, timeout=6000):
    await page.wait_for_function('(k) => { const s = __debug.L0.state(); return s.k === k && !s.advancing && !s.demo; }', arg=k, timeout=timeout)

async def do_step(page, st):
    """Perform one script step the straightforward way through the UI."""
    e = st['expect']
    if 'continue' in e: await coach_key(page)
    elif 'tap' in e: await cell(page, e['tap'][0])
    elif 'place' in e: await cell(page, e['place']['cell']); await key(page, e['place']['digit'])
    elif 'note' in e: await cell(page, e['note']['cell']); await key(page, e['note']['digit'])
    elif 'eliminate' in e:
        for c, d in e['eliminate']: await cell(page, c); await key(page, d)
    elif 'loadDigit' in e: await key(page, e['loadDigit'])
    elif 'press' in e: await mod(page, {'pencil': 'Pencil', 'erase': 'Erase', 'undo': 'Undo'}[e['press']])

async def play_l0(page):
    steps = await page.evaluate('() => __debug.L0.scripts.w0.steps')
    for k, st in enumerate(steps):
        await wait_step(page, k)
        await do_step(page, st)
    await page.wait_for_function('() => __debug.L0.state().done', timeout=6000)


# ---------------------------------------------------------------------------
async def t1_validator(browser):
    r = subprocess.run(['node', str(ROOT / 'tools/validate-level0.mjs')], capture_output=True, text=True)
    lines = [l for l in r.stdout.splitlines() if l.strip()]
    rejected = sum(1 for l in lines if l.startswith('PASS (rejected)'))
    check(r.returncode == 0, f'T1 validate-level0.mjs failed:\n{r.stdout}{r.stderr}')
    notes.append(f'T1 node validator: {lines[0]}; {rejected} broken fixtures rejected')
    ctx, page, errs = await new_page(browser, '#p=proto')
    res = await page.evaluate("""() => {
      const L0 = __debug.L0, good = L0.validate(L0.scripts.w0);
      const clone = () => JSON.parse(JSON.stringify(L0.scripts.w0));
      const b1 = clone(); b1.steps[3].glow = true;                  // schema: unknown field
      const b2 = clone(); b2.steps[2].expect.place.digit = 1;       // simulation: wrong digit
      const r1 = L0.validate(b1), r2 = L0.validate(b2);
      const started = L0.start(b2);
      return { good: good.ok, warnings: good.warnings, bad: r1.ok || r2.ok, badErrors: [...r1.errors, ...r2.errors], started, id: __debug.S.id };
    }""")
    check(res['good'] and not res['warnings'], f'T1 in-browser validation of w0: {res}')
    check(not res['bad'] and len(res['badErrors']) >= 2 and not res['started'] and res['id'] == 'proto', f'T1 broken script: {res}')
    notes.append(f'T1 in-browser: w0 ok, broken scripts rejected ({" / ".join(res["badErrors"])}), the broken one refused to start')
    # the console.error from the refused start is expected
    errs = [e for e in errs if 'level0: invalid script' not in e]
    check(not errs, f'T1 errors: {errs}')
    await ctx.close()


async def t2_play(browser):
    ctx, page, errs = await new_page(browser, '#l0=w0')
    steps = await page.evaluate('() => __debug.L0.scripts.w0.steps')
    st0 = await l0(page)
    check(st0['active'] and st0['k'] == 0 and st0['got'] and not st0['skip'], f'T2 start: {st0}')

    # step 0: Got it
    await coach_key(page); await wait_step(page, 1)

    # step 1 (tap r4c2): a wrong cell first -> nudge, nothing selected, no mistake
    await cell(page, 0); await page.wait_for_timeout(60)
    s = await l0(page)
    sel = await S(page, 'S.selected'); mist = await S(page, 'S.mistakes')
    check(s['k'] == 1 and s['nudges'] == 1 and 'nudge' in s['sayClass'] and sel == -1 and mist == 0,
          f'T2 wrong tap: {s} selected={sel} mistakes={mist}')
    await page.screenshot(path=str(OUT / 't2-nudge.png'))
    notes.append(f'T2 wrong tap -> nudge "{s["say"]}", selection unchanged, mistakes 0')
    await cell(page, 28); await wait_step(page, 2)

    # step 2 (place 9 in r4c2): three wrong digits -> show me
    wrong_digits = await page.evaluate("() => { const out = []; for (let d = 1; d <= 9; d++) { let n = 0; for (const v of __debug.S.values) n += v === d; if (d !== 9 && n < 9) out.push(d); } return out; }")
    check(await S(page, 'S.selected') == 28, 'T2 the tapped cell should stay selected into the place step')
    for n, d in enumerate(wrong_digits[:3]):
        await key(page, d); await page.wait_for_timeout(40)
        s = await l0(page)
        if n < 2: check(s['wrong'] == n + 1 and not s['demo'], f'T2 wrong #{n + 1}: {s}')
    s = await l0(page)
    check(s['demo'], f'T2 third wrong should start "show me": {s}')
    seen_place, seen_watch = False, False
    for _ in range(120):
        v = await S(page, 'S.values[28]')
        st = await l0(page)
        if v == 9: seen_place = True
        if st['say'] == 'Watch.': seen_watch = True
        if seen_place and v == 9: await page.screenshot(path=str(OUT / 't2-showme.png'))
        if not st['demo'] and seen_place: break
        await page.wait_for_timeout(50)
    after = await page.evaluate('() => ({ v: __debug.S.values[28], m: __debug.S.mistakes, undo: __debug.S.undo.length, sel: __debug.S.selected, s: __debug.L0.state() })')
    check(seen_place and seen_watch and after['v'] == 0 and after['m'] == 0 and after['s']['shows'] == 1 and not after['s']['demo'] and after['s']['k'] == 2,
          f'T2 show me: placed during demo={seen_place}, "Watch." shown={seen_watch}, after={after}')
    notes.append(f'T2 3 wrong digits {wrong_digits[:3]} -> "show me" placed 9 in r4c2 then rubbed it out (board back, undo depth {after["undo"]}, mistakes 0)')
    # the player repeats it
    await cell(page, 28); await key(page, 9); await wait_step(page, 3)

    # step 3 (place 3 in r6c7) with the keyboard: arrows from the centre, then 3
    await page.keyboard.press('ArrowDown')            # nothing selected -> r5c5
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
    check(await S(page, 'S.selected') == 51, 'T2 keyboard navigation did not reach r6c7')
    await page.keyboard.press('3'); await wait_step(page, 4)
    notes.append('T2 step 4 done with the keyboard (arrows + 3)')

    await do_step(page, steps[4]); await wait_step(page, 5)
    # step 5 (continue): a board tap is blocked with a nudge but does not count toward "show me"
    await cell(page, 49); await page.wait_for_timeout(40)
    s = await l0(page)
    check(s['k'] == 5 and s['wrong'] == 0 and 'Got it' in s['say'], f'T2 continue-step nudge: {s}')
    await coach_key(page); await wait_step(page, 6)

    # pencil on, note, erase it with Erase, pencil off
    await mod(page, 'Pencil'); await wait_step(page, 7)
    check(await S(page, 'S.pencil'), 'T2 pencil should be on')
    await cell(page, 49); await key(page, 6); await page.wait_for_timeout(80)
    check(await S(page, '!!(S.notes[49] & (1 << 5))'), 'T2 note 6 in r6c5 not written')
    await wait_step(page, 8)
    await page.screenshot(path=str(OUT / 't2-note.png'))
    await mod(page, 'Erase'); await wait_step(page, 9)
    check(await S(page, 'S.notes[49]') == 0, 'T2 note not erased')
    await mod(page, 'Pencil'); await wait_step(page, 10)
    check(not await S(page, 'S.pencil'), 'T2 pencil should be off')
    notes.append('T2 pencil: on, note 6 written in r6c5, rubbed out with Erase, pencil off')

    # the full-house chain
    for k in range(10, len(steps)):
        await wait_step(page, k); await do_step(page, steps[k])
    await page.wait_for_function('() => __debug.L0.state().done', timeout=6000)
    await page.wait_for_timeout(300)
    fin = await page.evaluate("() => ({ s: __debug.L0.state(), solved: __debug.S.solved, m: __debug.S.mistakes, toast: document.getElementById('toast').classList.contains('show'), lbl: document.querySelector('.coach .key.ck.show .lbl').textContent, full: Array.from(__debug.S.values).every((v, i) => v === __debug.S.sol[i]) })")
    outro = await page.evaluate('() => __debug.L0.scripts.w0.outro')
    check(fin['s']['done'] and fin['s']['say'] == outro and fin['solved'] and fin['full'] and fin['m'] == 0 and not fin['toast'] and fin['lbl'] == 'Again',
          f'T2 outro: {fin}')
    await page.screenshot(path=str(OUT / 't2-outro.png'))
    log = await page.evaluate('() => window.__sfxLog')
    check('blocked' in log and log.count('noteTick') >= 10 and 'complete' in log and 'error' not in log,
          f'T2 sounds: blocked {log.count("blocked")}, noteTick {log.count("noteTick")}, complete {log.count("complete")}, error {log.count("error")}')
    notes.append(f'T2 outro reached: board complete, mistakes 0, no toast, keycap "{fin["lbl"]}"; sfx: {log.count("blocked")} blocked, {log.count("noteTick")} step ticks, complete x{log.count("complete")}, error x0')
    # Again restarts the script
    await coach_key(page); await page.wait_for_timeout(200)
    s = await l0(page)
    check(s['k'] == 0 and not s['done'] and await S(page, 'S.values[28]') == 0, f'T2 Again: {s}')
    # the header Restart button restarts the script (not a bare board reset)
    await coach_key(page); await wait_step(page, 1); await cell(page, 28); await wait_step(page, 2)
    await tap(page, '#resetBtn'); await page.wait_for_timeout(150)
    s = await l0(page)
    check(s['k'] == 0 and s['active'] and await S(page, 'S.selected') == -1, f'T2 Restart: {s}')
    notes.append('T2 "Again" and the header Restart both restart the script at step 1')
    check(not errs, f'T2 errors: {errs}')
    await ctx.close()


async def t3_runner(browser):
    ctx, page, errs = await new_page(browser, '#camp=0')
    ids = await page.evaluate('() => __debug.camp.levels(0)')
    check(len(ids) == 14 and ids[0] == 'w0-l0', f'T3 levels: {ids}')
    pid = await page.locator('#pid').text_content()
    check('World 0' in pid and 'Level 0/13' in pid, f'T3 header label: {pid!r}')
    await play_l0(page)
    await coach_key(page)                      # outro Next
    await page.wait_for_timeout(150)
    labels = []
    for k in range(1, 14):
        st = await page.evaluate('() => __debug.camp.state()')
        check(st['k'] == k and st['id'] == ids[k], f'T3 runner at {k}: {st}')
        pid = await page.locator('#pid').text_content()
        labels.append(pid.split('·', 1)[1].strip() if '·' in pid else pid)
        mode = await S(page, 'S.mode')
        if mode == 'spot':
            step = await page.evaluate('() => __debug.entry(__debug.S.id).item.step')
            await cell(page, step['place']['cell']); await key(page, step['place']['digit'])
        else:
            sol = await S(page, 'Array.from(S.sol)'); vals = await S(page, 'Array.from(S.values)')
            for i in range(81):
                if not vals[i]: await cell(page, i); await key(page, sol[i])
        await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=8000)
        lbl = await page.locator('#againKey .lbl').text_content()
        check(lbl == ('Next' if k < 13 else 'Finish'), f'T3 level {k} keycap: {lbl!r}')
        check(await S(page, 'S.mistakes') == 0, f'T3 level {k}: mistakes')
        await tap(page, '#againKey'); await page.wait_for_timeout(150)
    await page.wait_for_timeout(300)
    end = await page.evaluate("() => ({ title: document.getElementById('toastTitle').textContent, show: document.getElementById('toast').classList.contains('show'), lbl: document.querySelector('#againKey .lbl').textContent, st: __debug.camp.state(), raw: localStorage.getItem('sudoku.camp.v1') })")
    store = end['st']['store']
    check(end['show'] and end['title'] == 'World 0 complete' and end['lbl'] == 'Done' and end['st']['worldToast'], f'T3 end of world: {end}')
    check(all(store['done'].get(i) for i in ids) and store['skip'].get('0') and json.loads(end['raw'])['done'] == store['done'], f'T3 store: {store}')
    await page.screenshot(path=str(OUT / 't3-world-toast.png'))
    notes.append(f'T3 runner: L0 -> {", ".join(labels[:2])} … {labels[-1]} -> toast "{end["title"]}"; {len(store["done"])} levels stored done, skip[0]={store["skip"].get("0")}')
    await tap(page, '#againKey'); await page.wait_for_timeout(150)
    check(not (await page.evaluate('() => __debug.camp.state()'))['active'], 'T3 Done should leave the runner')
    raw = end['raw']
    check(not errs, f'T3 errors: {errs}')
    await ctx.close()

    # Skip: after a clean Spot it 1 the Level 0 offers Skip
    ctx, page, errs = await new_page(browser, '#camp=0', storage={'sudoku.camp.v1': raw})
    s = await l0(page)
    check(s['skip'], f'T3 Skip key should show: {s}')
    await tap(page, '.coach .key.skip.show'); await page.wait_for_timeout(150)
    st = await page.evaluate('() => __debug.camp.state()')
    check(st['k'] == 1 and st['id'] == ids[1], f'T3 Skip -> {st}')
    # the DEV menu lists the runner, Level 0 and the 14 levels with done marks
    await tap(page, '#pid'); await page.wait_for_timeout(450)
    n_lv = await page.locator('#devSheet .chip[data-camp-level]').count()
    n_done = await page.locator('#devSheet .chip[data-camp-level].done').count()
    n_old = await page.locator('#devSheet .chip[data-id^="w"]').count()
    await page.screenshot(path=str(OUT / 't3-devmenu.png'))
    await page.locator('#devSheet .chip[data-l0="w0"]').click(); await page.wait_for_timeout(200)
    s = await l0(page); st = await page.evaluate('() => __debug.camp.state()')
    check(n_lv == 14 and n_done == 14 and n_old == 140 and s['active'] and s['k'] == 0 and not st['active'],
          f'T3 dev menu: level chips {n_lv} (done {n_done}), campaign chips {n_old}, L0 alone {s}, runner {st}')
    notes.append(f'T3 Skip keycap shown after a clean Spot it 1 and jumps to Spot it 1; DEV menu: runner row + {n_lv} level chips ({n_done} done), old 140 chips unchanged')
    check(not errs, f'T3 skip errors: {errs}')
    await ctx.close()


GEOM_JS = """() => {
  const r = s => document.querySelector(s).getBoundingClientRect();
  const b = r('#board'), c = r('#coach'), p = r('#pad'), h = r('.hdr');
  return { board: [b.left, b.top, b.width, b.height], coach: [c.top, c.bottom, c.height], pad: [p.top, p.bottom], hdr: h.bottom,
           vh: innerHeight, scroll: document.scrollingElement.scrollHeight };
}"""
FIT_JS = """() => {
  // every coach text, in the narrow (keycaps showing) layout, must fit without clipping
  const sc = __debug.L0.scripts.w0, say = document.querySelector('.coach .csay'), coach = document.getElementById('coach');
  const texts = [sc.outro, 'Watch.', 'Tap Got it when you\\u2019re ready.', 'Pencil is on, so that would be a note. Tap Pencil to write answers.',
                 'Use the outlined cell.', 'Turn Pencil on first, then press 6.'];
  for (const st of sc.steps) { texts.push(st.say); if (st.nudge) texts.push(st.nudge); }
  const keep = [say.textContent, say.className, coach.className], bad = [];
  coach.classList.add('keys');
  for (const t of texts) { say.textContent = t; if (say.scrollHeight > say.clientHeight + 1) bad.push(t); }
  [say.textContent, say.className, coach.className] = keep;
  return { n: texts.length, bad };
}"""

async def t4_layout(browser):
    shots = []
    for vp in [(390, 844), (375, 667)]:
        for run, scheme, motion in [('light', 'light', 'no-preference'), ('dark', 'dark', 'no-preference'), ('reduced', 'light', 'reduce')]:
            ctx, page, errs = await new_page(browser, '#l0=w0', vp, scheme, motion)
            tag = f'{vp[0]}x{vp[1]}-{run}'
            g0 = await page.evaluate(GEOM_JS)
            await page.wait_for_timeout(300)
            await page.screenshot(path=str(OUT / f'coach-{tag}-continue.png'))
            await coach_key(page); await wait_step(page, 1)
            await cell(page, 28); await wait_step(page, 2)
            await page.wait_for_timeout(400)                 # dim/outline transitions settle
            g = await page.evaluate(GEOM_JS)
            path = OUT / f'coach-{tag}-place.png'
            await page.screenshot(path=str(path)); shots.append(str(path))
            # note step (digit key outlined)
            steps = await page.evaluate('() => __debug.L0.scripts.w0.steps')
            for k in range(2, 7): await do_step(page, steps[k]); await wait_step(page, k + 1)
            await page.wait_for_timeout(400)
            g2 = await page.evaluate(GEOM_JS)
            await page.screenshot(path=str(OUT / f'coach-{tag}-note.png'))
            fit = await page.evaluate(FIT_JS)
            eps = 0.5
            ok = (g['board'] == g0['board'] == g2['board'] and g['board'][1] >= g['hdr'] - eps
                  and g['board'][1] + g['board'][3] <= g['coach'][0] + eps and g['coach'][1] <= g['pad'][0] + eps
                  and g['pad'][1] <= g['vh'] + eps and g['scroll'] <= g['vh'])
            check(ok, f'T4 {tag} geometry: continue {g0} / place {g} / note {g2}')
            check(not fit['bad'], f'T4 {tag}: coach texts clipped: {fit["bad"]}')
            check(not errs, f'T4 {tag} errors: {errs}')
            notes.append(f'T4 {tag}: board {g["board"][2]:.0f}px square, steady across steps; board/coach/pad gaps '
                         f'{g["coach"][0] - g["board"][1] - g["board"][3]:.0f}/{g["pad"][0] - g["coach"][1]:.0f}px, no scroll; {fit["n"]} coach texts fit')
            await ctx.close()
    return shots


async def main():
    assert (DIST / 'index.html').exists(), 'run node tools/build.mjs first'
    srv = subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            only = [a for a in sys.argv[1:] if a.startswith('t')]
            for name, fn in [('t1', t1_validator), ('t2', t2_play), ('t3', t3_runner), ('t4', t4_layout)]:
                if only and name not in only: continue
                t0 = time.time()
                await fn(browser)
                notes.append(f'{name.upper()} took {time.time() - t0:.1f}s')
            await browser.close()
    finally:
        srv.terminate()
    print('LEVEL 0')
    for n in notes: print('  ' + n)
    if failures:
        print(f'\nFAIL ({len(failures)})')
        for f in failures: print('  - ' + f)
        sys.exit(1)
    print('\nPASS')


if __name__ == '__main__':
    asyncio.run(main())
