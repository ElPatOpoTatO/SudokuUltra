#!/usr/bin/env python3
"""worlds-test.py — Worlds 1-4: Level 0 scripts and the world runners (Playwright).

    node tools/build.mjs && python3 tools/worlds-test.py [w1 w2 w3 w4 run layout]

  W1-W4  each world's Level 0 end to end through the real UI (pointer):
         one wrong action -> nudge, no mistake; three wrong -> "show me" in
         W1 (a placement) and W3 (an elimination), the board is put back and
         the player repeats it; number-first (W1), notes (W2), Pencil +
         eliminations (W3, W4), the fill step, the outro; Hint / Check hidden
         throughout.
  run    the World 1-4 runners through all 14 levels each: Level 0 played
         through the UI, Spot it by performing its stored step (placement, or
         erasing every note of an elimination with Pencil on), Use it / Master
         by typing the solution; "World N complete" with "Next world" (W1-W3)
         or "Done" (W4); levels stored done; hints inside each world limited to
         that world's techniques; the DEV menu rows; #camp=N.K and #l0=wN.
  layout every say / nudge / outro of every script fits the coach line at
         390x844 and 375x667 (light), plus screenshots in /tmp/worlds/.
Exit code 1 on any failure.
"""
import asyncio, importlib.util, json, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('l0t', ROOT / 'tools/level0-test.py')
L = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(L)
L.PORT = PORT = 8772
L.OUT = OUT = Path('/tmp/worlds'); OUT.mkdir(exist_ok=True)
tap, cell, key, mod, coach_key, l0, S, wait_step = L.tap, L.cell, L.key, L.mod, L.coach_key, L.l0, L.S, L.wait_step
failures, notes = [], []
def check(cond, msg):
    if not cond: failures.append(msg)
    return cond

async def new_page(browser, hash_='', vp=(390, 844), storage=None):
    return await L.new_page(browser, hash_, vp, 'light', 'no-preference', storage)

async def unload(page):
    d = await S(page, 'S.loaded')
    if d: await key(page, d)

async def place(page, c, d):
    """Number-first when that digit is loaded, cell-first otherwise."""
    loaded = await S(page, 'S.loaded')
    if loaded == d: await tap(page, f'.cell[data-i="{c}"]'); return
    if loaded: await key(page, loaded)
    await cell(page, c); await key(page, d)

async def do_step(page, st):
    e = st['expect']
    if 'continue' in e: await coach_key(page)
    elif 'tap' in e:
        for c in e['tap']:
            await cell(page, c)
    elif 'place' in e: await place(page, e['place']['cell'], e['place']['digit'])
    elif 'notes' in e:
        await cell(page, e['notes']['cell'])
        for d in e['notes']['digits']: await key(page, d)
    elif 'note' in e: await cell(page, e['note']['cell']); await key(page, e['note']['digit'])
    elif 'eliminate' in e:
        await unload(page)
        for c, d in e['eliminate']: await cell(page, c); await key(page, d)
    elif 'fill' in e:
        sol = await S(page, 'Array.from(S.sol)')
        for c in e['fill']: await place(page, c, sol[c])
    elif 'loadDigit' in e: await key(page, e['loadDigit'])
    elif 'press' in e: await mod(page, {'pencil': 'Pencil', 'erase': 'Erase', 'undo': 'Undo'}[e['press']])

HIDDEN_JS = """() => { const vis = s => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null && getComputedStyle(e).display !== 'none');
  return { hint: vis('.key.hk'), check: vis('.key.ckk'), bar: vis('.hintbar') }; }"""

