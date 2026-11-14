#!/usr/bin/env python3
"""progress-test.py — step 7 PROGRESSION (Playwright).

    node tools/build.mjs && python3 tools/progress-test.py [p1 p2 p3 p4 p5 p6]

  P1 charges   rule table (chargesFor); then through the real UI: clean solve -> 3,
               one paid hint -> 2, 2 mistakes -> 2, both -> 1, a dead-end Rewind
               counts 1 mistake (still 3), best result kept (a worse replay keeps
               3, "Best kept"), Level 0 -> 0 charges but done; the sudoku:solved
               event detail (id, mode, world, mistakes, paidHints, charges, clean)
  P2 gate      Master locked at 23 charges, unlocked at 24 (world list + runner
               Next goes to the list while locked); clearing Master masters the
               world, opens the next, shows the reward on the end-of-world toast,
               badges the gear, plays the keyboard build; Settings: the new preset
               is selectable, locked ones dimmed with "Master World N" and refuse
               taps; DEV unlock-all works and switching it off falls back to defaults
  P3 bars      total / world / gate meters equal the computed totals; expertise
               inner level rises on clean solves (incl. a synthetic Free Mode
               sudoku:solved), never drops; tier -> Solver once World 3 is mastered
  P4 fill      the Fill key: hidden before unlock.fillNotes, works after (notes ==
               computed candidates, one Undo restores), hidden in Level 0 / Spot it
  P5 home      Home on launch (no Continue on a fresh profile); Campaign / back /
               nav events (home, campaign, settings, free); Continue resumes the
               runner; profile + Continue survive a reload; migration from an old
               'sudoku.camp.v1'
  P6 shots     390x844 and 375x667, light / dark / reduced motion: Home, keyboard
               map (empty + 3 worlds built), world list, results card mid-charge,
               Settings with locked tiles, unlock reward; no horizontal overflow,
               no overlaps between the main blocks. Screenshots in /tmp/progress/.
Exit code 1 on any failure. P7_PORT overrides the port (default 8797).
"""
import asyncio, json, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/progress'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = int(os.environ.get('P7_PORT', 8797))

failures, notes = [], []
def check(cond, msg):
    if not cond: failures.append(msg)
    return cond

INIT_EVENTS = """window.__ev = { solved: [], nav: [] };
document.addEventListener('sudoku:solved', e => window.__ev.solved.push(e.detail));
document.addEventListener('sudoku:nav', e => window.__ev.nav.push(e.detail));"""

async def new_page(browser, hash_='', vp=(390, 844), scheme='light', motion='no-preference', storage=None, dsf=1):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, device_scale_factor=dsf, color_scheme=scheme, reduced_motion=motion)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    if storage:   # once per tab: reloads keep what the app saved
        await page.add_init_script(f"try {{ if (!sessionStorage.getItem('p7')) {{ for (const [k, v] of Object.entries({json.dumps(storage)})) localStorage.setItem(k, v); sessionStorage.setItem('p7', '1'); }} }} catch (e) {{}}")
    await page.add_init_script(INIT_EVENTS)
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{hash_}')
    await page.wait_for_function('() => window.__debug && window.__debug.prog')
    return ctx, page, errs

async def tap(page, sel, hold=0):
    b = await page.locator(sel).first.bounding_box()
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down()
    if hold: await page.wait_for_timeout(hold)
    await page.mouse.up()
async def ev(page, js, arg=None): return await page.evaluate(js, arg) if arg is not None else await page.evaluate(js)
async def cell(page, i):
    if await ev(page, '() => __debug.S.selected') != i: await tap(page, f'.cell[data-i="{i}"]')
async def key(page, d): await tap(page, f'.key.digit[data-d="{d}"]')
async def mod(page, label): await tap(page, f'.pad .key.mod[aria-label="{label}"]')
async def prof(page): return await ev(page, '() => __debug.prog.getProfile()')
async def screen(page): return await ev(page, '() => __debug.prog.screen()')

def lv(w, k):
    """level id helper is in the page; this is only for messages"""
    return f'{w}.{k}'

async def solve_ui(page, upto=None):
    """Type the solution into every empty cell through the pad (cell-first)."""
    sol = await ev(page, '() => Array.from(__debug.S.sol)')
    vals = await ev(page, '() => Array.from(__debug.S.values)')
    empt = [i for i in range(81) if not vals[i]]
    if upto is not None: empt = empt[:upto]
    for i in empt:
        await cell(page, i); await key(page, sol[i])

async def clash_once(page):
    """A digit that visibly clashes (a mistake), then erase it."""
    i, d = await ev(page, """() => { const S = __debug.S, P = __debug.solver.peers;
      for (let i = 0; i < 81; i++) if (!S.values[i]) for (const j of P[i]) if (S.values[j] && S.values[j] !== S.sol[i]) return [i, S.values[j]];
      return null; }""")
    await cell(page, i); await key(page, d)
    await page.wait_for_timeout(120)
    await cell(page, i); await mod(page, 'Erase')
    await page.wait_for_timeout(60)

async def paid_hint(page):
    for _ in range(3): await ev(page, '() => __debug.hintTap()')
    return await ev(page, '() => __debug.S.paidHints')

async def wait_results(page, timeout=9000):
    await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=timeout)
    await page.wait_for_function("() => ['done', 'idle'].includes(__debug.prog.RC.phase)", timeout=timeout)

async def results_view(page):
    return await ev(page, """() => ({ cells: [...document.querySelectorAll('#toast .rc .cc')].map(c => c.classList.contains('on')),
      labels: [...document.querySelectorAll('#toast .rc .rc-l')].map(l => l.textContent),
      note: (document.querySelector('#toast .rc-note') || {}).textContent || '',
      meter: (() => { const m = document.querySelector('#toast .rc .cm'); return m ? { e: +m.dataset.earned, a: +m.dataset.available } : null; })(),
      r: __debug.prog.lastResult(), d: __debug.prog.lastSolved(), title: document.getElementById('toastTitle').textContent })""")

