#!/usr/bin/env python3
"""effects-test.py — step 10: the effects pass on the non-board screens (Playwright).

    node tools/build.mjs && python3 tools/effects-test.py [nav interrupt reduced deltas layout fx perf shots]

  nav        every screen transition (Home <-> map <-> level list <-> puzzle, Home <->
             Free Mode <-> Quick / Daily puzzle, Continue) picks its spatial mode
             (expand from the tapped key / collapse into its anchor), reaches its final
             state, and the destination takes a tap within 300 ms (elementFromPoint on a
             destination key). Sheets + the solved toast spring from their source.
  interrupt  tapping back right after a forward tap (and forward right after back)
             leaves one consistent screen: one layer shown, no slab, no inline
             z-index / transform / visibility left on any layer, no running morph.
  reduced    prefers-reduced-motion: no element moves more than 2 px during a
             transition (sampled rects + computed transforms every frame), no
             travelling particles (sparks / FX pools stay empty), the slab never shows.
  deltas     a gain animates once: Home's total bar + expertise, the level list's
             pips / world bar / Master lock, Free Mode band flip + streak embers; the
             second visit is static.
  layout     no layout shift: Home / map / level list rects are the same before and
             after transitions (and with transitions interrupted).
  fx         results card sequence (3 even beats, bar after the cells, unlock after
             the bar), settings unlock pop + badge spark, backup copy pulse, Load bolt,
             paste-box shake, Challenge toggle lock open/close.
  perf       frame times (rAF deltas) during the heaviest transitions with the CPU
             throttled 4x (CDP Emulation.setCPUThrottlingRate): average and p95.
  shots      mid-transition frames (paused via the Animations API) at 390x844 light +
             dark + reduced motion -> /tmp/effects/

EFFECTS_PORT overrides the port (default 8801). Exit code 1 on any failure.
Zero console errors in every test.
"""
import asyncio, json, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/effects'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = int(os.environ.get('EFFECTS_PORT', 8801))
failures, notes = [], []

def check(cond, msg):
    if not cond: failures.append(msg)
    return cond

async def new_page(browser, hash_='', vp=(390, 844), storage=None, scheme='light', rm='no-preference', perms=None):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, color_scheme=scheme, reduced_motion=rm)
    if perms: await ctx.grant_permissions(perms, origin=f'http://127.0.0.1:{PORT}')
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    seed = {'sudoku.settings.v1': json.dumps({'v': 1, 'sound': False})}
    seed.update(storage or {})
    await page.add_init_script(f"try {{ if (!sessionStorage.getItem('__seeded')) {{ for (const [k, v] of Object.entries({json.dumps(seed)})) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); }} }} catch (e) {{}}")
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{hash_}')
    await page.wait_for_function('() => window.__debug && window.__debug.prog && window.__fm')
    await page.wait_for_timeout(700)      # the title settle (once per session) and the boot entrance
    return ctx, page, errs

async def ev(page, js, arg=None): return await page.evaluate(js, arg)
async def press(page, sel):
    b = await page.locator(sel).first.bounding_box()
    assert b, f'not visible: {sel}'
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down(); await page.mouse.up()

async def jstap(page, sel):
    """A tap delivered in one script turn at the element's CURRENT (possibly moving) position."""
    r = await ev(page, """(sel) => { const k = document.querySelector(sel); if (!k) return 'missing';
      const r = k.getBoundingClientRect(), o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, button: 0, isPrimary: true, pointerType: 'touch' };
      const t = document.elementFromPoint(o.clientX, o.clientY) || k;
      if (!k.contains(t) && !t.contains(k)) return 'covered by ' + (t.className || t.tagName);
      t.dispatchEvent(new PointerEvent('pointerdown', o)); t.dispatchEvent(new PointerEvent('pointerup', o)); t.dispatchEvent(new MouseEvent('click', o)); return 'ok'; }""", sel)
    return r

STATE = """() => {
  const P = __debug.prog, lay = [...document.querySelectorAll('.scr'), document.getElementById('fm'), document.getElementById('app')];
  const slab = document.querySelector('.mslab');
  return { scr: P.screen(), fm: __fm.isOpen(), morph: P.MORPH.last && P.MORPH.last.mode,
    shown: [...document.querySelectorAll('.scr.show')].map(e => e.dataset.scr),
    leaving: [...document.querySelectorAll('.scr.leaving')].map(e => e.dataset.scr),
    slab: !!slab && getComputedStyle(slab).display !== 'none',
    inline: lay.filter(e => e.style.zIndex || e.style.transformOrigin || (e.id !== 'fm' && e.style.visibility)).map(e => e.id || e.dataset.scr),
    anims: document.getAnimations().filter(a => a.playState === 'running' && lay.includes(a.effect && a.effect.target)).length,
    opacity: lay.filter(e => getComputedStyle(e).display !== 'none' && e.id !== 'app' && (e.classList.contains('show'))).map(e => +getComputedStyle(e).opacity) };
}"""
# a destination key that must take a tap 300 ms after the transition starts
HIT = """([sel, layer]) => {
  const k = document.querySelector(sel); if (!k) return 'missing ' + sel;
  const r = k.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const e = document.elementFromPoint(x, y), L = layer === 'game' ? document.getElementById('app') : layer === 'free' ? document.getElementById('fm') : document.querySelector('.scr[data-scr="' + layer + '"]');
  return !!e && L.contains(e) && (k.contains(e) || e.contains(k)) ? 'ok' : 'hit ' + (e ? (e.className || e.tagName) : 'none');
}"""