async def play_script(page, w, wrong_at=None, show_at=None):
    """Play script w step by step. wrong_at = (k, coro) one wrong action; show_at = (k, coro) repeated 3x -> show me."""
    steps = await page.evaluate(f'() => __debug.L0.scripts.w{w}.steps')
    log = []
    for k, st in enumerate(steps):
        await wait_step(page, k, timeout=8000)
        if k == 1:
            h = await page.evaluate(HIDDEN_JS)
            check(not any(h.values()), f'W{w} Level 0: hint/check controls visible {h}')
        for spec, n in ((wrong_at, 1), (show_at, 3)):
            if not spec or spec[0] != k: continue
            before = await page.evaluate('() => ({ v: Array.from(__debug.S.values), n: Array.from(__debug.S.notes), m: __debug.S.mistakes, s: __debug.L0.state() })')
            for j in range(n):
                await spec[1](page); await page.wait_for_timeout(60)
                if j < n - 1 or n == 1:
                    s = await l0(page)
                    mid = await page.evaluate('() => ({ v: Array.from(__debug.S.values), n: Array.from(__debug.S.notes), m: __debug.S.mistakes })')
                    check(s['k'] == k and 'nudge' in s['sayClass'] and s['wrong'] == j + 1 and mid['m'] == 0 and mid['v'] == before['v'] and mid['n'] == before['n'],
                          f'W{w} step {k} wrong #{j + 1}: {s} mistakes={mid["m"]} board changed={mid["v"] != before["v"] or mid["n"] != before["n"]}')
                    log.append(f'step {k + 1} wrong -> "{s["say"]}"')
            if n == 3:
                s = await l0(page)
                check(s['demo'], f'W{w} step {k}: third wrong should start show me: {s}')
                seen_change = False
                for _ in range(200):
                    cur = await page.evaluate('() => ({ v: Array.from(__debug.S.values), n: Array.from(__debug.S.notes), s: __debug.L0.state() })')
                    if cur['v'] != before['v'] or cur['n'] != before['n']: seen_change = True
                    if seen_change and not cur['s']['demo']: break
                    await page.wait_for_timeout(50)
                after = await page.evaluate('() => ({ v: Array.from(__debug.S.values), n: Array.from(__debug.S.notes), m: __debug.S.mistakes, s: __debug.L0.state() })')
                check(seen_change and after['v'] == before['v'] and after['n'] == before['n'] and after['m'] == 0 and after['s']['shows'] == before['s']['shows'] + 1 and after['s']['k'] == k,
                      f'W{w} step {k} show me: played={seen_change} board back={after["v"] == before["v"] and after["n"] == before["n"]} {after["s"]}')
                await page.screenshot(path=str(OUT / f'w{w}-after-showme.png'))
                log.append(f'step {k + 1}: 3 wrong -> show me played the move and put the board back')
        await do_step(page, st)
    await page.wait_for_function('() => __debug.L0.state().done', timeout=10000)
    return log

async def t_world(browser, w, wrong_at=None, show_at=None, extra=None):
    ctx, page, errs = await new_page(browser, f'#l0=w{w}')
    st0 = await l0(page)
    check(st0['active'] and st0['id'] == f'w{w}-l0' and st0['k'] == 0, f'W{w} start: {st0}')
    log = await play_script(page, w, wrong_at, show_at)
    await page.wait_for_timeout(300)
    fin = await page.evaluate(f"() => ({{ s: __debug.L0.state(), m: __debug.S.mistakes, full: Array.from(__debug.S.values).every((v, i) => v === __debug.S.sol[i]), outro: __debug.L0.scripts.w{w}.outro, toast: document.getElementById('toast').classList.contains('show') }})")
    check(fin['s']['done'] and fin['s']['say'] == fin['outro'] and fin['full'] and fin['m'] == 0 and not fin['toast'], f'W{w} outro: {fin}')
    await page.screenshot(path=str(OUT / f'w{w}-outro.png'))
    if extra: await extra(page)
    log_sfx = await page.evaluate('() => window.__sfxLog')
    check('error' not in log_sfx, f'W{w}: error sound played')
    check(not errs, f'W{w} errors: {errs}')
    notes.append(f'W{w} Level 0: {fin["s"]["n"]} steps played through the UI, board complete, mistakes 0, nudges {fin["s"]["nudges"]}, show me x{fin["s"]["shows"]}; ' + '; '.join(log))
    await ctx.close()

# --- wrong actions -----------------------------------------------------------
async def w1_wrong(page):   # step 5 (place 5, 5 loaded): tap a box cell a 5 already sees
    await tap(page, '.cell[data-i="49"]')
async def w1_wrong2(page):
    await tap(page, '.cell[data-i="41"]')
async def w2_wrong(page):   # step 5 (notes of r5c2): a 1, which its column already has
    await cell(page, 37); await key(page, 1)
async def w3_wrong(page):   # step 4 (erase the 3 in r3c1): rub out its 6 instead
    await cell(page, 18); await key(page, 6)