def levels_profile(levels, **extra):
    p = {'v': 1, 'levels': levels, 'mastered': [], 'expertise': {'tier': 1, 'inner': 1, 'points': 0},
         'unlocks': {'fillNotes': False, 'items': []}, 'flags': {}}
    for k, v in extra.items():
        if k in ('flags', 'unlocks', 'expertise'): p[k].update(v)
        else: p[k] = v
    return json.dumps(p)

async def ids_of(page, w): return await ev(page, f'() => __debug.prog.levelIds({w})')


# ---------------------------------------------------------------------------
async def p1_charges(browser):
    ctx, page, errs = await new_page(browser, '#p=w0-use-01')
    table = await ev(page, """() => { const f = __debug.prog.chargesFor; return {
      clean: f({ kind: 'useIt', paidHints: 0, mistakes: 0 }), hint: f({ kind: 'useIt', paidHints: 1, mistakes: 0 }),
      mist2: f({ kind: 'useIt', paidHints: 0, mistakes: 2 }), both: f({ kind: 'useIt', paidHints: 2, mistakes: 3 }),
      mist1: f({ kind: 'useIt', paidHints: 0, mistakes: 1 }), l0: f({ kind: 'level0', paidHints: 0, mistakes: 0 }) }; }""")
    check(table == {'clean': 3, 'hint': 2, 'mist2': 2, 'both': 1, 'mist1': 3, 'l0': 0}, f'P1 rule table: {table}')
    # clean solve
    await solve_ui(page); await wait_results(page)
    v = await results_view(page)
    d = v['d']
    check(v['cells'] == [True, True, True] and v['r']['best'] == 3 and v['meter'] == {'e': 3, 'a': 39}, f'P1 clean -> 3: {v}')
    check(d['id'] == 'w0-use-01' and d['mode'] == 'campaign' and d['world'] == 0 and d['charges'] == 3 and d['clean'] is True and d['mistakes'] == 0 and d['paidHints'] == 0 and isinstance(d['ms'], int),
          f'P1 sudoku:solved detail: {d}')
    evs = await ev(page, '() => window.__ev.solved.length')
    check(evs == 1, f'P1 one sudoku:solved per solve, got {evs}')
    # replay worse: a paid hint + 2 mistakes -> 1 charge, best 3 kept
    await tap(page, '#againKey'); await page.wait_for_timeout(250)
    await paid_hint(page); await clash_once(page); await clash_once(page)
    await solve_ui(page); await wait_results(page)
    v2 = await results_view(page)
    check(v2['d']['charges'] == 1 and v2['r']['best'] == 3 and v2['r']['delta'] == 0 and 'Best kept: 3' in v2['note'] and v2['cells'] == [True, False, False],
          f'P1 best kept: {v2}')
    p = await prof(page)
    check(p['levels'].get('w0-use-01') == 3, f'P1 profile keeps the best: {p["levels"]}')
    notes.append(f'P1 clean solve -> 3 charges (detail {json.dumps({k: d[k] for k in ("id", "mode", "world", "charges", "clean")})}); worse replay (hint + 2 mistakes) -> 1, best 3 kept: "{v2["note"]}"')
    await ctx.close()

    # one paid hint -> 2; two mistakes -> 2; both -> 1
    for pid, kind, want in [('w0-use-02', 'hint', 2), ('w0-use-03', 'mist2', 2), ('w0-use-04', 'both', 1)]:
        ctx, page, errs2 = await new_page(browser, f'#p={pid}')
        if kind in ('hint', 'both'): await paid_hint(page)
        if kind in ('mist2', 'both'): await clash_once(page); await clash_once(page)
        await solve_ui(page); await wait_results(page)
        v = await results_view(page)
        check(v['d']['charges'] == want and v['r']['best'] == want and sum(v['cells']) == want, f'P1 {kind} -> {want}: {v}')
        if kind == 'both': await page.screenshot(path=str(OUT / 'p1-results-1-charge.png'))
        check(not errs2, f'P1 {pid} errors: {errs2}')
        notes.append(f'P1 {kind}: mistakes {v["d"]["mistakes"]}, paidHints {v["d"]["paidHints"]} -> {want} charges, labels {v["labels"]}')
        await ctx.close()

    # dead-end Rewind counts 1 mistake: still 3 charges; one more clash -> 2
    for extra, want in [(0, 3), (1, 2)]:
        ctx, page, errs2 = await new_page(browser, '#p=w2-use-03')
        plan = await ev(page, """() => { const D = window.__debug, v = Array.from(D.S.values), sol = D.S.sol, plan = [];
          const P = D.solver.peers, clash = (i, d) => P[i].some(j => v[j] === d);
          let placed = 0;
          for (let i = 0; i < 81 && placed < 2; i++) if (!v[i]) { v[i] = sol[i]; plan.push([i, sol[i]]); placed++; }
          for (let guard = 0; guard < 81 && !D.solver.isDeadEnd(v); guard++) {
            let done = false;
            for (let i = 0; i < 81 && !done; i++) if (!v[i]) for (let d = 1; d <= 9; d++) if (d !== sol[i] && !clash(i, d)) { v[i] = d; plan.push([i, d]); done = true; break; }
            if (!done) break;
          }
          return { plan, dead: D.solver.isDeadEnd(v) }; }""")
        for i, d in plan['plan']: await cell(page, i); await key(page, d)
        await page.wait_for_timeout(300)
        await tap(page, '#dead .key'); await page.wait_for_timeout(600)
        m = await ev(page, '() => __debug.S.mistakes')
        if extra: await clash_once(page)
        await solve_ui(page); await wait_results(page)
        v = await results_view(page)
        check(plan['dead'] and m == 1 and v['d']['mistakes'] == 1 + extra and v['d']['charges'] == want, f'P1 dead-end rewind (+{extra} clash) -> {want}: mistakes after rewind {m}, {v["d"]}')
        notes.append(f'P1 dead end + Rewind: mistakes {m} (counts 1){" + 1 clash" if extra else ""} -> {v["d"]["charges"]} charges')
        await ctx.close()

    # Level 0: no charges, done
    ctx, page, errs2 = await new_page(browser, '#l0=w0')
    steps = await ev(page, '() => __debug.L0.scripts.w0.steps')
    import importlib.util
    spec = importlib.util.spec_from_file_location('l0t', ROOT / 'tools/level0-test.py')
    L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
    for k, st in enumerate(steps):
        await L.wait_step(page, k); await L.do_step(page, st)
    await page.wait_for_function('() => __debug.L0.state().done', timeout=8000)
    p = await prof(page)
    sv = await ev(page, '() => window.__ev.solved')
    check(p['levels'].get('w0-l0') == 0 and (not sv or all(x['charges'] == 0 for x in sv)), f'P1 Level 0: levels {p["levels"]}, solved events {sv}')
    check(not errs2, f'P1 Level 0 errors: {errs2}')
    notes.append(f'P1 Level 0 played through: profile levels["w0-l0"] = {p["levels"].get("w0-l0")} (done, 0 charges); solved events {[x["charges"] for x in sv]}')
    await ctx.close()