PATHS = [  # (tap, expected mode, destination layer, a destination key)
    ('#home .key.camp', 'expand', 'campaign', '#campMap .key.wk[data-world="0"]'),
    ('#campMap .key.wk[data-world="0"]', 'expand', 'world', '#campWorld [data-level="0.1"]'),
    ('#campWorld [data-level="0.1"]', 'expand', 'game', '.key.digit[data-d="5"]'),
    ('#homeBtn', 'collapse', 'world', '#campWorld [data-level="0.2"]'),
    ('#campWorld .scr-bar .sbtn', 'collapse', 'campaign', '#campMap .wcard'),
    ('#campMap .scr-bar .sbtn', 'collapse', 'home', '#home .key.free'),
    ('#home .key.free', 'expand', 'free', '.fm-band[data-band="gentle"]'),
    ('.fm-band[data-band="gentle"]', 'expand', 'game', '.key.digit[data-d="5"]'),
    ('#homeBtn', 'collapse', 'free', '.fm-play'),
    ('.fm-play', 'expand', 'game', '.key.digit[data-d="5"]'),
    ('#homeBtn', 'collapse', 'free', '.fm-back'),
    ('.fm-back', 'collapse', 'home', '#home .key.cont'),
    ('#home .key.cont', 'expand', 'game', '.key.digit[data-d="5"]'),
]

async def settled(page):
    await page.wait_for_timeout(420)
    return await ev(page, STATE)

def consistent(st, tag):
    ok = True
    ok &= check(not st['slab'], f'{tag}: slab still showing {st}')
    ok &= check(not st['inline'], f'{tag}: inline styles left on layers {st}')
    ok &= check(not st['leaving'], f'{tag}: a screen still leaving {st}')
    ok &= check(st['anims'] == 0, f'{tag}: layer animations still running {st}')
    want = [st['scr']] if st['scr'] else []
    ok &= check(st['shown'] == want, f'{tag}: shown screens {st["shown"]} != current {want}')
    ok &= check(all(o > 0.99 for o in st['opacity']), f'{tag}: a shown layer is not opaque {st}')
    return ok

# ---------------------------------------------------------------------------
async def t_nav(browser):
    ctx, page, errs = await new_page(browser)
    timings = []
    for sel, mode, dest, key in PATHS:
        t0 = time.time()
        await press(page, sel)
        await page.wait_for_timeout(300)
        hit = await ev(page, HIT, [key, dest])
        st = await ev(page, STATE)
        check(st['morph'] == mode, f'nav {sel}: mode {st["morph"]} != {mode}')
        check(hit == 'ok', f'nav {sel}: destination {key} not interactive at 300 ms ({hit})')
        st = await settled(page)
        where = st['scr'] or ('free' if st['fm'] else 'game')
        check(where == dest, f'nav {sel}: ended on {where}, expected {dest}')
        consistent(st, f'nav {sel}')
        timings.append(f'{dest}:{mode}')
    # sheets + toast spring from their source; the CSS transition is back afterwards
    await ev(page, '() => __debug.prog.showHome(0)'); await page.wait_for_timeout(400)
    await press(page, '#home .key.set'); await page.wait_for_timeout(60)
    sp = await ev(page, "() => { const s = document.getElementById('setSheet'); const a = s.getAnimations().find(x => x.playState === 'running'); return { anim: !!a, origin: s.style.transformOrigin, tr: s.style.transition }; }")
    check(sp['anim'] and sp['origin'] and sp['tr'] == 'none', f'nav: settings sheet should spring from the Settings key {sp}')
    await page.wait_for_timeout(500)
    sp2 = await ev(page, "() => { const s = document.getElementById('setSheet'); return { show: s.classList.contains('show'), origin: s.style.transformOrigin, tr: s.style.transition, op: getComputedStyle(s).opacity, anims: s.getAnimations().filter(a => a.playState === 'running').length }; }")
    check(sp2['show'] and not sp2['origin'] and sp2['tr'] == '' and sp2['op'] == '1', f'nav: settings sheet after the spring {sp2}')
    await page.keyboard.press('Escape'); await page.wait_for_timeout(60)
    cl = await ev(page, "() => { const s = document.getElementById('setSheet'); return { show: s.classList.contains('show'), anim: s.getAnimations().some(a => a.playState === 'running'), pe: s.style.pointerEvents }; }")
    check(not cl['show'] and cl['anim'] and cl['pe'] == 'none', f'nav: settings sheet should close back into its source {cl}')
    await page.wait_for_timeout(400)
    for opener, sheet in [("() => __debug.backup.openSheet()", 'sheet'), ("() => __debug.openDev()", 'devSheet')]:
        await ev(page, opener); await page.wait_for_timeout(450)
        s = await ev(page, f"() => {{ const s = document.getElementById('{sheet}'); return {{ show: s.classList.contains('show'), tr: s.style.transition, op: getComputedStyle(s).opacity, bottom: Math.round(s.getBoundingClientRect().bottom) }}; }}")
        check(s['show'] and s['tr'] == '' and s['op'] == '1' and abs(s['bottom'] - 844) <= 2, f'nav: {sheet} open state {s}')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(350)
    notes.append(f'nav: {len(PATHS)} transitions -> ' + ', '.join(timings) + '; destinations take a tap at 300 ms; sheets spring from their source and restore their CSS transition')
    check(not errs, f'nav errors: {errs}')
    await ctx.close()