async def w4_wrong(page):   # step 4 (erase the 2s): press 7 in r2c3 (rubs out a 7, not a 2)
    await cell(page, 11); await key(page, 7)

class Seq:
    def __init__(self, *fs): self.fs, self.i = fs, 0
    async def __call__(self, page):
        f = self.fs[self.i % len(self.fs)]; self.i += 1; await f(page)

async def w2_extra(page):
    st = await page.evaluate("() => JSON.parse(localStorage.getItem('sudoku.camp.v1') || '{}')")
    check((st.get('unlock') or {}).get('fillNotes') is True, f'W2: unlock.fillNotes not set after Level 0: {st}')
    notes.append('W2: finishing Level 0 sets unlock.fillNotes in sudoku.camp.v1')

# --- runners -----------------------------------------------------------------
async def spot(page):
    step = await page.evaluate('() => __debug.entry(__debug.S.id).item.step')
    if step.get('place'):
        await cell(page, step['place']['cell']); await key(page, step['place']['digit'])
    else:
        if not await S(page, 'S.pencil'): await mod(page, 'Pencil')
        for c, d in step['eliminate']:
            if await S(page, f'!!(S.notes[{c}] & (1 << {d - 1}))'):
                await cell(page, c); await key(page, d)
    return step['tech']

async def solve(page):
    if await S(page, 'S.pencil'): await mod(page, 'Pencil')
    sol = await S(page, 'Array.from(S.sol)'); vals = await S(page, 'Array.from(S.values)')
    for i in range(81):
        if not vals[i]: await cell(page, i); await key(page, sol[i])

HINT_TECHS_JS = """() => { const h = __debug.hintlogic, S = __debug.S, un = h.unlockedFor(S.id);
  const r = h.findHint({ values: S.values, notes: S.notes, given: S.given, sol: S.sol, mode: S.mode, spot: S.spot, solved: S.solved, unlocked: un });
  return { world: S.world, unlocked: un, allow: __debug.ALLOW[S.world], tech: r.step ? r.step.tech : r.kind }; }"""

async def t_runner(browser, w, storage=None):
    ctx, page, errs = await new_page(browser, f'#camp={w}', storage=storage)
    ids = await page.evaluate(f'() => __debug.camp.levels({w})')
    check(len(ids) == 14 and ids[0] == f'w{w}-l0', f'R{w} levels: {ids}')
    pid = await page.locator('#pid').text_content()
    check(f'World {w}' in pid and 'Level 0/13' in pid, f'R{w} header: {pid!r}')
    await play_script(page, w)
    await coach_key(page); await page.wait_for_timeout(150)
    techs, hint_log = [], []
    for k in range(1, 14):
        st = await page.evaluate('() => __debug.camp.state()')
        check(st['k'] == k and st['id'] == ids[k], f'R{w} at {k}: {st}')
        if k in (1, 7):   # hints in this world: only this world's techniques
            hw = await page.evaluate(HINT_TECHS_JS)
            check(hw['world'] == w and hw['unlocked'] == hw['allow'] and (hw['tech'] in hw['allow'] or hw['tech'] in ('none', 'missing')),
                  f'R{w} level {k}: hints not limited to world {w}: {hw}')
            hint_log.append(f'{k}:{hw["tech"]}')
        mode = await S(page, 'S.mode')
        if mode == 'spot': techs.append(await spot(page))
        else: await solve(page)
        await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=15000)
        check(await S(page, 'S.mistakes') == 0, f'R{w} level {k}: mistakes')
        lbl = await page.locator('#againKey .lbl').text_content()
        check(lbl == ('Next' if k < 13 else 'Finish'), f'R{w} level {k} keycap {lbl!r}')
        await tap(page, '#againKey'); await page.wait_for_timeout(150)
    await page.wait_for_timeout(300)
    end = await page.evaluate("() => ({ title: document.getElementById('toastTitle').textContent, show: document.getElementById('toast').classList.contains('show'), lbl: document.querySelector('#againKey .lbl').textContent, st: __debug.camp.state() })")
    store = end['st']['store']
    want = 'Next world' if w < 4 else 'Done'
    check(end['show'] and end['title'] == f'World {w} complete' and end['lbl'] == want, f'R{w} end: {end}')
    check(all(store['done'].get(i) for i in ids) and store['skip'].get(str(w)), f'R{w} store: done {sum(1 for i in ids if store["done"].get(i))}/14 skip {store["skip"]}')
    await page.screenshot(path=str(OUT / f'r{w}-world-toast.png'))
    await tap(page, '#againKey'); await page.wait_for_timeout(250)
    after = await page.evaluate('() => ({ st: __debug.camp.state(), l0: __debug.L0.state() })')
    if w < 4:
        check(after['st']['active'] and after['st']['world'] == w + 1 and after['st']['k'] == 0 and after['l0']['id'] == f'w{w + 1}-l0', f'R{w} Next world -> {after}')
    else:
        check(not after['st']['active'], f'R4 Done should leave the runner: {after["st"]}')
    raw = await page.evaluate("() => localStorage.getItem('sudoku.camp.v1')")
    check(not errs, f'R{w} errors: {errs}')
    notes.append(f'R{w}: Level 0 + 13 levels (Spot it techs: {", ".join(sorted(set(techs)))}) -> "{end["title"]}" [{end["lbl"]}] -> ' +
                 (f'World {w + 1} Level 0' if w < 4 else 'runner closed') + f'; {sum(1 for i in ids if store["done"].get(i))}/14 stored done, skip[{w}] set; hint techniques limited to ALLOW[{w}] (first hint at levels {", ".join(hint_log)})')
    await ctx.close()
    return raw

