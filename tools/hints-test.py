#!/usr/bin/env python3
"""hints-test.py — UI tests for the hint ladder and check my thinking (Playwright).

    node tools/build.mjs && python3 tools/hints-test.py

Runs tools/test-hints.mjs (logic) first, then drives dist/ in Chrome:
ladder levels in order on a W3 Use it puzzle, paidHints, reset on board change,
missing note, wrong digit, Spot it, the no-step case, check claims (yes / no /
place / eliminate), board + mistakes unchanged by checks, locked claim types,
keyboard, persistence, and layout screenshots at 390x844 and 375x667 in
light / dark / reduced motion (written to /tmp/hints-shots/).
Exit code 1 on any failure.
"""
import asyncio, json, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/hints-shots'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = 8763

WRAP_SFX = """() => {
  const o = window.__debug.sfx; window.__sfxLog = [];
  for (const k of Object.keys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || typeof d.value !== 'function' || k === 'unlock') continue;
    const fn = d.value;
    o[k] = function (...a) { window.__sfxLog.push(k + (k === 'hint' ? '(' + a[0] + ')' : '')); return fn.apply(this, a); };
  }
}"""
BOARD_JS = "() => { const S = __debug.S; return { v: Array.from(S.values).join(''), n: Array.from(S.notes).join(','), m: S.mistakes, u: S.undo.length, sw: S.silentWrong, solved: S.solved } }"
HS = "() => __debug.hintState()"

failures, notes = [], []
def check(cond, msg):
    if not cond: failures.append(msg)
    return cond


async def new_page(browser, hash_, w=390, h=844, scheme='light', motion='no-preference', clear=True):
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, color_scheme=scheme, reduced_motion=motion)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{hash_}')
    await page.wait_for_function('() => window.__debug')
    if clear:
        await page.evaluate('() => localStorage.clear()')
        await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{hash_}'); await page.reload()
        await page.wait_for_function('() => window.__debug')
    await page.evaluate(WRAP_SFX)
    return ctx, page, errs


async def tap(page, sel, wait=380):
    b = await page.locator(sel).first.bounding_box()
    assert b, f'no box for {sel}'
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down(); await page.mouse.up()
    await page.wait_for_timeout(wait)

async def cell(page, i, wait=120): await tap(page, f'.cell[data-i="{i}"]', wait)
async def key(page, d, wait=150): await tap(page, f'.key.digit[data-d="{d}"]', wait)
async def hint(page, wait=420): await tap(page, '.key.hk', wait)
async def chk(page, wait=250): await tap(page, '.key.ckk', wait)
async def sfx_log(page, reset=True):
    log = await page.evaluate('() => window.__sfxLog.slice()')
    if reset: await page.evaluate('() => { window.__sfxLog.length = 0 }')
    return log
async def count(page, sel): return await page.locator(sel).count()


async def forward_to(page, techs, limit=200):
    """Tap the hint ladder through to level 4 (via the debug hook) until a hint
    names one of `techs`; leaves the ladder at level 1 of that hint."""
    for _ in range(limit):
        # always look at level 1 of a fresh hint (finish a ladder in progress first)
        s = await page.evaluate("() => { let s; do { __debug.hintTap(); s = __debug.hintState(); } while (s.level !== 1); return s; }")
        if s['kind'] == 'step' and s['step']['tech'] in techs: return s
        if s['kind'] != 'step': return s
        for _ in range(3): await page.evaluate('() => __debug.hintTap()')
        await page.wait_for_timeout(5)
    return None