# ---------------------------------------------------------------------------
async def t_interrupt(browser):
    ctx, page, errs = await new_page(browser)
    seqs = [
        (['#home .key.camp', '#campMap .scr-bar .sbtn'], 'home'),
        (['#home .key.camp', 'WAIT', '#campMap .key.wk[data-world="0"]', '#campWorld .scr-bar .sbtn'], 'campaign'),
        (['#campMap .scr-bar .sbtn', '#home .key.free', '.fm-back'], 'home'),
        (['#home .key.free', '.fm-band[data-band="gentle"]', '#homeBtn'], 'free'),
        (['.fm-back', '#home .key.camp', '#campMap .key.wk[data-world="0"]', '#campWorld .scr-bar .sbtn', '#campMap .scr-bar .sbtn'], 'home'),
    ]
    for seq, want in seqs:
        for sel in seq:
            if sel == 'WAIT': await page.wait_for_timeout(400); continue
            r = await jstap(page, sel)
            check(r == 'ok', f'interrupt {seq}: tap {sel} -> {r}')
            await page.wait_for_timeout(45)
        st = await settled(page)
        where = st['scr'] or ('free' if st['fm'] else 'game')
        check(where == want, f'interrupt {seq}: ended on {where}, expected {want}')
        consistent(st, f'interrupt {seq}')
        # and it still works: one more transition from here, uninterrupted
    await press(page, '#home .key.camp'); st = await settled(page)
    check(st['scr'] == 'campaign' and st['morph'] == 'expand', f'interrupt: a clean transition afterwards {st}')
    consistent(st, 'interrupt: after')
    # settle() from a test mid-flight also lands at the end state
    await press(page, '#campMap .scr-bar .sbtn'); await page.wait_for_timeout(60)
    await ev(page, '() => __debug.prog.settle()')
    st = await ev(page, STATE)
    consistent(st, 'interrupt: settle() mid-flight')
    notes.append(f'interrupt: {len(seqs)} rapid sequences (45 ms between taps) end on one consistent screen; settle() mid-flight is clean')
    check(not errs, f'interrupt errors: {errs}')
    await ctx.close()

# ---------------------------------------------------------------------------
SAMPLER = """() => {
  window.__samp = { maxMove: 0, maxT: 0, slab: false, sparks: 0, fx: 0, frames: 0, worst: '' };
  const els = () => [...document.querySelectorAll('.scr.show .key, .scr.show .wcard, .fm.show .key, #fm, .scr.show, .key.digit[data-d]')];
  const base = new Map();
  const tick = () => {
    const S = window.__samp; S.frames++;
    for (const e of els()) {
      const r = e.getBoundingClientRect(), b = base.get(e);
      if (!b) { base.set(e, [r.left, r.top]); continue; }
      const m = Math.max(Math.abs(r.left - b[0]), Math.abs(r.top - b[1]));
      if (m > S.maxMove) { S.maxMove = m; S.worst = e.className || e.id; }
      const t = getComputedStyle(e).transform;
      if (t && t !== 'none') { const M = new DOMMatrix(t); const d = Math.max(Math.abs(M.e), Math.abs(M.f), Math.abs(M.a - 1) * r.width, Math.abs(M.d - 1) * r.height); if (d > S.maxT) S.maxT = d; }
    }
    const s = document.querySelector('.mslab'); if (s && getComputedStyle(s).display !== 'none') S.slab = true;
    S.sparks = Math.max(S.sparks, __debug.prog.SPARKS.alive); S.fx = Math.max(S.fx, __debug.FX.alive);
    if (S.on) requestAnimationFrame(tick);
  };
  window.__samp.on = true; window.__sampReset = () => base.clear(); requestAnimationFrame(tick);
}"""
async def t_reduced(browser):
    ctx, page, errs = await new_page(browser, rm='reduce', perms=['clipboard-read', 'clipboard-write'])
    await ev(page, SAMPLER)
    worst = []
    for sel, mode, dest, key in PATHS:
        await ev(page, '() => window.__sampReset()')
        await press(page, sel); await page.wait_for_timeout(300)
        st = await ev(page, STATE)
        check(st['morph'] == 'fade', f'reduced {sel}: mode {st["morph"]} != fade')
        hit = await ev(page, HIT, [key, dest]); check(hit == 'ok', f'reduced {sel}: not interactive at 300 ms ({hit})')
        st = await settled(page); consistent(st, f'reduced {sel}')
    # effects that would travel: world deltas, a settings unlock, backup copy
    await ev(page, "() => { __debug.prog.devGate(0, 24); __debug.prog.showHome(0); }"); await page.wait_for_timeout(400)
    await press(page, '#home .key.camp'); await page.wait_for_timeout(400)
    await press(page, '#campMap .key.wk[data-world="0"]'); await page.wait_for_timeout(1600)
    await ev(page, "() => { __debug.prog.devMaster(0); }"); await page.wait_for_timeout(100)
    await press(page, '#campWorld .scr-bar .sbtn'); await page.wait_for_timeout(1200)
    await ev(page, "() => __debug.prog.showHome(-1)"); await page.wait_for_timeout(300)
    await press(page, '#home .key.set'); await page.wait_for_timeout(1400)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
    await ev(page, "() => __debug.backup.openSheet()"); await page.wait_for_timeout(400)
    await press(page, '#copyKey'); await page.wait_for_timeout(800)
    s = await ev(page, "() => { window.__samp.on = false; return window.__samp; }")
    check(s['maxMove'] <= 2 and s['maxT'] <= 2, f'reduced: elements moved during transitions (max {s["maxMove"]:.1f} px rect, {s["maxT"]:.1f} px transform, {s["worst"]})')
    check(not s['slab'], 'reduced: the slab showed')
    check(s['sparks'] == 0 and s['fx'] == 0, f'reduced: travelling particles alive (sparks {s["sparks"]}, FX {s["fx"]})')
    notes.append(f'reduced: {len(PATHS)} crossfades + world deltas + Master pop + settings unlock + copy over {s["frames"]} frames: max move {s["maxMove"]:.2f} px, max transform {s["maxT"]:.2f} px, particles {s["sparks"]}/{s["fx"]}')
    check(not errs, f'reduced errors: {errs}')
    await ctx.close()