# ---------------------------------------------------------------------------
async def p2_gate(browser):
    ctx, page, errs = await new_page(browser)
    ids = await ids_of(page, 0)
    await ctx.close()
    # 20 charges, then Use it 6 (k=12) clean -> 23: Next goes to the world list (Master locked)
    lv20 = {ids[0]: 0}
    left = 20
    for id_ in ids[1:12]:
        c = min(3, left); left -= c
        if c: lv20[id_] = c
    ctx, page, errs = await new_page(browser, '#camp=0.12', storage={'sudoku.profile.v1': levels_profile(lv20)})
    await solve_ui(page); await wait_results(page)
    st = await ev(page, '() => __debug.prog.worldStats(0)')
    check(st['gate'] == 23 and not st['masterOpen'], f'P2 gate at 23: {st["gate"]} open {st["masterOpen"]}')
    await tap(page, '#againKey'); await page.wait_for_timeout(500)
    v = await ev(page, "() => ({ scr: __debug.prog.screen(), lock: !!document.querySelector('#campWorld.show .mlock'), master: !!document.querySelector('#campWorld .key[data-level=\"0.13\"]'), camp: __debug.camp.state().active, txt: (document.querySelector('#campWorld .mlock') || {}).textContent })")
    check(v['scr'] == 'world' and v['lock'] and not v['master'] and not v['camp'], f'P2 Next at 23 should open the world list with Master locked: {v}')
    locktxt = v['txt']
    await page.screenshot(path=str(OUT / 'p2-gate-23.png'))
    await tap(page, '#campWorld .mlock'); await page.wait_for_timeout(200)
    check(await screen(page) == 'world', 'P2 tapping the locked Master must not start it')
    # one more charge -> 24 -> unlocked
    await ev(page, "(ids) => { const p = __debug.prog.getProfile(); const id = ids.slice(1, 13).find(i => (p.levels[i] || 0) < 3); p.levels[id] = (p.levels[id] || 0) + 1; __debug.prog.setProfile(p); }", ids)
    st = await ev(page, '() => __debug.prog.worldStats(0)')
    v = await ev(page, "() => ({ master: !!document.querySelector('#campWorld .key[data-level=\"0.13\"]'), lock: !!document.querySelector('#campWorld .mlock') })")
    check(st['gate'] >= 24 and st['masterOpen'] and v['master'] and not v['lock'], f'P2 gate at {st["gate"]}: {st["masterOpen"]} {v}')
    notes.append(f'P2 gate: 23 charges -> Next opens the world list, Master locked ("{locktxt}"), tap refused; 24 -> Master tile live')
    # play Master from its tile; clear it
    await tap(page, '#campWorld .key[data-level="0.13"]'); await page.wait_for_timeout(400)
    cs = await ev(page, '() => __debug.camp.state()')
    check(cs['active'] and cs['k'] == 13 and await screen(page) is None, f'P2 Master tile starts the runner at Master: {cs}')
    await solve_ui(page); await wait_results(page)
    p = await prof(page)
    check(0 in p['mastered'] and 'preset:ink' in p['unlocks']['items'] and p['flags']['badge'] and 0 in p['flags']['pendingBuild'], f'P2 mastered: {p}')
    check(await ev(page, '() => __debug.prog.worldStats(1).open'), 'P2 World 1 should open once World 0 is mastered')
    badge = await ev(page, "() => document.getElementById('setBtn').classList.contains('badge')")
    check(badge, 'P2 gear badge missing after an unlock')
    await tap(page, '#againKey')            # Finish -> end-of-world toast with the reward
    await page.wait_for_timeout(1500)
    w = await ev(page, """() => ({ title: document.getElementById('toastTitle').textContent, lbl: document.querySelector('#againKey .lbl').textContent,
      rw: !!document.querySelector('#toast .rw'), items: (document.querySelector('#toast .rw') || {}).dataset ? document.querySelector('#toast .rw').dataset.items : '',
      text: (document.querySelector('#toast .rw-t') || {}).textContent || '', kb: !!document.querySelector('#toast .tk2') })""")
    check(w['title'] == 'World 0 complete' and w['lbl'] == 'Next world' and w['rw'] and w['items'] == 'preset:ink' and 'Ink' in w['text'] and w['kb'], f'P2 reward toast: {w}')
    await page.screenshot(path=str(OUT / 'p2-reward.png'))
    # keyboard build
    await tap(page, '#toast .tk2'); await page.wait_for_timeout(1400)
    m = await ev(page, "() => ({ scr: __debug.prog.screen(), last: __debug.prog.MAP.lastBuild, built: __debug.prog.MAP.built, s0: document.querySelector('#campMap .key.wk[data-world=\"0\"]').className, s1: document.querySelector('#campMap .key.wk[data-world=\"1\"]').className })")
    check(m['scr'] == 'campaign' and m['last'] == [0] and m['built'] == [0] and 'built' in m['s0'] and 'open' in m['s1'], f'P2 keyboard build: {m}')
    again = await ev(page, '() => { __debug.prog.openMap(0); return __debug.prog.MAP.lastBuild; }')
    check(again == [], f'P2 the build plays once: {again}')
    await page.screenshot(path=str(OUT / 'p2-keyboard-built.png'))
    notes.append(f'P2 Master cleared -> World 0 mastered, World 1 open, reward toast "{w["text"]}", gear badge, keyboard build {m["last"]} -> sockets {m["built"]} built')
    # Settings: Ink selectable, Cherry locked with its requirement, taps refused
    await ev(page, "() => __debug.prog.nav('settings')"); await page.wait_for_timeout(500)
    s = await ev(page, """() => { const q = s => document.querySelector(s); return {
      ink: q('#setSheet .set-swatch[data-preset="ink"]').classList.contains('lockd'), inkNew: !!q('#setSheet .set-swatch[data-preset="ink"] .new-tag'),
      cherry: q('#setSheet .set-tile[data-style="cherry"]').classList.contains('lockd'), cherryReq: ((q('#setSheet .set-tile[data-style="cherry"] .lock-req') || {}).textContent || '').replace(/\u00a0/g, ' '),
      checker: q('#setSheet .set-seg button[data-layout="checker"]').classList.contains('lockd'), mint: ((q('#setSheet .set-swatch[data-preset="mint"] .lock-req') || {}).textContent || '').replace(/\u00a0/g, ' '),
      badge: q('#setBtn').classList.contains('badge'), op: getComputedStyle(q('#setSheet .set-tile[data-style="cherry"] .set-mk .key')).opacity }; }""")
    check(not s['ink'] and s['inkNew'] and s['cherry'] and s['cherryReq'] == 'Master World 1' and s['checker'] and s['mint'] == 'Master World 2' and not s['badge'] and float(s['op']) < 0.6,
          f'P2 Settings locks: {s}')
    await page.screenshot(path=str(OUT / 'p2-settings-locks.png'))
    await tap(page, '#setSheet .set-tile[data-style="cherry"]'); await page.wait_for_timeout(200)
    await tap(page, '#setSheet .set-swatch[data-preset="ink"]'); await page.wait_for_timeout(300)
    k = await ev(page, '() => __keys.getSettings()')
    check(k['style'] == 'sa' and k['preset'] == 'ink', f'P2 locked Cherry refused, Ink applied: {k}')
    # DEV unlock all via the dev menu chip
    await ev(page, "() => { document.querySelector('#setSheet .set-x').click(); }"); await page.wait_for_timeout(300)
    await ev(page, '() => __debug.openDev()'); await page.wait_for_timeout(200)
    await tap(page, '#devSheet .chip[data-dev="unlockall"]'); await page.wait_for_timeout(100)
    await ev(page, '() => __debug.closeDev()')
    await ev(page, "() => __debug.prog.nav('settings')"); await page.wait_for_timeout(400)
    nlock = await ev(page, "() => document.querySelectorAll('#setSheet .lockd').length")
    await tap(page, '#setSheet .set-tile[data-style="lp"]'); await page.wait_for_timeout(300)
    k = await ev(page, '() => __keys.getSettings()')
    check(nlock == 0 and k['style'] == 'lp', f'P2 DEV unlock all: locked tiles {nlock}, style {k["style"]}')
    await ev(page, '() => __debug.prog.setDevUnlockAll(false)'); await page.wait_for_timeout(200)
    k = await ev(page, '() => __keys.getSettings()')
    check(k['style'] == 'sa' and k['preset'] == 'ink', f'P2 unlock-all off falls back to defaults for locked items: {k}')
    check(not errs, f'P2 errors: {errs}')
    notes.append(f'P2 Settings: Ink NEW + selectable, Cherry "{s["cherryReq"]}" refused, Checkerboard/Mint locked; DEV unlock all -> 0 locked, Low-profile applied; off -> style back to sa, Ink kept')
    await ctx.close()

    # old saves referencing locked items fall back to defaults
    ctx, page, errs = await new_page(browser, '#p=w0-use-01', storage={'sudoku.settings.v1': json.dumps({'v': 1, 'style': 'cherry', 'layout': 'checker', 'preset': 'ocean', 'sound': True, 'switchVol': 0.5})})
    k = await ev(page, '() => __keys.getSettings()')
    check(k['style'] == 'sa' and k['layout'] == 'plain' and k['preset'] == 'retro' and k['switchVol'] == 0.5, f'P2 locked saved settings fall back: {k}')
    notes.append(f'P2 an old save with cherry/checker/ocean on a fresh profile -> {k["style"]}/{k["layout"]}/{k["preset"]} (volume kept)')
    await ctx.close()