async def test_ladder(browser):
    ctx, page, errs = await new_page(browser, '#p=w3-use-01')
    s = await forward_to(page, ['pointing', 'claiming'])
    if not check(s and s['kind'] == 'step' and s['step']['tech'] in ('pointing', 'claiming'), f'ladder: no pointing/claiming hint reached ({s})'):
        await ctx.close(); return
    await page.wait_for_timeout(1700)
    st = s['step']; paid0 = s['paidHints']
    check(s['level'] == 1 and ('Pointing pattern' in s['coach'] or 'Claiming pattern' in s['coach']), f'L1 text: {s["coach"]}')
    check(await count(page, '.cell .hl.u') == 0 and await count(page, '.cell .hx span.on') == 0, 'L1 must not show board visuals')
    await sfx_log(page)
    b0 = await page.evaluate(BOARD_JS)
    # level 2 (real tap on the Hint keycap)
    await hint(page)
    s2 = await page.evaluate(HS); log2 = await sfx_log(page)
    check(s2['level'] == 2 and s2['coach'].startswith('Look in ') and s2['paidHints'] == paid0, f'L2: {s2["level"]} "{s2["coach"]}" paid {s2["paidHints"]}')
    check(await count(page, '.cell .hl.u') == 9, f'L2 unit tint cells: {await count(page, ".cell .hl.u")}')
    check('hint(2)' in log2 and 'mod' in log2, f'L2 sounds: {log2}')
    await page.screenshot(path=str(OUT / 'ladder-L2.png'))
    # level 3
    await hint(page, 900)
    s3 = await page.evaluate(HS); log3 = await sfx_log(page)
    check(s3['level'] == 3 and s3['paidHints'] == paid0 + 1, f'L3: level {s3["level"]} paid {s3["paidHints"]} (want {paid0 + 1})')
    check(await count(page, '.cell .hl.p') == len(st['pattern']), f'L3 pattern outlines {await count(page, ".cell .hl.p")} vs {len(st["pattern"])}')
    check(await count(page, '.cell .hx span.on') == len(st['eliminate']), f'L3 struck candidates {await count(page, ".cell .hx span.on")} vs {len(st["eliminate"])}')
    check('hint(3)' in log3, f'L3 sounds: {log3}')
    check(await page.evaluate(BOARD_JS) == b0, 'L1-L3 must not change the board')
    await page.screenshot(path=str(OUT / 'ladder-L3.png'))
    # level 4: the move is applied
    await hint(page, 500)
    s4 = await page.evaluate(HS); log4 = await sfx_log(page)
    b4 = await page.evaluate(BOARD_JS)
    notes4 = [int(x) for x in b4['n'].split(',')]
    gone = all(not (notes4[c] & (1 << (d - 1))) for c, d in st['eliminate'])
    noted = all(notes4[c] for c, d in st['eliminate'])
    check(s4['level'] == 4 and s4['paidHints'] == paid0 + 2, f'L4: level {s4["level"]} paid {s4["paidHints"]} (want {paid0 + 2})')
    check(gone and noted and b4['u'] == b0['u'] + 1 and b4['v'] == b0['v'], f'L4 must remove exactly the candidates (as notes), one undo step: gone={gone} noted={noted} undo {b0["u"]}->{b4["u"]}')
    check(not any(x.startswith('hint(') for x in log4) and ('scratch' in log4 or 'flick' in log4), f'L4 sounds (normal elimination sounds, no hint sound): {log4}')
    check(len(s4['coach']) > 30 and 'Pointing' not in s4['coach'][:10], f'L4 reason text: {s4["coach"]}')
    await page.screenshot(path=str(OUT / 'ladder-L4.png'))
    # next tap starts a new ladder at level 1
    await hint(page)
    s5 = await page.evaluate(HS)
    check(s5['level'] == 1 and s5['paidHints'] == paid0 + 2, f'after L4 the next tap is level 1 of a new hint: {s5["level"]}')
    notes.append(f'ladder: {st["tech"]} on w3-use-01, L1 "{s["coach"]}" -> L2 "{s2["coach"]}" -> L3 ({len(st["pattern"])} outlines, {len(st["eliminate"])} struck) -> L4 applied "{s4["coach"][:60]}...", paidHints {paid0}->{s4["paidHints"]}')

    # placement step at level 4 places the digit (accent fill), paid +2
    s = await forward_to(page, ['hidden-single-box', 'hidden-single-line', 'full-house', 'naked-single'])
    await page.wait_for_timeout(1700)
    p0 = s['paidHints']; cellp, dig = s['step']['place']['cell'], s['step']['place']['digit']
    await sfx_log(page)
    for _ in range(3): await hint(page, 300)
    sp = await page.evaluate(HS); bp = await page.evaluate(BOARD_JS); logp = await sfx_log(page)
    check(bp['v'][cellp] == str(dig) and sp['paidHints'] == p0 + 2 and await count(page, '.cell .hl.f') == 1, f'placement L4: digit {bp["v"][cellp]} vs {dig}, paid {sp["paidHints"]} vs {p0 + 2}')
    check('pen' in logp, f'placement L4 uses the pen sound: {logp}')

    # board change resets the ladder
    await page.wait_for_timeout(1700)
    await hint(page); await hint(page)
    sr = await page.evaluate(HS)
    check(sr['level'] == 2 and await count(page, '.cell .hl.u') == 9, f'reset setup: level {sr["level"]}')
    sol = await page.evaluate("() => Array.from(__debug.S.sol)")
    vals = (await page.evaluate(BOARD_JS))['v']
    target = sr['step']['place']['cell'] if sr['step'] and sr['step']['place'] else None
    empty = next(i for i in range(81) if vals[i] == '0' and i != target)
    await cell(page, empty); await key(page, sol[empty], 300)
    sr2 = await page.evaluate(HS)
    check(sr2['level'] == 0 and await count(page, '.cell .hl.u') == 0 and sr2['coach'] == '', f'board change must reset the ladder: {sr2["level"]} "{sr2["coach"]}"')
    await hint(page)
    sr3 = await page.evaluate(HS)
    check(sr3['level'] == 1, f'after a reset the next tap is level 1: {sr3["level"]}')
    notes.append(f'reset: placing a digit at r{empty // 9 + 1}c{empty % 9 + 1} cleared the level-2 hint; next tap = level 1')

    # paidHints is saved in the meta and comes back on reload
    paid = (await page.evaluate(HS))['paidHints']
    await page.wait_for_timeout(400)
    await page.reload(); await page.wait_for_function('() => window.__debug')
    paid_r = (await page.evaluate(HS))['paidHints']
    meta = await page.evaluate("() => JSON.parse(localStorage.getItem('sudoku.meta.v1.w3-use-01'))")
    check(paid_r == paid and meta.get('paidHints') == paid, f'paidHints persistence: {paid} -> {paid_r}, meta {meta}')
    notes.append(f'paidHints persisted in sudoku.meta.v1.<id>: {meta}')
    check(not errs, f'ladder errors: {errs}')
    await ctx.close()