# ---------------------------------------------------------------------------
async def t_deltas(browser):
    ctx, page, errs = await new_page(browser)
    seen0 = await ev(page, '() => __debug.prog.seen()')
    check(seen0['total'] == 0 and seen0['xp']['inner'] == 1, f'deltas: seeded from the profile {seen0}')
    base = await ev(page, '() => ({ ...__debug.prog.FXLOG })')
    # gain charges + expertise while the board is showing (as a solve would)
    await ev(page, '() => __debug.prog.hideScreens()'); await page.wait_for_timeout(400)
    await ev(page, """() => { const P = __debug.prog, ids = P.levelIds(0), p = P.getProfile();
      ids.slice(1, 6).forEach(id => p.levels[id] = 3); p.levels[ids[6]] = 2; p.expertise.points = 13; p.expertise.inner = 3; P.setProfile(p); }""")
    await ev(page, '() => __debug.prog.showHome(0)'); await page.wait_for_timeout(80)
    mid = await ev(page, "() => { const f = document.querySelector('#home .cm.tot .cm-fill'); return { anims: f.getAnimations().length, num: document.querySelector('#home .cm.tot .cm-num b').textContent, segs: [...document.querySelectorAll('#home .xp-seg i b')].filter(b => b.getAnimations().length).length }; }")
    await page.wait_for_timeout(1300)
    after = await ev(page, "() => ({ log: { ...__debug.prog.FXLOG }, num: document.querySelector('#home .cm.tot .cm-num b').textContent, lv: document.querySelector('#home .xp-lv b').textContent, fill: document.querySelector('#home .cm.tot .cm-fill').style.width, seen: __debug.prog.seen() })")
    check(after['log']['total'] == base['total'] + 1 and after['log']['xp'] == base['xp'] + 1, f'deltas: Home total + expertise animated once {base} -> {after["log"]}')
    check(mid['anims'] >= 1 and mid['segs'] >= 1, f'deltas: Home bars animating on arrival {mid}')
    check(after['num'] == '17' and after['lv'] == '3' and after['seen']['total'] == 17, f'deltas: Home final values {after}')
    # reopen Home: static
    await press(page, '#home .key.camp'); await page.wait_for_timeout(400)
    await press(page, '#campMap .scr-bar .sbtn'); await page.wait_for_timeout(80)
    st = await ev(page, "() => ({ log: { ...__debug.prog.FXLOG }, anims: document.querySelector('#home .cm.tot .cm-fill').getAnimations().length + [...document.querySelectorAll('#home .xp-seg i b')].reduce((a, b) => a + b.getAnimations().length, 0) })")
    check(st['log']['total'] == after['log']['total'] and st['log']['xp'] == after['log']['xp'] and st['anims'] == 0, f'deltas: second Home visit should be static {st}')
    # level list: pips fill (delta only), world bar, then the Master lock once the gate is crossed
    c0 = await ev(page, '() => ({ ...__debug.prog.CFX })')
    await press(page, '#home .key.camp'); await page.wait_for_timeout(400)
    await press(page, '#campMap .key.wk[data-world="0"]'); await page.wait_for_timeout(120)
    w1 = await ev(page, "() => ({ wait: document.querySelectorAll('#campWorld .cc.fx-wait').length, on: document.querySelectorAll('#campWorld .pips3 .cc.on').length })")
    await page.wait_for_timeout(2600)
    c1 = await ev(page, '() => ({ ...__debug.prog.CFX, wait: document.querySelectorAll("#campWorld .cc.fx-wait").length })')
    check(c1['pips'] == c0['pips'] + 1 and c1['lastPips'] == 17 and c1['bar'] == c0['bar'] + 1 and w1['wait'] == 17 and w1['on'] == 17 and c1['wait'] == 0,
          f'deltas: level list pips (17 new) + world bar animated, DOM final at once {w1} {c1}')
    await ev(page, "() => { const P = __debug.prog, ids = P.levelIds(0), p = P.getProfile(); ids.slice(1, 13).forEach(id => p.levels[id] = 2); ids.slice(1, 13).forEach(id => p.levels[id] = Math.max(p.levels[id], 2)); P.setProfile(p); }")
    await press(page, '#campWorld .scr-bar .sbtn'); await page.wait_for_timeout(400)
    await press(page, '#campMap .key.wk[data-world="0"]'); await page.wait_for_timeout(2400)
    c2 = await ev(page, '() => ({ ...__debug.prog.CFX, pop: document.querySelectorAll(".m-pop").length, unlit: document.querySelectorAll(".fx-unlit").length })')
    check(c2['master'] == c1['master'] + 1 and c2['pop'] == 0 and c2['unlit'] == 0, f'deltas: the Master lock popped off once the gate was crossed {c2}')
    await press(page, '#campWorld .scr-bar .sbtn'); await page.wait_for_timeout(400)
    await press(page, '#campMap .key.wk[data-world="0"]'); await page.wait_for_timeout(1200)
    c3 = await ev(page, '() => ({ ...__debug.prog.CFX })')
    check(c3['master'] == c2['master'] and c3['pips'] == c2['pips'] and c3['bar'] == c2['bar'], f'deltas: second level-list visit static {c2} -> {c3}')
    # the map pulses the world just played
    await press(page, '#campWorld [data-level="0.1"]'); await page.wait_for_timeout(400)
    await press(page, '#homeBtn'); await page.wait_for_timeout(400)
    await press(page, '#campWorld .scr-bar .sbtn'); await page.wait_for_timeout(800)
    c4 = await ev(page, '() => ({ ...__debug.prog.CFX })')
    check(c4['pulse'] == c3['pulse'] + 1, f'deltas: the map pulses the world just played {c3} -> {c4}')
    # Free Mode: a solved Quick Play flips the band count in, a better best flashes, the streak's embers light the days
    await ev(page, "() => __debug.prog.showHome(-1)"); await page.wait_for_timeout(400)
    f0 = await ev(page, '() => ({ ...__fm.FMFX })')
    await ev(page, """() => { const st = __fm.state(), t = __fm.today().day; st.solved.gentle.push('q-gentle-001'); st.best.gentle = 61000;
      st.daily.solved[t] = 70000; st.daily.streak = 1; st.daily.lastDay = t; __fm.setState(st); }""")
    await press(page, '#home .key.free'); await page.wait_for_timeout(120)
    d1 = await ev(page, "() => ({ wait: document.querySelectorAll('.fm-day.fx-wait').length, latched: document.querySelectorAll('.fm-day.latched').length })")
    await page.wait_for_timeout(1200)
    f1 = await ev(page, '() => ({ ...__fm.FMFX, wait: document.querySelectorAll(".fm-day.fx-wait").length })')
    check(f1['flips'] == f0['flips'] + 1 and f1['best'] == f0['best'] + 1 and f1['embers'] == f0['embers'] + 1 and d1['wait'] == 1 and d1['latched'] >= 1 and f1['wait'] == 0,
          f'deltas: Free Mode flip + best flash + streak ember {d1} {f1}')
    await press(page, '.fm-back'); await page.wait_for_timeout(400)
    await press(page, '#home .key.free'); await page.wait_for_timeout(900)
    f2 = await ev(page, '() => ({ ...__fm.FMFX })')
    check(f2['flips'] == f1['flips'] and f2['embers'] == f1['embers'] and f2['best'] == f1['best'], f'deltas: second Free Mode visit static {f2}')
    notes.append(f'deltas: Home total 0->17 + expertise level 1->3 once; level list 17 pips + bar once, Master lock pop once; map pulse; Free Mode flip/best/ember once')
    check(not errs, f'deltas errors: {errs}')
    await ctx.close()