# ---------------------------------------------------------------------------
async def p3_bars(browser):
    ctx, page, errs = await new_page(browser)
    ids0, ids1 = await ids_of(page, 0), await ids_of(page, 1)
    await ctx.close()
    levels = {i: 3 for i in ids0[1:]}; levels[ids0[0]] = 0
    levels.update({ids1[1]: 2, ids1[2]: 1, ids1[7]: 3})
    ctx, page, errs = await new_page(browser, storage={'sudoku.profile.v1': levels_profile(levels, mastered=[0])})
    t = await ev(page, '() => __debug.prog.totals()')
    check(t == {'earned': 39 + 6, 'available': 78, 'all': 5 * 39}, f'P3 totals: {t}')
    hm = await ev(page, "() => { const m = document.querySelector('#home .cm.tot'); return { e: +m.dataset.earned, a: +m.dataset.available, all: +m.dataset.all, fill: m.querySelector('.cm-fill').style.width, dim: m.querySelector('.cm-dim').style.width }; }")
    check(hm['e'] == 45 and hm['a'] == 78 and hm['all'] == 195 and abs(float(hm['fill'][:-1]) - 45 / 195 * 100) < 0.01 and abs(float(hm['dim'][:-1]) - 78 / 195 * 100) < 0.01, f'P3 Home total bar: {hm}')
    await ev(page, '() => __debug.prog.openWorld(1, 0)'); await page.wait_for_timeout(300)
    wm = await ev(page, "() => { const m = document.querySelector('#campWorld .cw-meter .cm'), g = document.querySelector('#campWorld .mlock .cm'); return { e: +m.dataset.earned, a: +m.dataset.available, ge: +g.dataset.earned, ga: +g.dataset.available, pips: [...document.querySelectorAll('#campWorld .key[data-level=\"1.1\"] .cc.on')].length }; }")
    check(wm == {'e': 6, 'a': 39, 'ge': 6, 'ga': 24, 'pips': 2}, f'P3 world 1 meters: {wm}')
    notes.append(f'P3 bars: total {hm["e"]}/{hm["a"]} of {hm["all"]} (fill {hm["fill"]}, dim {hm["dim"]}); World 1 {wm["e"]}/{wm["a"]}, gate {wm["ge"]}/{wm["ga"]}, Spot it 1 shows {wm["pips"]} pips')
    # expertise: clean solves raise inner; non-clean / lower never drop it
    seq = await ev(page, """() => { const out = [], P = __debug.prog;
      const fire = d => document.dispatchEvent(new CustomEvent('sudoku:solved', { detail: d }));
      out.push(P.expertise().inner);
      for (let k = 0; k < 4; k++) { fire({ id: 'q-tricky-00' + k, mode: 'free', kind: 'quick', world: 4, mistakes: 0, paidHints: 0, silentWrong: 0, ms: 1000, charges: 3, clean: true }); out.push(P.expertise().inner); }
      fire({ id: 'q-tricky-009', mode: 'free', kind: 'quick', world: 4, mistakes: 3, paidHints: 1, silentWrong: 0, ms: 1000, charges: 1, clean: false }); out.push(P.expertise().inner);
      fire({ id: 'q-tricky-003', mode: 'free', kind: 'quick', world: 4, mistakes: 0, paidHints: 0, silentWrong: 0, ms: 1000, charges: 3, clean: true }); out.push(P.expertise().inner);
      const p = P.getProfile(); p.expertise.inner = 1; P.setProfile(p); out.push(P.expertise().inner);
      return { out, points: P.expertise().points }; }""")
    o = seq['out']
    check(o[0] == 1 and o[4] > o[0] and all(o[i + 1] >= o[i] for i in range(7)) and o[5] == o[4] and o[7] == o[6], f'P3 expertise rises on clean Free Mode solves, never drops (even via setProfile): {seq}')
    # setProfile cannot lower it below what the points give? (inner is stored; validate keeps >= 1). Points stay.
    await ev(page, '() => __debug.prog.showHome(0)'); await page.wait_for_timeout(200)
    xp = await ev(page, "() => ({ inner: +document.querySelector('#home .xp').dataset.inner, tier: +document.querySelector('#home .xp').dataset.tier })")
    check(xp['inner'] == o[7], f'P3 Home shows the inner level: {xp} vs {o}')
    notes.append(f'P3 expertise inner over 4 clean tricky Free Mode solves + 1 messy + 1 repeat + setProfile(inner 1): {o} (points {seq["points"]}); Home shows tier {xp["tier"]} level {xp["inner"]}')
    # tier -> Solver once W3 is mastered (through the solved event of W3's Master)
    tier = await ev(page, """() => { const P = __debug.prog, before = P.expertise();
      const ids = P.levelIds(3), d = { id: ids[13], mode: 'campaign', kind: 'master', world: 3, mistakes: 0, paidHints: 0, silentWrong: 0, ms: 1, charges: 3, clean: true };
      document.dispatchEvent(new CustomEvent('sudoku:solved', { detail: d }));
      const a = P.expertise(); return { before: before.tier, after: a.tier, name: a.name, inner: a.inner, home: document.querySelector('#home .xp-tier').textContent }; }""")
    check(tier['before'] == 1 and tier['after'] == 2 and tier['name'] == 'Solver' and tier['inner'] == 1 and tier['home'] == 'Solver', f'P3 tier: {tier}')
    # a campaign level only counts the first time it is clean
    rep = await ev(page, """() => { const P = __debug.prog, a = P.expertise().points, id = P.levelIds(1)[3];
      const d = { id, mode: 'campaign', kind: 'spotIt', world: 1, mistakes: 0, paidHints: 0, silentWrong: 0, ms: 1, charges: 3, clean: true };
      document.dispatchEvent(new CustomEvent('sudoku:solved', { detail: d })); const b = P.expertise().points;
      document.dispatchEvent(new CustomEvent('sudoku:solved', { detail: d })); const c = P.expertise().points; return [a, b, c]; }""")
    check(rep[1] == rep[0] + 2 and rep[2] == rep[1], f'P3 campaign clean counts once: {rep}')
    check(not errs, f'P3 errors: {errs}')
    notes.append(f'P3 tier: mastering World 3 -> {tier["name"]} (tier {tier["after"]}, inner reset to {tier["inner"]}); a campaign level adds points once: {rep}')
    await ctx.close()