async def test_missing_and_wrong(browser):
    ctx, page, errs = await new_page(browser, '#p=w2-use-03')
    info = await page.evaluate("""() => {
      const D = __debug, S = D.S, c = D.solver.computeCands(S.values);
      for (let i = 0; i < 81; i++) if (!S.values[i] && D.solver.popcount(c[i]) >= 3) return { i, cands: D.solver.digitsOf(c[i]), sol: S.sol[i] };
    }""")
    i, sol = info['i'], info['sol']
    # pencil the candidates except the solution digit, through the UI
    await cell(page, i); await tap(page, '.pad .key.mod[aria-label="Pencil"]', 150)
    for d in info['cands']:
        if d != sol: await key(page, d, 80)
    await tap(page, '.pad .key.mod[aria-label="Pencil"]', 150)
    await page.wait_for_timeout(300); await sfx_log(page)
    await hint(page)
    s1 = await page.evaluate(HS)
    name = f'r{i // 9 + 1}c{i % 9 + 1}'
    check(s1['kind'] == 'missing' and s1['coach'] == f'Your notes are missing a {sol} in {name}.', f'missing L1: {s1["kind"]} "{s1["coach"]}"')
    await hint(page)
    check(await page.locator(f'.cell[data-i="{i}"] .hl.t').count() == 1, 'missing L2 must show the cell')
    p0 = (await page.evaluate(HS))['paidHints']
    await sfx_log(page)
    await hint(page, 500)
    s3 = await page.evaluate(HS); log = await sfx_log(page)
    n = int((await page.evaluate(BOARD_JS))['n'].split(',')[i])
    check(n & (1 << (sol - 1)) and s3['paidHints'] == p0 + 1 and 'scratch' in log, f'missing L3 restores the note (pencil): note={n}, paid {p0}->{s3["paidHints"]}, sfx {log}')
    await page.screenshot(path=str(OUT / 'missing-L3.png'))
    notes.append(f'missing note: "{s1["coach"]}" -> L2 outlines {name} -> L3 restored with the pencil effect (paid +1)')

    # wrong digit (no clash): ladder finds it, level 4 erases it
    await page.wait_for_timeout(1700)
    w = await page.evaluate("""() => { const S = __debug.S;
      for (let i = 0; i < 81; i++) if (!S.values[i]) for (let d = 1; d <= 9; d++) {
        if (d === S.sol[i]) continue;
        let clash = false; for (let j = 0; j < 81; j++) if (j !== i && S.values[j] === d && ((j/9|0) === (i/9|0) || j%9 === i%9 || ((j/27|0) === (i/27|0) && ((j%9)/3|0) === ((i%9)/3|0)))) clash = true;
        if (!clash) return { i, d };
      } }""")
    if (await page.evaluate('() => __debug.S.selected')) != w['i']: await cell(page, w['i'])
    await key(page, w['d'], 400)
    m0 = (await page.evaluate(BOARD_JS))['m']
    for _ in range(4): await hint(page, 350)
    sw = await page.evaluate(HS); bw = await page.evaluate(BOARD_JS)
    check(sw['kind'] == 'wrong' and bw['v'][w['i']] == '0' and bw['m'] == m0, f'wrong digit ladder: {sw["kind"]}, cell now {bw["v"][w["i"]]}, mistakes {m0}->{bw["m"]}')
    notes.append(f'wrong digit: ladder named it, level 4 erased the {w["d"]} in r{w["i"] // 9 + 1}c{w["i"] % 9 + 1} (no mistake added)')
    check(not errs, f'missing/wrong errors: {errs}')
    await ctx.close()