# ---------------------------------------------------------------------------
RECTS = """(sel) => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; })"""
async def t_layout(browser):
    for vp in [(390, 844), (375, 667)]:
        ctx, page, errs = await new_page(browser, vp=vp)
        home0 = await ev(page, RECTS, '#home .key, #home .home-card, #home .xp')
        await press(page, '#home .key.camp'); await page.wait_for_timeout(450)
        map0 = await ev(page, RECTS, '#campMap .key, #campMap .wcard')
        await press(page, '#campMap .key.wk[data-world="0"]'); await page.wait_for_timeout(450)
        w0 = await ev(page, RECTS, '#campWorld .key, #campWorld .mlock')
        await press(page, '#campWorld [data-level="0.1"]'); await page.wait_for_timeout(450)
        await press(page, '#homeBtn'); await page.wait_for_timeout(450)
        w1 = await ev(page, RECTS, '#campWorld .key, #campWorld .mlock')
        await press(page, '#campWorld .scr-bar .sbtn'); await page.wait_for_timeout(450)
        map1 = await ev(page, RECTS, '#campMap .key, #campMap .wcard')
        await press(page, '#campMap .scr-bar .sbtn'); await page.wait_for_timeout(450)
        # interrupted: forward then immediately back
        await press(page, '#home .key.free'); await page.wait_for_timeout(40); await press(page, '.fm-back'); await page.wait_for_timeout(450)
        home1 = await ev(page, RECTS, '#home .key:not(.cont), #home .home-card, #home .xp')
        home0b = [r for r, k in zip(home0, await ev(page, "() => [...document.querySelectorAll('#home .key, #home .home-card, #home .xp')].map(e => e.classList.contains('cont'))")) if not k]
        # Continue appears after a puzzle was played: compare Home without it against a fresh layout with it
        tag = f'{vp[0]}x{vp[1]}'
        check(map0 == map1, f'layout {tag}: map rects moved after transitions')
        check(w0 == w1, f'layout {tag}: level list rects moved after transitions')
        check(len(home1) == len(home0b), f'layout {tag}: Home element count changed')
        rel = await ev(page, "() => document.getElementById('home').classList.contains('nocont')")
        if rel: check(home1 == home0b, f'layout {tag}: Home rects moved after transitions')
        notes.append(f'layout {tag}: map ({len(map0)} rects), level list ({len(w0)}), Home ({len(home1)}) unchanged after expand/collapse and an interrupted pair')
        check(not errs, f'layout {tag} errors: {errs}')
        await ctx.close()