# ---------------------------------------------------------------------------
async def p4_fill(browser):
    ctx, page, errs = await new_page(browser, '#p=w1-use-01')
    vis = await ev(page, "() => { const k = document.querySelector('.hkeys .key.fk'); return !!k && k.offsetParent !== null; }")
    check(not vis, 'P4 Fill key visible before the unlock')
    await ev(page, "() => { const p = __debug.prog.getProfile(); p.unlocks.fillNotes = true; __debug.prog.setProfile(p); }")
    await page.wait_for_timeout(100)
    g = await ev(page, "() => { const k = document.querySelector('.hkeys .key.fk'), h = document.querySelector('.hkeys .key.hk'), c = document.querySelector('.hkeys .key.ckk'), r = e => e.getBoundingClientRect(); return { vis: !!k && k.offsetParent !== null, k: [r(k).left, r(k).right, r(k).top, r(k).bottom], h: [r(h).left, r(h).right], c: [r(c).left, r(c).right], w: innerWidth }; }")
    check(g['vis'] and g['k'][1] <= g['h'][0] + 0.5 and g['h'][1] <= g['c'][0] + 0.5 and g['c'][1] <= g['w'], f'P4 Fill key placement: {g}')
    await cell(page, await ev(page, '() => Array.from(__debug.S.values).findIndex(v => !v)'))
    await key(page, await ev(page, '() => { const S = __debug.S, i = S.selected; return S.sol[i]; }'))     # one digit first, then fill
    await page.wait_for_timeout(200)
    undo0 = await ev(page, '() => __debug.S.undo.length')
    await tap(page, '.hkeys .key.fk'); await page.wait_for_timeout(900)
    r = await ev(page, """() => { const S = __debug.S, c = __debug.solver.computeCands(S.values); let ok = true, n = 0;
      for (let i = 0; i < 81; i++) if (!S.values[i]) { n++; if (S.notes[i] !== c[i]) ok = false; }
      return { ok, n, undo: S.undo.length, mistakes: S.mistakes, paid: S.paidHints }; }""")
    check(r['ok'] and r['n'] > 0 and r['undo'] == undo0 + 1 and r['mistakes'] == 0 and r['paid'] == 0, f'P4 fill: {r} (undo before {undo0})')
    await page.screenshot(path=str(OUT / 'p4-fill.png'))
    await mod(page, 'Undo'); await page.wait_for_timeout(300)
    u = await ev(page, '() => ({ notes: Array.from(__debug.S.notes).filter(x => x).length, undo: __debug.S.undo.length, placed: Array.from(__debug.S.values).filter((v, i) => v && !__debug.S.given[i]).length })')
    check(u['notes'] == 0 and u['undo'] == undo0 and u['placed'] == 1, f'P4 one Undo restores: {u}')
    notes.append(f'P4 Fill: hidden before unlock; after: left of Hint, {r["n"]} cells = computed candidates in one undo step (free: mistakes 0, paid hints 0); Undo -> {u}')
    check(not errs, f'P4 errors: {errs}')
    await ctx.close()
    for h in ['#l0=w2', '#p=w1-spot-01']:
        ctx, page, errs = await new_page(browser, h, storage={'sudoku.profile.v1': levels_profile({}, unlocks={'fillNotes': True})})
        vis = await ev(page, "() => { const k = document.querySelector('.hkeys .key.fk'); return !!k && k.offsetParent !== null && getComputedStyle(k).display !== 'none'; }")
        check(not vis, f'P4 Fill key must be hidden in {h}')
        await ctx.close()
    notes.append('P4 Fill hidden in Level 0 (#l0=w2) and in Spot it, even when unlocked')