async def test_spot_and_none(browser):
    ctx, page, errs = await new_page(browser, '#p=w3-spot-01')
    stored = await page.evaluate('() => __debug.S.spot.step')
    await hint(page)
    s1 = await page.evaluate(HS)
    check(s1['step'] and s1['step']['tech'] == stored['tech'] and s1['step']['eliminate'] == stored['eliminate'], f'Spot it hint must go to the target step: {s1["step"]} vs {stored["tech"]}')
    for _ in range(3): await hint(page, 400)
    await page.wait_for_timeout(1200)
    st = await page.evaluate("() => ({ solved: __debug.S.solved, toast: document.getElementById('toast').classList.contains('show'), title: document.getElementById('toastTitle').textContent })")
    check(st['solved'] and st['toast'] and st['title'] == 'Spotted it', f'Spot it level 4 must complete the item: {st}')
    notes.append(f'Spot it w3-spot-01: L1 "{s1["coach"]}", level 4 -> "{st["title"]}"')
    await ctx.close()

    # no step within the unlocked techniques: honest message, no crash, free
    ctx, page, errs = await new_page(browser, '#p=w0-use-01')
    found = None
    for item in ['w0-use-01', 'w0-use-02', 'w0-use-03', 'w0-use-04', 'w0-use-05', 'w0-use-06']:
        await page.evaluate(f"() => __debug.startPuzzle('{item}', false)")
        s = await forward_to(page, ['__none__'])
        if s and s['kind'] == 'none': found = (item, s); break
    if check(found, 'no-step case: no W0 Use it puzzle ran out of full houses'):
        item, s = found
        p0 = s['paidHints']
        await hint(page); s2 = await page.evaluate(HS)
        check(s2['kind'] == 'none' and "No move with the techniques you've learned" in s2['coach'] and s2['paidHints'] == p0, f'none: {s2}')
        await page.screenshot(path=str(OUT / 'no-step.png'))
        notes.append(f'no step ({item}, W0 = full house only): "{s2["coach"]}"')
    check(not errs, f'spot/none errors: {errs}')
    await ctx.close()


async def claim(page, cells_, claim_id, digits=()):
    """Enter check mode (if needed), select cells, pick a claim, type digits."""
    hs = await page.evaluate(HS)
    if not hs['check']['on']: await chk(page)
    hs = await page.evaluate(HS)
    for c in hs['check']['cells']:
        if c not in cells_: await cell(page, c)
    hs = await page.evaluate(HS)
    for c in cells_:
        if c not in hs['check']['cells']: await cell(page, c)
    await chk(page, 420)
    await tap(page, f'.sheet.ck .key[data-claim="{claim_id}"]', 420)
    for d in digits: await key(page, d, 150)
    await page.wait_for_timeout(250)
    return await page.evaluate(HS)