# ---------------------------------------------------------------------------
async def solve_campaign_level(page, w, k, mistakes=0, hints=0):
    await ev(page, f"() => __debug.prog.openWorld({w}, 0)"); await page.wait_for_timeout(350)
    await press(page, f'#campWorld [data-level="{w}.{k}"]'); await page.wait_for_timeout(420)
    last = await ev(page, """([m, h]) => { const S = __debug.S; let last = -1;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i]) last = i;
      for (let i = 0; i < 81; i++) if (S.values[i] !== S.sol[i] && i !== last) { S.values[i] = S.sol[i]; S.notes[i] = 0; }
      S.mistakes = m; S.paidHints = h; __debug.refresh(); return [last, S.sol[last]]; }""", [mistakes, hints])
    if await ev(page, '() => __debug.S.selected') != last[0]: await press(page, f'.cell[data-i="{last[0]}"]')
    await press(page, f'.key.digit[data-d="{last[1]}"]')
    await page.wait_for_function("() => document.getElementById('toast').classList.contains('show')", timeout=6000)

async def t_fx(browser):
    # results card: three even beats, then the bar, then the unlock (gate crossed by this solve)
    ctx, page, errs = await new_page(browser, '#camp=0.1', perms=['clipboard-read', 'clipboard-write'])
    await ev(page, "() => __debug.prog.devGate(0, 21)")     # Use it 6 at 0 -> 3 charges crosses 24
    await solve_campaign_level(page, 0, 12)
    t_show = await ev(page, '() => performance.now()')
    await page.wait_for_function("() => __debug.prog.RC.phase === 'unlock'", timeout=9000)
    rc = await ev(page, "() => ({ lands: __debug.prog.RC.lands, barEnd: __debug.prog.RC.barEnd, phase: __debug.prog.RC.phase, unlock: (document.querySelector('.rc-unlock') || {}).textContent, now: performance.now(), meterAnim: document.querySelector('#toast .rc-m .cm-fill').getAnimations().length, sp: document.getElementById('toast').style.transformOrigin })")
    await page.wait_for_function("() => __debug.prog.RC.phase === 'done'", timeout=4000)
    L = rc['lands']
    gaps = [L[i + 1] - L[i] for i in range(len(L) - 1)]
    check(len(L) == 3 and all(360 <= g <= 520 for g in gaps), f'fx: results card three even beats {L} gaps {gaps}')
    check(rc['unlock'] and 'Master unlocked' in rc['unlock'] and rc['now'] - L[-1] >= 280 + 360 + 520, f'fx: unlock beat after the bar {rc}')
    notes.append(f'fx: results card charges land {gaps} ms apart, bar ends ~{rc["barEnd"]} ms after the last cell + 280, then "{rc["unlock"].strip()}"')
    await page.screenshot(path=str(OUT / 'results-unlock-light.png'))
    # settings unlock: the badge spark into the sheet, the lock pops off the fresh tile
    await ev(page, '() => __debug.prog.hideToast()')
    await ev(page, '() => __debug.prog.devMaster(0)'); await page.wait_for_timeout(100)
    await ev(page, '() => __debug.prog.showHome(0)'); await page.wait_for_timeout(450)
    u0 = await ev(page, "() => ({ badge: __debug.prog.getProfile().flags.badge })")
    await press(page, '#home .key.set'); await page.wait_for_timeout(420)
    u1 = await ev(page, "() => ({ wait: document.querySelectorAll('#setSheet .fx-wait').length, bk: document.body.classList.contains('bk-fx'), sparks: __debug.prog.SPARKS.alive })")
    await page.wait_for_timeout(900)
    u2 = await ev(page, "() => ({ wait: document.querySelectorAll('#setSheet .fx-wait').length, pops: document.querySelectorAll('.set-pop').length, badge: __debug.prog.getProfile().flags.badge })")
    check(u0['badge'] and u1['wait'] >= 1 and u1['bk'] and u1['sparks'] >= 1 and u2['wait'] == 0 and not u2['badge'], f'fx: settings unlock (badge spark -> tile lock pop) {u0} {u1} {u2}')
    await page.keyboard.press('Escape'); await page.wait_for_timeout(350)
    # backup: copy pulse, load error shake, load bolt
    await ev(page, "() => __debug.backup.openSheet()"); await page.wait_for_timeout(450)
    await press(page, '#copyKey'); await page.wait_for_timeout(120)
    c1 = await ev(page, "() => ({ fx: __debug.FX.alive, top: document.body.classList.contains('fx-top') })")
    await page.wait_for_timeout(1100)
    c2 = await ev(page, "() => ({ ack: !!document.querySelector('.bk-ack'), top: document.body.classList.contains('fx-top'), msg: document.getElementById('tokMsg').textContent })")
    check(c1['fx'] >= 1 and c1['top'] and c2['ack'] and not c2['top'] and 'Copied' in c2['msg'], f'fx: copy pulse Copy key -> code box {c1} {c2}')
    await page.fill('#tokIn', 'SDK2.nonsense')
    await press(page, '#loadKey'); await page.wait_for_timeout(40)
    sh = await ev(page, "() => document.getElementById('tokIn').getAnimations().length")
    check(sh >= 1, 'fx: load error should shake the paste box')
    code = await ev(page, '() => __debug.backup.currentCode()')
    await page.fill('#tokIn', code); await press(page, '#loadKey'); await page.wait_for_timeout(60)
    b1 = await ev(page, "() => ({ sparks: __debug.prog.SPARKS.alive, fx: document.body.classList.contains('bk-fx') })")
    check(b1['sparks'] >= 1 and b1['fx'], f'fx: load success bolt {b1}')
    await page.wait_for_timeout(900)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
    # Challenge toggle: locks slide open, and closed again
    await ev(page, "() => { __debug.prog.nav('free'); }"); await page.wait_for_timeout(450)
    await press(page, '.fm-ch .set-toggle'); await page.wait_for_timeout(40)
    o = await ev(page, "() => document.querySelectorAll('.fm-block.opening').length")
    await page.wait_for_timeout(600)
    await press(page, '.fm-ch .set-toggle'); await page.wait_for_timeout(40)
    c = await ev(page, "() => document.querySelectorAll('.fm-block.closing').length")
    check(o >= 1 and c >= 1, f'fx: Challenge toggle locks open ({o}) and close ({c})')
    notes.append(f'fx: settings unlock badge spark + lock pop; copy pulse + box ring; load error shake; load bolt; Challenge locks open {o} / close {c}')
    check(not errs, f'fx errors: {errs}')
    await ctx.close()