async def t_entry(browser, raw):
    # Skip keycap after a clean Spot it 1; #camp=N.K; #l0=wN; DEV menu rows
    ctx, page, errs = await new_page(browser, '#camp=3', storage={'sudoku.camp.v1': raw})
    s = await l0(page)
    check(s['skip'] and s['id'] == 'w3-l0', f'Entry: Skip on W3 Level 0: {s}')
    await tap(page, '.coach .key.skip.show'); await page.wait_for_timeout(150)
    st = await page.evaluate('() => __debug.camp.state()')
    check(st['world'] == 3 and st['k'] == 1, f'Entry: Skip -> {st}')
    await tap(page, '#pid'); await page.wait_for_timeout(450)
    n_camp = await page.locator('#devSheet .chip[data-camp]').count()
    n_l0 = await page.locator('#devSheet .chip[data-l0]').count()
    n_lv = await page.locator('#devSheet .chip[data-camp-level]').count()
    n_done = await page.locator('#devSheet .chip[data-camp-level].done').count()
    labels = await page.locator('#devSheet .chip[data-camp]').all_text_contents()
    await page.screenshot(path=str(OUT / 'devmenu.png'))
    check(n_camp == 5 and n_l0 == 5 and n_lv == 70 and labels == [f'Campaign: World {n}' for n in range(5)], f'Entry: DEV rows camp {n_camp} {labels} l0 {n_l0} levels {n_lv}')
    await page.locator('#devSheet .chip[data-l0="w2"]').click(); await page.wait_for_timeout(200)
    s = await l0(page); st = await page.evaluate('() => __debug.camp.state()')
    check(s['id'] == 'w2-l0' and s['k'] == 0 and not st['active'], f'Entry: DEV W2 Level 0 alone: {s} {st}')
    await ctx.close()
    for h, want in [('#camp=2.7', (2, 7)), ('#camp=4.13', (4, 13)), ('#camp=1', (1, 0))]:
        ctx, page, errs2 = await new_page(browser, h)
        st = await page.evaluate('() => __debug.camp.state()')
        check(st['active'] and (st['world'], st['k']) == want, f'Entry {h}: {st}')
        errs += errs2
        await ctx.close()
    for w in range(1, 5):
        ctx, page, errs2 = await new_page(browser, f'#l0=w{w}')
        s = await l0(page)
        check(s['active'] and s['id'] == f'w{w}-l0', f'Entry #l0=w{w}: {s}')
        errs += errs2
        await ctx.close()
    check(not errs, f'Entry errors: {errs}')
    notes.append(f'Entry points: Skip on W3 Level 0 after a clean Spot it 1; DEV menu {n_camp} "Campaign: World N" rows, {n_l0} Level 0 chips, {n_lv} level chips ({n_done} done); #camp=2.7, #camp=4.13, #camp=1, #l0=w1..w4 ok')