# ---------------------------------------------------------------------------
async def p5_home(browser):
    ctx, page, errs = await new_page(browser)
    h = await ev(page, "() => ({ scr: __debug.prog.screen(), cont: document.querySelector('#home .key.cont').offsetParent !== null, vis: getComputedStyle(document.getElementById('home')).display })")
    check(h['scr'] == 'home' and not h['cont'] and h['vis'] == 'block', f'P5 Home on launch, no Continue on a fresh profile: {h}')
    await tap(page, '#home .key.camp'); await page.wait_for_timeout(450)
    check(await screen(page) == 'campaign', 'P5 Campaign key -> keyboard map')
    await tap(page, '#campMap .sbtn'); await page.wait_for_timeout(450)
    check(await screen(page) == 'home', 'P5 back -> Home')
    await ev(page, "() => document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to: 'campaign' } }))"); await page.wait_for_timeout(350)
    a = await screen(page)
    await ev(page, "() => document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to: 'home' } }))"); await page.wait_for_timeout(350)
    b = await screen(page)
    await ev(page, "() => document.dispatchEvent(new CustomEvent('sudoku:nav', { detail: { to: 'settings' } }))"); await page.wait_for_timeout(350)
    c = await ev(page, "() => document.getElementById('setSheet').classList.contains('show')")
    await ev(page, "() => document.querySelector('#setSheet .set-x').click()"); await page.wait_for_timeout(300)
    await tap(page, '#home .key.free'); await page.wait_for_timeout(350)
    navs = await ev(page, '() => window.__ev.nav.map(n => n.to)')
    d = await screen(page)
    check(a == 'campaign' and b == 'home' and c and 'free' in navs and d is None, f'P5 nav events: campaign->{a}, home->{b}, settings open {c}, free {navs} -> screen {d}')
    notes.append(f'P5 nav: {navs}; Free Mode key dispatches to:"free" and leaves the screens')
    # play World 0 Spot it 1 from the map, leave Home, Continue
    await ev(page, "() => __debug.prog.nav('campaign')"); await page.wait_for_timeout(350)
    await tap(page, '#campMap .key.wk[data-world="0"]'); await page.wait_for_timeout(450)
    await tap(page, '#campWorld .key[data-level="0.1"]'); await page.wait_for_timeout(450)
    cs = await ev(page, '() => __debug.camp.state()')
    check(cs['active'] and cs['world'] == 0 and cs['k'] == 1 and await screen(page) is None, f'P5 level tile starts the runner: {cs}')
    step = await ev(page, '() => __debug.S.spot.step')
    await tap(page, '#homeBtn'); await page.wait_for_timeout(400)
    hm = await ev(page, "() => ({ scr: __debug.prog.screen(), sub: document.querySelector('#home .key.cont small').textContent, cont: document.querySelector('#home .key.cont').offsetParent !== null })")
    check(hm['scr'] == 'home' and hm['cont'] and hm['sub'] == 'World 0 · Spot it 1', f'P5 header Home -> Home with Continue: {hm}')
    await tap(page, '#home .key.cont'); await page.wait_for_timeout(400)
    cs2 = await ev(page, '() => __debug.camp.state()')
    check(await screen(page) is None and cs2['active'] and cs2['k'] == 1, f'P5 Continue resumes the runner: {cs2}')
    # a correct first step of Spot it 1 (a placement) then reload
    pl = step['place']
    p_before = await prof(page)
    await page.reload(); await page.wait_for_function('() => window.__debug && window.__debug.prog')
    r = await ev(page, "() => ({ scr: __debug.prog.screen(), sub: document.querySelector('#home .key.cont small').textContent, cont: document.querySelector('#home .key.cont').offsetParent !== null })")
    check(r['scr'] == 'home' and r['cont'] and r['sub'] == 'World 0 · Spot it 1', f'P5 after reload: Home with Continue: {r}')
    await tap(page, '#home .key.cont'); await page.wait_for_timeout(400)
    cs3 = await ev(page, '() => __debug.camp.state()')
    check(cs3['active'] and cs3['world'] == 0 and cs3['k'] == 1, f'P5 Continue after reload resumes World 0 Spot it 1: {cs3}')
    await cell(page, pl['cell']); await key(page, pl['digit']); await wait_results(page)
    p1 = await prof(page)
    await page.reload(); await page.wait_for_function('() => window.__debug && window.__debug.prog')
    p2 = await prof(page)
    check(p1['levels'].get(cs3['id']) == 3 and p2 == p1 and p_before != p1, f'P5 profile persists across reload: {p1["levels"]} vs {p2["levels"]}')
    raw = await ev(page, "() => localStorage.getItem('sudoku.profile.v1')")
    check(json.loads(raw)['levels'] == p2['levels'], 'P5 profile stored under sudoku.profile.v1')
    check(not errs, f'P5 errors: {errs}')
    notes.append(f'P5 Continue: header Home -> "{hm["sub"]}" -> runner resumed; after reload Home + Continue -> World 0 k=1; profile persisted ({len(p2["levels"])} levels)')
    await ctx.close()
    # migration
    old = {'done': {'w0-l0': True, 'w0-spot-01': True, 'w0-spot-02': True}, 'clean': {'w0-spot-01': True}, 'skip': {'0': True}, 'unlock': {'fillNotes': True}}
    ctx, page, errs = await new_page(browser, storage={'sudoku.camp.v1': json.dumps(old)})
    p = await prof(page)
    ids = await ids_of(page, 0)
    want = {ids[0]: 0}
    for k, i in enumerate(ids):
        if i in old['done'] and k: want[i] = 2 if i in old['clean'] else 1
    st = await ev(page, '() => __debug.camp.state().store')
    check(p['levels'] == want and p['flags']['skip'] == {'0': True} and p['unlocks']['fillNotes'] and st['skip'] == {'0': True} and st['done'].get(ids[1]),
          f'P5 migration: {p} store {st}')
    check(await ev(page, "() => !!localStorage.getItem('sudoku.profile.v1')"), 'P5 migrated profile saved')
    notes.append(f'P5 migration from sudoku.camp.v1: levels {p["levels"]}, skip {p["flags"]["skip"]}, fillNotes {p["unlocks"]["fillNotes"]}')
    await ctx.close()