# ---------------------------------------------------------------------------
FRAMES = """() => new Promise(res => { const d = []; let last = performance.now(), n = 0;
  window.__frames = d; window.__fstop = false;
  const f = now => { d.push(now - last); last = now; if (!window.__fstop) requestAnimationFrame(f); else res(d); };
  requestAnimationFrame(f); })"""
async def perf_run(browser, rate, rounds=3):
    ctx, page, errs = await new_page(browser)
    zero = await ev(page, '() => __debug.prog.seen()')      # seeded from the empty profile: every gain below animates
    await ev(page, "() => { __debug.prog.devMaster(0); __debug.prog.devGate(1, 21); }")   # world 1: 21 new pips + bar on its list
    cdp = await ctx.new_cdp_session(page)
    await cdp.send('Emulation.setCPUThrottlingRate', {'rate': rate})
    await page.wait_for_timeout(500)
    runs = [('Home -> map', ['#home .key.camp']), ('map -> level list', ['#campMap .key.wk[data-world="1"]']),
            ('level list -> puzzle', ['#campWorld [data-level="1.1"]']), ('puzzle -> level list', ['#homeBtn']),
            ('list -> map -> Home', ['#campWorld .scr-bar .sbtn', '#campMap .scr-bar .sbtn']),
            ('Home -> Free Mode', ['#home .key.free']), ('Free Mode -> Home', ['.fm-back'])]
    all_d, rows = [], []
    per = {name: [] for name, _ in runs}
    for rnd in range(rounds):
      # the same gains again each round (the "last seen" store reset to the empty profile)
      await ev(page, "(z) => { localStorage.setItem('sudoku.ui.v1', JSON.stringify(z)); __debug.prog.reloadSeen(); __debug.prog.showHome(0); }", zero)
      await page.wait_for_timeout(700)
      for name, seq in runs:
        dd = per[name]
        for sel in seq:
            await page.evaluate("() => { window.__fp = (" + FRAMES + ")(); }")
            await page.wait_for_timeout(50)
            await press(page, sel)
            await page.wait_for_timeout(450)
            d = await page.evaluate("async () => { window.__fstop = true; const d = await window.__fp; return d; }")
            dd += d[2:]      # drop the sampler's first frames
            await page.wait_for_timeout(300)
    for name, _ in runs:
        dd = sorted(x for x in per[name] if x > 0)
        avg = sum(dd) / len(dd); p95 = dd[int(len(dd) * 0.95) - 1]
        long_ = sum(1 for x in dd if x > 20)
        rows.append(f'{name}: avg {avg:.1f}, p95 {p95:.1f}, {long_}/{len(dd)} frames > 20 ms')
        all_d += dd
    all_d.sort()
    avg = sum(all_d) / len(all_d); p95 = all_d[int(len(all_d) * 0.95) - 1]
    check(not errs, f'perf x{rate} errors: {errs}')
    await ctx.close()
    return avg, p95, rows

async def t_perf(browser):
    """Frame times (rAF deltas) over each transition. This container has no GPU (software
    compositing, 2 cores), so the throttled run is dominated by the navigation frame itself
    (destination DOM + first raster), which the step-9 build shows too (p95 33.4 ms there).
    Each run does every transition 3 times with the same gains (the "last seen" store reset),
    so the level list fills 21 pips + its bar + the gate meter every round.
    Checks: unthrottled p95 < 20 ms; throttled p95 < 51 ms (at most two vsyncs; the step-9
    build measures avg ~20.3 / p95 33.4 ms throttled here, this build avg ~22.5 / p95 33-50)."""
    a1, p1, r1 = await perf_run(browser, 1)
    a4, p4, r4 = await perf_run(browser, 4)
    notes.append(f'perf unthrottled: avg {a1:.1f} ms, p95 {p1:.1f} ms | ' + '; '.join(r1))
    notes.append(f'perf CPU 4x: avg {a4:.1f} ms, p95 {p4:.1f} ms | ' + '; '.join(r4))
    check(p1 < 20, f'perf: unthrottled p95 {p1:.1f} ms >= 20 ms')
    check(p4 < 51, f'perf: throttled p95 {p4:.1f} ms >= 51 ms (more than two vsyncs)')