FIT_JS = """() => {
  const say = document.querySelector('.coach .csay'), coach = document.getElementById('coach');
  const texts = ['Watch.', 'Tap Got it when you\\u2019re ready.', 'Pencil is on, so that would be a note. Tap Pencil to write answers.',
    'Use the outlined cell.', 'Use one of the outlined cells.', 'Turn Pencil on first, then press 6.', 'Turn Pencil on first, then write the notes.',
    'Turn Pencil on first, then press 9 to rub it out.', 'This column already has a 9.', 'Not that cell. Look again.', 'Select the outlined cell first.',
    'Press 5 first, before any cell.', 'Rub out the outlined note.', 'Write the numbers this cell can still be.'];
  for (const sc of Object.values(__debug.L0.scripts)) { texts.push(sc.outro); for (const st of sc.steps) { texts.push(st.say); if (st.nudge) texts.push(st.nudge); } }
  const keep = [say.textContent, say.className, coach.className], bad = [];
  for (const withKeys of [true, false]) {
    coach.classList.toggle('keys', withKeys);
    for (const t of texts) { say.textContent = t; if (say.scrollHeight > say.clientHeight + 1 || say.scrollWidth > say.clientWidth + 1) bad.push((withKeys ? '[keys] ' : '') + t); }
  }
  [say.textContent, say.className, coach.className] = keep;
  return { n: texts.length, bad };
}"""

async def t_layout(browser):
    for vp in [(390, 844), (375, 667)]:
        ctx, page, errs = await new_page(browser, '#l0=w3', vp)
        fit = await page.evaluate(FIT_JS)
        check(not fit['bad'], f'Layout {vp}: coach texts that do not fit: {fit["bad"]}')
        geo = await page.evaluate(L.GEOM_JS)
        check(geo['scroll'] <= geo['vh'], f'Layout {vp}: page scrolls {geo}')
        steps = await page.evaluate('() => __debug.L0.scripts.w3.steps')
        for k in range(0, 4):
            await wait_step(page, k); await do_step(page, steps[k])
        await wait_step(page, 4)
        await page.screenshot(path=str(OUT / f'w3-{vp[0]}x{vp[1]}-after-pointing.png'))
        await ctx.close()
        for w in (1, 2, 4):
            ctx, page, errs2 = await new_page(browser, f'#l0=w{w}', vp)
            steps = await page.evaluate(f'() => __debug.L0.scripts.w{w}.steps')
            for k in range(0, 4):
                await wait_step(page, k); await do_step(page, steps[k])
            await wait_step(page, 4); await page.wait_for_timeout(350)
            await page.screenshot(path=str(OUT / f'w{w}-{vp[0]}x{vp[1]}-step5.png'))
            errs += errs2
            await ctx.close()
        check(not errs, f'Layout {vp} errors: {errs}')
        notes.append(f'Layout {vp[0]}x{vp[1]}: {fit["n"]} coach texts (all 5 scripts + engine nudges) fit with and without the keycap column; no scroll')


async def main():
    assert (ROOT / 'dist/index.html').exists(), 'run node tools/build.mjs first'
    srv = subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(ROOT / 'dist'), '--port', str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    only = [a for a in sys.argv[1:]]
    want = lambda n: not only or n in only
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=L.CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            t0 = time.time()
            if want('w1'): await t_world(browser, 1, show_at=(4, Seq(w1_wrong, w1_wrong2)))
            if want('w2'): await t_world(browser, 2, wrong_at=(4, w2_wrong), extra=w2_extra)
            if want('w3'): await t_world(browser, 3, show_at=(3, w3_wrong))
            if want('w4'): await t_world(browser, 4, wrong_at=(3, w4_wrong))
            if any(want(n) for n in ('w1', 'w2', 'w3', 'w4')): notes.append(f'Level 0 plays took {time.time() - t0:.1f}s')
            if want('run'):
                t0 = time.time(); raw = None
                for w in range(1, 5):
                    r = await t_runner(browser, w)
                    if w == 3: raw = r
                notes.append(f'Runners took {time.time() - t0:.1f}s')
                await t_entry(browser, raw)
            if want('layout'): await t_layout(browser)
            await browser.close()
    finally:
        srv.terminate()
    print('WORLDS 1-4')
    for n in notes: print('  ' + n)
    if failures:
        print(f'\nFAIL ({len(failures)})')
        for f in failures: print('  - ' + f)
        sys.exit(1)
    print('\nPASS')

if __name__ == '__main__':
    asyncio.run(main())