# ---------------------------------------------------------------------------
NO_OVERFLOW = """() => { const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('page scrollWidth ' + document.documentElement.scrollWidth);
  for (const s of document.querySelectorAll('.scr.show')) if (s.scrollWidth > s.clientWidth + 1) bad.push(s.id + ' scrollWidth ' + s.scrollWidth);
  const vis = e => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
  const r = e => e.getBoundingClientRect(), over = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const groups = [['#home .home-title', '#home .home-tag', '#home .home-card', '#home .key.cont', '#home .home-row', '#home .key.set', '#home .home-foot'],
                  ['#campMap .scr-bar', '#campMap .cmap-head', '#campMap .kcase', '#campMap .wcard', '#campMap .cmap-cap'],
                  ['#campWorld .scr-bar', '#campWorld .cw-meter', ...[...document.querySelectorAll('#campWorld .cw-sec')].map((_, k) => `#campWorld .cw-sec:nth-child(${k + 1})`)]];
  for (const g of groups) { const els = g.map(s => [s, document.querySelector(s)]).filter(([, e]) => vis(e) && e.closest('.scr.show'));
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) if (over(r(els[i][1]), r(els[j][1]))) bad.push(els[i][0] + ' x ' + els[j][0]); }
  for (const e of document.querySelectorAll('.scr.show .key, .scr.show .wcard, .scr.show .cm')) { const b = r(e); if (vis(e) && (b.left < -1 || b.right > innerWidth + 1)) bad.push('offscreen ' + e.className); }
  const t = document.getElementById('toast');
  if (t.classList.contains('show')) { const b = r(t); if (b.left < 0 || b.right > innerWidth || b.top < 0 || b.bottom > innerHeight) bad.push('toast out of view ' + JSON.stringify([b.left, b.top, b.right, b.bottom]));
    for (const e of t.querySelectorAll('*')) { const q = r(e); if (q.width && (q.left < b.left - 1 || q.right > b.right + 1)) { bad.push('toast content overflows: ' + e.className); break; } } }
  return bad; }"""