async def test_check(browser):
    ctx, page, errs = await new_page(browser, '#p=w4-spot-01')
    st = await page.evaluate('() => __debug.S.spot.step')
    check(st['tech'] == 'naked-pair', f'w4-spot-01 should be a naked pair: {st["tech"]}')
    b0 = await page.evaluate(BOARD_JS)
    await sfx_log(page)
    s = await claim(page, st['pattern'], 'naked-pair')
    log = await sfx_log(page)
    last = s['check']['last']
    check(last and last['ok'] and last['text'].startswith('Yes — ') and 'naked pair' in last['text'], f'naked pair yes: {last}')
    check('checkYes' in log and 'error' not in log, f'right claim sound: {log}')
    await page.screenshot(path=str(OUT / 'check-yes.png'))
    notes.append(f'check yes: "{last["text"]}"')
    # wrong pair: first pattern cell + another empty cell of the unit
    other = await page.evaluate("""(st) => { const S = __debug.S, u = st.unit, D = __debug.solver;
      const cellsOf = D.units[(u.type === 'row' ? 0 : u.type === 'col' ? 9 : 18) + u.index];
      return cellsOf.find(i => !S.values[i] && !st.pattern.includes(i)); }""", st)
    s = await claim(page, [st['pattern'][0], other], 'naked-pair')
    log = await sfx_log(page)
    last = s['check']['last']
    check(last and not last['ok'] and last['text'].startswith('Not a pair:'), f'naked pair no: {last}')
    check('checkNo' in log and 'error' not in log, f'wrong claim is gentle (no error clunk): {log}')
    await page.screenshot(path=str(OUT / 'check-no.png'))
    notes.append(f'check no: "{last["text"]}"')
    # place + eliminate claims
    sol = await page.evaluate('() => Array.from(__debug.S.sol)')
    e = next(i for i in range(81) if b0['v'][i] == '0')
    s = await claim(page, [e], 'place', [sol[e]]); l1 = s['check']['last']
    wrongd = next(d for d in range(1, 10) if d != sol[e])
    s = await claim(page, [e], 'place', [wrongd]); l2 = s['check']['last']
    s = await claim(page, [e], 'eliminate', [wrongd]); l3 = s['check']['last']
    s = await claim(page, [e], 'eliminate', [sol[e]]); l4 = s['check']['last']
    check(l1['ok'] and not l2['ok'] and l3['ok'] and not l4['ok'], f'place/eliminate claims: {[l1["text"], l2["text"], l3["text"], l4["text"]]}')
    notes.append(f'check place/eliminate: "{l1["text"]}" | "{l2["text"]}" | "{l3["text"]}" | "{l4["text"]}"')
    b1 = await page.evaluate(BOARD_JS)
    check(b1 == b0, f'checks must not change the board, mistakes or undo: {b0} vs {b1}')
    # Esc leaves check mode
    await page.keyboard.press('Escape'); await page.wait_for_timeout(150)
    check(not (await page.evaluate(HS))['check']['on'], 'Esc must leave check mode')
    check(await count(page, '.cell .hl.ck') == 0, 'dashed selection must clear on exit')
    check(not errs, f'check errors: {errs}')
    await ctx.close()

    # W1: only place / eliminate / hidden single are offered
    ctx, page, errs = await new_page(browser, '#p=w1-use-01')
    vals = (await page.evaluate(BOARD_JS))['v']
    e = vals.index('0')
    await chk(page); await cell(page, e); await chk(page, 420)
    offered = await page.evaluate("() => [...document.querySelectorAll('.sheet.ck .key[data-claim]')].map(k => k.dataset.claim)")
    check(offered == ['place', 'eliminate', 'hidden-single'], f'W1 claim types: {offered}')
    notes.append(f'W1 check sheet offers: {offered}')
    await page.screenshot(path=str(OUT / 'check-sheet-w1.png'))
    await tap(page, '.sheet.ck .key[data-act="stop"]')
    # keyboard: H = hint level 1, C = check, Esc = leave
    await page.keyboard.press('h'); await page.wait_for_timeout(200)
    kh = await page.evaluate(HS)
    await page.keyboard.press('c'); await page.wait_for_timeout(200)
    kc = await page.evaluate(HS)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
    ke = await page.evaluate(HS)
    check(kh['level'] == 1 and kc['check']['on'] and not ke['check']['on'], f'keyboard H/C/Esc: {kh["level"]} {kc["check"]["on"]} {ke["check"]["on"]}')
    # a hint never names a technique outside W1
    texts = []
    for _ in range(40):
        s = await page.evaluate("() => { __debug.hintTap(); return __debug.hintState(); }")
        texts.append(s['coach'])
        if s['kind'] != 'step': break
        for _ in range(3): await page.evaluate('() => __debug.hintTap()')
    bad = [t for t in texts if any(w in t.lower() for w in ('pair', 'pointing', 'claiming', 'naked'))]
    check(not bad, f'W1 hint named a locked technique: {bad[:3]}')
    check(not errs, f'W1 errors: {errs}')
    await ctx.close()