# ---------------------------------------------------------------------------
PAUSE = "(ms) => { for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = ms; } catch (e) {} } }"
PLAY = "() => { for (const a of document.getAnimations()) { try { a.play(); } catch (e) {} } }"
async def t_shots(browser):
    for scheme, rm in [('light', 'no-preference'), ('dark', 'no-preference'), ('light', 'reduce')]:
        tag = scheme + ('-rm' if rm == 'reduce' else '')
        ctx, page, errs = await new_page(browser, scheme=scheme, rm=rm, perms=['clipboard-read', 'clipboard-write'])
        async def mid(sel, name, ms):
            await press(page, sel); await ev(page, PAUSE, ms)
            await page.screenshot(path=str(OUT / f'mid-{name}-{tag}.png'))
            await ev(page, PLAY); await page.wait_for_timeout(650)
        await mid('#home .key.camp', 'home-map', 70)
        await mid('#campMap .key.wk[data-world="0"]', 'map-list', 70)
        await mid('#campWorld [data-level="0.1"]', 'list-puzzle', 70)
        await mid('#homeBtn', 'puzzle-list-back', 90)
        await mid('#campWorld .scr-bar .sbtn', 'list-map-back', 90)
        await mid('#campMap .scr-bar .sbtn', 'map-home-back', 90)
        await mid('#home .key.free', 'home-free', 70)
        await mid('.fm-back', 'free-home-back', 90)
        # gains since last seen: Home bars, a level list's pips + bar + Master lock, Free Mode ember
        await ev(page, '() => __debug.prog.hideScreens()'); await page.wait_for_timeout(350)
        await ev(page, """() => { const P = __debug.prog, ids = P.levelIds(0), p = P.getProfile(); ids.slice(1, 9).forEach(id => p.levels[id] = 3); p.expertise.points = 15; p.expertise.inner = 3; P.setProfile(p);
          const st = __fm.state(), t = __fm.today().day; st.solved.gentle.push('q-gentle-002'); st.best.gentle = 59000; st.daily.solved[t] = 70000; st.daily.streak = 1; st.daily.lastDay = t; __fm.setState(st); }""")
        await ev(page, '() => __debug.prog.showHome(0)'); await page.wait_for_timeout(420)
        await page.screenshot(path=str(OUT / f'home-gains-{tag}.png')); await page.wait_for_timeout(900)
        await ev(page, '() => __debug.prog.openWorld(0, 1)'); await page.wait_for_timeout(1500)
        await page.screenshot(path=str(OUT / f'list-gains-{tag}.png')); await page.wait_for_timeout(1400)
        await ev(page, '() => __debug.prog.showHome(-1)'); await page.wait_for_timeout(400)
        await press(page, '#home .key.free'); await page.wait_for_timeout(560 if rm != 'reduce' else 400)
        await page.screenshot(path=str(OUT / f'free-ember-{tag}.png')); await page.wait_for_timeout(900)
        await press(page, '.fm-back'); await page.wait_for_timeout(400)
        # settings unlock (mid pop) and backup copy (mid pulse)
        await ev(page, '() => __debug.prog.devMaster(0)'); await page.wait_for_timeout(100)
        await press(page, '#home .key.set'); await page.wait_for_timeout(980 if rm != 'reduce' else 520)
        await ev(page, PAUSE, 140); await page.screenshot(path=str(OUT / f'settings-unlock-{tag}.png')); await ev(page, PLAY)
        await page.wait_for_timeout(900); await page.keyboard.press('Escape'); await page.wait_for_timeout(350)
        await ev(page, "() => __debug.backup.openSheet()"); await page.wait_for_timeout(450)
        await press(page, '#copyKey'); await page.wait_for_timeout(200)
        await page.screenshot(path=str(OUT / f'backup-copy-{tag}.png'))
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / f'backup-copy-ack-{tag}.png'))
        await page.keyboard.press('Escape'); await page.wait_for_timeout(350)
        check(not errs, f'shots {tag} errors: {errs}')
        await ctx.close()
        # results card sequence: frames while the charges land, the bar fills, the unlock lights
        ctx, page, errs = await new_page(browser, '#camp=0.1', scheme=scheme, rm=rm)
        await ev(page, "() => __debug.prog.devGate(0, 21)")
        await solve_campaign_level(page, 0, 12)
        for i, at in enumerate([700, 1150, 1600, 2500, 3300]):
            await page.wait_for_timeout(at - (0 if i == 0 else [700, 1150, 1600, 2500, 3300][i - 1]))
            await page.screenshot(path=str(OUT / f'results-{i}-{tag}.png'))
        check(not errs, f'shots results {tag} errors: {errs}')
        await ctx.close()
    notes.append(f'shots: mid-transition frames, settings unlock, backup copy and the results sequence in {OUT}/ (light, dark, reduced motion)')

TESTS = {'nav': t_nav, 'interrupt': t_interrupt, 'reduced': t_reduced, 'deltas': t_deltas, 'layout': t_layout, 'fx': t_fx, 'perf': t_perf, 'shots': t_shots}

async def main():
    sel = [a for a in sys.argv[1:] if a in TESTS] or list(TESTS)
    srv = subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME)
            for name in sel:
                t0 = time.time()
                try: await TESTS[name](browser)
                except Exception as e: failures.append(f'{name}: exception {type(e).__name__}: {e}')
                print(f'  {name}: {time.time() - t0:.1f}s', flush=True)
            await browser.close()
    finally:
        srv.kill()
    for n in notes: print('NOTE', n)
    for f in failures: print('FAIL', f)
    print('PASS' if not failures else f'{len(failures)} FAILURE(S)')
    sys.exit(1 if failures else 0)

if __name__ == '__main__':
    asyncio.run(main())