async def p6_shots(browser):
    ctx, page, errs = await new_page(browser)
    ids = {w: await ids_of(page, w) for w in range(5)}
    await ctx.close()
    three = {}
    for w in range(3):
        for k, i in enumerate(ids[w]): three[i] = 0 if k == 0 else 3
    for k, i in enumerate(ids[3][:6]): three[i] = 0 if k == 0 else (3 if k < 4 else 2)
    shots = []
    for vp in [(390, 844), (375, 667)]:
        for scheme, motion in [('light', 'no-preference'), ('dark', 'no-preference'), ('light', 'reduce')]:
            tag = f'{vp[0]}x{vp[1]}-{scheme}{"-rm" if motion == "reduce" else ""}'
            if os.environ.get('P6_ONLY') and os.environ['P6_ONLY'] != tag: continue
            # fresh profile: Home, empty keyboard, World 0 list
            ctx, page, errs = await new_page(browser, vp=vp, scheme=scheme, motion=motion, dsf=2)
            await page.wait_for_timeout(450)
            for name, js in [('home', None), ('map-empty', '() => __debug.prog.openMap(0)'), ('world0', '() => __debug.prog.openWorld(0, 0)')]:
                if js: await ev(page, js); await page.wait_for_timeout(500)
                bad = await ev(page, NO_OVERFLOW)
                check(not bad, f'P6 {tag} {name}: {bad}')
                f = OUT / f'{tag}-{name}.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            check(not errs, f'P6 {tag} errors: {errs}')
            await ctx.close()
            # three worlds mastered (built via pending -> build animation), World 3 in progress
            prof3 = levels_profile(three, mastered=[0, 1, 2], flags={'pendingBuild': [2], 'badge': True, 'fresh': ['layout:checker', 'preset:mint']})
            ctx, page, errs = await new_page(browser, vp=vp, scheme=scheme, motion=motion, dsf=2, storage={'sudoku.profile.v1': prof3})
            await ev(page, '() => __debug.prog.openMap(0)')
            if motion != 'reduce':
                await page.wait_for_timeout(500)          # mid build: World 2's cap dropping
                f = OUT / f'{tag}-map-building.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            await page.wait_for_timeout(900)
            bad = await ev(page, NO_OVERFLOW)
            check(not bad, f'P6 {tag} map-3: {bad}')
            built = await ev(page, '() => __debug.prog.MAP.built')
            check(built == [0, 1, 2], f'P6 {tag} built sockets {built}')
            f = OUT / f'{tag}-map-3built.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            await ev(page, '() => __debug.prog.openWorld(3, 1)'); await page.wait_for_timeout(500)
            bad = await ev(page, NO_OVERFLOW)
            check(not bad, f'P6 {tag} world3: {bad}')
            f = OUT / f'{tag}-world3.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            await ev(page, "() => { __debug.prog.hideScreens(); __debug.prog.nav('settings'); }"); await page.wait_for_timeout(550)
            f = OUT / f'{tag}-settings-locks.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            sb = await ev(page, "() => { const s = document.getElementById('setSheet'); return { h: s.getBoundingClientRect().height, vh: innerHeight, sw: s.scrollWidth, cw: s.clientWidth }; }")
            check(sb['sw'] <= sb['cw'] + 1, f'P6 {tag} settings overflow {sb}')
            await ev(page, "() => document.querySelector('#setSheet .set-x').click()")
            check(not errs, f'P6 {tag} errors: {errs}')
            await ctx.close()
            # results card mid-charge and the unlock reward (World 0 Master)
            lv = {i: 3 for i in ids[0][1:13]}; lv[ids[0][0]] = 0
            ctx, page, errs = await new_page(browser, '#camp=0.13', vp=vp, scheme=scheme, motion=motion, dsf=2, storage={'sudoku.profile.v1': levels_profile(lv)})
            await clash_once(page); await clash_once(page)      # the third cell stays empty: "2 mistakes"
            await solve_ui(page)
            await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=9000)
            await page.wait_for_function("() => __debug.prog.RC.filled >= 1", timeout=9000)
            if motion != 'reduce': await page.wait_for_timeout(260)
            f = OUT / f'{tag}-results-mid.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            await wait_results(page)
            bad = await ev(page, NO_OVERFLOW)
            check(not bad, f'P6 {tag} results: {bad}')
            f = OUT / f'{tag}-results-done.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            await tap(page, '#againKey'); await page.wait_for_timeout(1300)
            bad = await ev(page, NO_OVERFLOW)
            check(not bad, f'P6 {tag} reward: {bad}')
            f = OUT / f'{tag}-reward.png'; await page.screenshot(path=str(f)); shots.append(f.name)
            check(not errs, f'P6 {tag} errors: {errs}')
            await ctx.close()
    notes.append(f'P6 {len(shots)} screenshots in {OUT}: ' + ', '.join(shots[:9]) + ' …')


async def main():
    assert (DIST / 'index.html').exists(), 'run node tools/build.mjs first'
    srv = subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            only = [a for a in sys.argv[1:] if a.startswith('p')]
            for name, fn in [('p1', p1_charges), ('p2', p2_gate), ('p3', p3_bars), ('p4', p4_fill), ('p5', p5_home), ('p6', p6_shots)]:
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
    print('PROGRESSION')
    for n in notes: print('  ' + n)
    if failures:
        print(f'\nFAIL ({len(failures)})')
        for f in failures: print('  - ' + f)
        sys.exit(1)
    print('\nPASS')


if __name__ == '__main__':
    asyncio.run(main())