async def test_layout(browser):
    for (w, h) in [(390, 844), (375, 667)]:
        for scheme, motion in [('light', 'no-preference'), ('dark', 'no-preference'), ('light', 'reduce')]:
            tag = f'{w}x{h}-{scheme}{"-reduced" if motion == "reduce" else ""}'
            ctx, page, errs = await new_page(browser, '#p=w3-use-01', w, h, scheme, motion)
            boxes = await page.evaluate("""() => { const q = s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
              return { board: q('.board'), pad: q('.pad'), hk: q('.key.hk'), ck: q('.key.ckk'), coach: q('.hcoach'), hdr: q('.hdr'),
                       scroll: document.scrollingElement.scrollHeight, inner: innerHeight, layout: __debug.hintState().layout }; }""")
            b, p, hk, ck = boxes['board'], boxes['pad'], boxes['hk'], boxes['ck']
            check(boxes['scroll'] <= boxes['inner'], f'{tag}: page scrolls ({boxes["scroll"]} > {boxes["inner"]})')
            check(boxes['layout'] == 'bar', f'{tag}: keys should sit between board and pad, got {boxes["layout"]}')
            check(hk[1] >= b[3] - 0.5 and hk[3] <= p[1] + 0.5 and ck[1] >= b[3] - 0.5 and ck[3] <= p[1] + 0.5 and ck[2] <= b[2] + 0.5 and hk[2] <= ck[0],
                  f'{tag}: Hint/Check keys overlap the board or pad: board {b} pad {p} hint {hk} check {ck}')
            await page.screenshot(path=str(OUT / f'{tag}-idle.png'))
            s = await forward_to(page, ['pointing', 'claiming'])
            await page.wait_for_timeout(1700)
            await hint(page); await hint(page, 1000)
            await page.screenshot(path=str(OUT / f'{tag}-hint-L3.png'))
            await hint(page, 700)
            await page.screenshot(path=str(OUT / f'{tag}-hint-L4.png'))
            await chk(page)
            vals = (await page.evaluate(BOARD_JS))['v']
            empties = [i for i in range(81) if vals[i] == '0'][:2]
            for c in empties: await cell(page, c)
            await page.screenshot(path=str(OUT / f'{tag}-check-select.png'))
            await chk(page, 450)
            await page.screenshot(path=str(OUT / f'{tag}-check-sheet.png'))
            sheet = await page.evaluate("() => { const r = document.querySelector('.sheet.ck').getBoundingClientRect(); return [r.top, r.bottom, innerHeight]; }")
            check(sheet[0] >= 0 and sheet[1] <= sheet[2] + 1, f'{tag}: check sheet does not fit: {sheet}')
            await tap(page, '.sheet.ck .key[data-claim="locked"]', 300)
            await key(page, 1, 400)
            await page.screenshot(path=str(OUT / f'{tag}-check-result.png'))
            check(not errs, f'{tag} errors: {errs}')
            await ctx.close()
    # wide desktop: the band is too thin, the keys move to the header
    ctx, page, errs = await new_page(browser, '#p=w3-use-01', 1280, 720)
    lay = (await page.evaluate(HS))['layout']
    await hint(page); await hint(page)
    await page.screenshot(path=str(OUT / '1280x720-header-fallback.png'))
    check(lay == 'header' and not errs, f'1280x720 fallback layout: {lay} {errs}')
    await ctx.close()
    notes.append(f'layout screenshots in {OUT} (390x844 + 375x667, light/dark/reduced; 1280x720 header fallback)')


async def main():
    r = subprocess.run(['node', str(ROOT / 'tools/test-hints.mjs')], capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode: failures.append('tools/test-hints.mjs failed')
    assert (DIST / 'index.html').exists(), 'run node tools/build.mjs first'
    server = subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(0.6)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            for t in (test_ladder, test_missing_and_wrong, test_spot_and_none, test_check, test_layout):
                try: await t(browser)
                except Exception as e: failures.append(f'{t.__name__} crashed: {e!r}')
            await browser.close()
    finally:
        server.terminate()
    print('\nUI')
    for n in notes: print('  ' + n)
    if failures:
        print(f'\nFAIL ({len(failures)})')
        for f in failures: print('  - ' + f)
        sys.exit(1)
    print('\nPASS')


if __name__ == '__main__':
    asyncio.run(main())
