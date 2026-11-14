#!/usr/bin/env python3
"""parity-test.py — the game shell (game/dist) must feel identical to the
feel prototype (/home/claude/sudoku/pwa), then the game-flow tests.

    python3 tools/parity-test.py            # build first: node tools/build.mjs
    python3 tools/parity-test.py --parity   # parity only
    python3 tools/parity-test.py --flow     # flow tests only

Parity: the same interaction script runs on both pages, under three settings
(light, dark, reduced motion). Both pages get the same seeded Math.random, a
Playwright fake clock (timers, rAF, performance.now: the particle engine
advances only when the test advances the clock), and a frozen animation
timeline (CDP Animation.setPlaybackRate 0; at each screenshot moment every
running animation is set to the same currentTime). Compared per run:
  (a) final state: values, notes, mistakes, solved, selection, loaded digit, pencil, undo depth
      (also compared after every step)
  (b) the ordered list of sfx calls with their arguments (the methods of the sfx
      object are wrapped; the build exposes it at window.__debug.sfx with ?debug=1)
  (c) screenshots at the same moments, pixel diff, header row masked
  (d) page errors and console errors/warnings
Flow tests (build only): see run_flow().
Exit code 1 on any failure. Screenshots and diffs go to /tmp/parity/.
"""
import asyncio, json, os, subprocess, sys, time, random
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
PROTO_DIR = Path('/home/claude/sudoku/pwa')
DIST = ROOT / 'dist'
OUT = Path('/tmp/parity'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
P_PROTO, P_BUILD = int(os.environ.get('PARITY_PROTO_PORT', 8761)), int(os.environ.get('PARITY_PORT', 8762))   # step7: env override
VIEW = {'width': 390, 'height': 844}
HEADER_PX = 54          # header band (padding 8 + 44 high) is allowed to differ (DEV puzzle id)
PIXEL_TOL = 10          # per-channel tolerance for anti-aliasing noise
SHOT_LIMIT = 0.05       # % of non-header pixels allowed to differ per screenshot

PUZ = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'
SOL = '534678912672195348198342567859761423426853791713924856961537284287419635345286179'

SEED_JS = """(() => {
  let a = 0x2F6B1D3;
  window.__rc = 0;   // Math.random call count: both pages must consume randomness identically
  Math.random = function () {
    window.__rc++;
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();"""

WRAP_SFX = """() => {
  const o = window.__debug ? window.__debug.sfx : sfx;
  window.__sfxLog = [];
  for (const k of Object.keys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || typeof d.value !== 'function' || k === 'unlock') continue;
    const fn = d.value;
    o[k] = function (...args) { window.__sfxLog.push(k + '(' + args.map(x => typeof x === 'number' ? +x.toFixed(4) : x).join(',') + ')'); return fn.apply(this, args); };
  }
}"""

STATE_JS = """() => {
  const s = window.__debug ? window.__debug.S : S;
  return { values: Array.from(s.values).join(''), notes: Array.from(s.notes).join(','), mistakes: s.mistakes,
           solved: s.solved, selected: s.selected, loaded: s.loaded, loadedNote: s.loadedNote, pencil: s.pencil,
           undo: s.undo.length, rc: window.__rc, mistShown: document.getElementById('mist').textContent,
           status: document.getElementById('status').textContent,
           toast: document.getElementById('toast').classList.contains('show'),
           sheet: document.getElementById('sheet').classList.contains('show') };
}"""

FINISH_JS = "() => { let n = 0; for (const a of document.getAnimations()) { try { a.finish(); n++; } catch (e) {} } return n; }"
FREEZE_AT_JS = "(t) => { for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = t; } catch (e) {} } return document.getAnimations().length; }"


def start_server(d, port):
    return subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(d), '--port', str(port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


class Page:
    """One page under test plus the helpers the scripts use."""
    def __init__(self, name, page, cdp):
        self.name, self.pg, self.cdp = name, page, cdp
        self.errors, self.shots, self.states = [], [], []

    async def box(self, sel):
        b = await self.pg.locator(sel).first.bounding_box()
        assert b, f'{self.name}: no box for {sel}'
        return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2

    async def align(self):
        """Put performance.now() on the fake clock's 16 ms frame grid before each
        input. The two pages' performance.now() origins can differ by ~1 ms (page
        load), which would shift the particle engine's frame phase."""
        pn = await self.pg.evaluate('() => performance.now()')
        if pn % 16: await self.pg.clock.run_for(16 - pn % 16)

    async def kbd(self, key):
        await self.align()
        await self.pg.keyboard.press(key)

    async def click_at(self, x, y):
        await self.align()
        await self.pg.mouse.click(x, y)

    async def down(self, sel, dx=0, dy=0):
        await self.align()
        x, y = await self.box(sel)
        await self.pg.mouse.move(x + dx, y + dy)
        await self.pg.mouse.down()

    async def up(self):
        await self.pg.mouse.up()

    async def tap(self, sel, dx=0, dy=0, hold=0):
        await self.down(sel, dx, dy)
        if hold: await self.pg.clock.run_for(hold)
        await self.up()

    async def cell(self, i, hold=0):
        await self.tap(f'.cell[data-i="{i}"]', dx=3, dy=-2, hold=hold)

    async def key(self, d, hold=0):
        await self.tap(f'.key.digit[data-d="{d}"]', hold=hold)

    async def mod(self, label, hold=0):
        await self.tap(f'.pad .key.mod[aria-label="{label}"]', hold=hold)

    async def settle(self):
        """Let every effect run to its end, deterministically."""
        for _ in range(3):
            await self.pg.evaluate(FINISH_JS)
            await self.pg.wait_for_timeout(25)
            await self.pg.clock.run_for(1500)
        await self.pg.evaluate(FINISH_JS)
        await self.pg.wait_for_timeout(25)

    async def moment(self, tag, clock_ms=90, anim_ms=70):
        """Advance the fake clock (timers + particle frames), pin every animation
        to the same currentTime, take a screenshot."""
        await self.pg.clock.run_for(clock_ms)
        await self.pg.evaluate(FREEZE_AT_JS, anim_ms)
        await self.pg.wait_for_timeout(30)
        path = OUT / f'{self.run}-{len(self.shots):02d}-{tag}-{self.name}.png'
        await self.pg.screenshot(path=str(path))
        self.shots.append((tag, path))

    async def state(self, tag):
        st = await self.pg.evaluate(STATE_JS)
        self.states.append((tag, st))
        return st


async def open_page(browser, name, url, scheme, motion):
    ctx = await browser.new_context(viewport=VIEW, device_scale_factor=1, color_scheme=scheme,
                                    reduced_motion=motion, permissions=['clipboard-read', 'clipboard-write'])
    page = await ctx.new_page()
    await page.add_init_script(SEED_JS)
    await page.clock.install(time=1_767_000_000_000)
    await page.clock.pause_at(1_767_000_010_000)    # virtual time only moves when the test says so
    P = Page(name, page, None)
    page.on('pageerror', lambda e: P.errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: P.errors.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    await page.goto(url)
    await page.wait_for_load_state('load')
    await page.clock.run_for(50)
    P.cdp = await ctx.new_cdp_session(page)
    await P.cdp.send('Animation.enable')
    await P.cdp.send('Animation.setPlaybackRate', {'playbackRate': 0})
    await page.evaluate(WRAP_SFX)
    return ctx, P


# ---------------------------------------------------------------------------
# The interaction script (identical for both pages)
# ---------------------------------------------------------------------------
async def script(P):
    st = P.state
    await P.moment('boot'); await P.settle(); await st('boot')

    # 1. cell-first placement: r1c3 <- 4 (correct)
    await P.cell(2); await P.moment('select', 60, 60)
    await P.key(4); await P.moment('place-cellfirst'); await P.settle(); await st('cellfirst')

    # 2. undo it (lift into the Undo key), deselect by tapping empty space,
    #    then number-first: load 6 (pulse to every 6), place r1c4, unload
    await P.mod('Undo'); await P.moment('undo-lift', 120, 90); await P.settle()
    await P.click_at(195, 110); await P.settle(); await st('released')
    await P.key(6); await P.moment('load-6', 120, 100)
    await P.cell(3); await P.moment('place-numberfirst'); await P.settle(); await st('numberfirst')
    await P.key(6); await P.settle(); await st('unload')

    # 3. long-press note: select r1c6, hold 2 -> note 2
    await P.cell(5); await P.settle()
    await P.key(2, hold=420); await P.moment('longpress-note', 40, 50); await P.settle(); await st('longpress')

    # 4. pencil toggle + notes: 8 and 1 in, 1 out again
    await P.mod('Pencil'); await P.moment('pencil-on', 120, 110); await P.settle()
    await P.key(8); await P.moment('note-8', 60, 60); await P.settle()
    await P.key(1); await P.settle()
    await P.key(1); await P.moment('note-1-off', 50, 50); await P.settle(); await st('pencil-notes')
    # notes in peers for the cleanup ripple
    await P.cell(6); await P.key(8); await P.key(9); await P.settle()
    await P.cell(7); await P.key(8); await P.key(1); await P.settle()
    await P.cell(14); await P.key(8); await P.settle()   # r2c6 is a given (5): blocked
    await P.cell(23); await P.key(8); await P.settle()   # r3c6 <- note 8 (column + box peer of r1c6)
    await P.mod('Pencil'); await P.settle(); await st('peer-notes')

    # 5. cleanup ripple: r1c6 <- 8 removes 8 from r1c7, r1c8, r3c6
    await P.cell(5); await P.key(8); await P.moment('ripple', 110, 90); await P.settle(); await st('ripple')

    # 6. a clash: r1c9 <- 5 (5 is given in row 1)
    await P.cell(8); await P.key(5); await P.moment('clash', 200, 160); await P.settle(); await st('clash')

    # 7. erase the digit, then erase a notes cell
    await P.mod('Erase'); await P.moment('erase-digit', 100, 100); await P.settle()
    await P.cell(6); await P.mod('Erase'); await P.moment('erase-notes', 100, 100); await P.settle(); await st('erase')

    # 8. undo (notes come back), undo again (the 5 comes back), keyboard redo of the erase
    await P.mod('Undo'); await P.moment('undo-notes', 120, 90); await P.settle()
    await P.mod('Undo'); await P.moment('undo-digit', 120, 90); await P.settle(); await st('undo')
    await P.cell(8); await P.settle()
    await P.kbd('Backspace'); await P.settle(); await st('kbd-erase')

    # keyboard: arrows + digit
    await P.kbd('ArrowLeft'); await P.kbd('ArrowLeft'); await P.settle()
    await P.kbd('9'); await P.settle(); await st('kbd-place')  # r1c7 <- 9

    # 9. complete row 1: r1c3 4, r1c8 1, r1c9 2
    await P.cell(2); await P.key(4); await P.settle()
    await P.cell(7); await P.key(1); await P.settle()
    await P.cell(8); await P.key(2); await P.moment('row-complete', 260, 200); await P.settle(); await st('row')

    # 10. solve the whole puzzle through the UI (last move captured mid-cascade)
    st0 = await P.pg.evaluate(STATE_JS)
    vals = st0['values']
    todo = [i for i in range(81) if vals[i] == '0']
    for k, i in enumerate(todo):
        await P.cell(i); await P.key(int(SOL[i]))
        if k == len(todo) - 1:
            await P.moment('cascade', 300, 260)
        await P.settle()
    await P.pg.clock.run_for(1500); await P.settle()
    await P.moment('solved-toast', 10, 400); await P.settle(); await st('solved')

    # 11. (step 9) the prototype's token sheet (SDK1, one board) became the Backup code
    # sheet (SDK2, the whole profile): a deliberate difference, so it is no longer compared
    # here. tools/token-test.py covers the sheet, Copy / Load / Undo and SDK1 codes.
    await st('final')
    P.sfx = await P.pg.evaluate("() => window.__sfxLog")


def pixel_diff(a, b, tag, masks=()):
    A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if A.size != B.size: return 100.0, None
    W, H = A.size
    d = ImageChops.difference(A, B).point(lambda v: 255 if v > PIXEL_TOL else 0)
    # --- hints: extra masked areas (the build's Hint / Check band, see docs/hints.md) ---
    for (x0, y0, x1, y1) in masks:
        d.paste((0, 0, 0), (max(0, int(x0)), max(0, int(y0)), min(W, int(x1 + 0.999)), min(H, int(y1 + 0.999))))
    # --- end hints ---
    body = d.crop((0, HEADER_PX, W, H)).convert('L')
    hist = body.histogram()
    bad = sum(hist[1:])
    head_bad = sum(d.crop((0, 0, W, HEADER_PX)).convert('L').histogram()[1:])
    pct = 100.0 * bad / (W * (H - HEADER_PX))
    if bad:
        d.save(OUT / f'diff-{tag}.png')
    return pct, 100.0 * head_bad / (W * HEADER_PX)


async def run_parity(browser):
    failures, report = [], []
    for run, scheme, motion in [('light', 'light', 'no-preference'), ('dark', 'dark', 'no-preference'), ('reduced', 'light', 'reduce')]:
        pages = []
        for name, url in [('proto', f'http://127.0.0.1:{P_PROTO}/index.html?debug=1'),
                          ('build', f'http://127.0.0.1:{P_BUILD}/?debug=1&keys=classic#p=proto')]:   # keys=classic: the prototype's keycaps + clicks
            ctx, P = await open_page(browser, name, url, scheme, motion)
            P.run = run
            # --- hints: the band between board and pad holds the Hint / Check keys and the coach line (build only) ---
            if name == 'build':
                hint_mask = await P.pg.evaluate("() => { const e = document.querySelector('.hintbar'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
            # --- end hints ---
            t0 = time.time()
            await script(P)
            P.secs = time.time() - t0
            pages.append((ctx, P))
        (c1, a), (c2, b) = pages
        # (a) state after every step
        st_ok = len(a.states) == len(b.states) and all(x == y for x, y in zip(a.states, b.states))
        if not st_ok:
            for (ta, sa), (tb, sb) in zip(a.states, b.states):
                if sa != sb:
                    failures.append(f'[{run}] state differs at "{ta}": proto={sa} build={sb}'); break
        # (b) sfx sequence
        sfx_ok = a.sfx == b.sfx
        if not sfx_ok:
            k = next((k for k in range(min(len(a.sfx), len(b.sfx))) if a.sfx[k] != b.sfx[k]), min(len(a.sfx), len(b.sfx)))
            failures.append(f'[{run}] sfx differ at call #{k}: proto={a.sfx[k:k+3]} build={b.sfx[k:k+3]} (lengths {len(a.sfx)}/{len(b.sfx)})')
        # (c) screenshots
        diffs = []
        for (tag, pa), (tag2, pb) in zip(a.shots, b.shots):
            pct, head = pixel_diff(pa, pb, f'{run}-{tag}', [hint_mask] if hint_mask else [])  # hints: band mask
            diffs.append((tag, pct, head))
            if pct > SHOT_LIMIT: failures.append(f'[{run}] screenshot "{tag}" differs: {pct:.3f}% of board/pad pixels (see {OUT}/diff-{run}-{tag}.png)')
        # (d) errors
        for P in (a, b):
            for e in P.errors: failures.append(f'[{run}] {P.name}: {e}')
        final = b.states[-1][1]
        worst = max(diffs, key=lambda d: d[1])
        report.append({'run': run, 'steps': len(a.states), 'state_equal': st_ok, 'sfx_calls': (len(a.sfx), len(b.sfx)), 'sfx_equal': sfx_ok,
                       'shots': len(diffs), 'max_diff_pct': round(worst[1], 4), 'max_diff_at': worst[0],
                       'header_diff_pct_max': round(max(d[2] for d in diffs), 2),
                       'errors': len(a.errors) + len(b.errors), 'final_mistakes': final['mistakes'], 'secs': round(a.secs + b.secs, 1),
                       'hint_band_mask': [round(v) for v in hint_mask] if hint_mask else None})  # hints
        await c1.close(); await c2.close()
    return failures, report


# ---------------------------------------------------------------------------
# Flow tests (build only)
# ---------------------------------------------------------------------------
async def flow_page(browser, hash_=''):
    ctx = await browser.new_context(viewport=VIEW, device_scale_factor=1)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    await page.goto(f'http://127.0.0.1:{P_BUILD}/?debug=1{hash_}')
    await page.wait_for_function('() => window.__debug')
    return ctx, page, errs


async def ui_tap(page, sel, hold=0):
    b = await page.locator(sel).first.bounding_box()
    await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.mouse.down()
    if hold: await page.wait_for_timeout(hold)
    await page.mouse.up()


async def ui_cell(page, i):
    # tapping the selected cell again deselects it, so only tap when needed
    if await page.evaluate('() => window.__debug ? __debug.S.selected : -2') != i:
        await ui_tap(page, f'.cell[data-i="{i}"]')
async def ui_key(page, d): await ui_tap(page, f'.key.digit[data-d="{d}"]')
async def ui_mod(page, label): await ui_tap(page, f'.pad .key.mod[aria-label="{label}"]')

async def dbg(page, js, arg=None):
    return await page.evaluate(js, arg) if arg is not None else await page.evaluate(js)

async def wait_quiet(page, ms=60):
    await page.wait_for_timeout(ms)


async def run_flow(browser):
    failures, notes = [], []
    def check(cond, msg):
        if not cond: failures.append(msg)
        return cond

    # F1. every shipped puzzle loads through the dev loader, renders its givens, and the solution check works
    ctx, page, errs = await flow_page(browser, '#p=proto')
    res = await page.evaluate("""() => {
      const D = window.__debug, ids = D.allIds(), bad = [];
      const cells = D.cells;
      for (const id of ids) {
        if (!D.startPuzzle(id, false)) { bad.push(id + ': did not start'); continue; }
        const S = D.S, b = D.boardFor(id);
        for (let i = 0; i < 81; i++) {
          const want = b.values[i] ? String(b.values[i]) : '';
          if (cells[i].v.textContent !== want) { bad.push(id + ': cell ' + i + ' shows "' + cells[i].v.textContent + '"'); break; }
          if (cells[i].el.classList.contains('given') !== !!b.given[i]) { bad.push(id + ': given class ' + i); break; }
          if (S.mode === 'spot' && !b.values[i] && S.notes[i] !== b.notes[i]) { bad.push(id + ': notes ' + i); break; }
        }
        // solution consistent with the board, unique, and the solved check works
        for (let i = 0; i < 81; i++) if (b.values[i] && b.values[i] !== S.sol[i]) { bad.push(id + ': solution disagrees at ' + i); break; }
        if (S.mode === 'free') {
          if (D.solver.countSolutions(Array.from(S.given)) !== 1) bad.push(id + ': not unique');
          if (D.isSolvedBoard()) bad.push(id + ': solved at start');
          const keep = S.values.slice(); S.values.set(S.sol);
          if (!D.isSolvedBoard()) bad.push(id + ': solution not accepted');
          let e = 0; while (S.given[e]) e++;
          S.values[e] = S.sol[e] % 9 + 1;
          if (D.isSolvedBoard()) bad.push(id + ': wrong board accepted');
          S.values.set(keep);
        } else {
          // Spot it: the stored step must be among the accepted steps
          const st = D.entry(id).item.step, steps = S.spot.steps;
          const same = x => x.tech === st.tech && JSON.stringify(x.place) === JSON.stringify(st.place) &&
            JSON.stringify(x.eliminate.map(String).sort()) === JSON.stringify(st.eliminate.map(String).sort());
          if (!steps.some(same)) bad.push(id + ': stored step not accepted');
          if (steps.length < D.entry(id).item.alts) bad.push(id + ': fewer steps than alts');
        }
      }
      return { n: ids.length, bad: bad.slice(0, 20), nbad: bad.length,
               kinds: ids.reduce((m, id) => (m[D.entry(id).kind] = (m[D.entry(id).kind] || 0) + 1, m), {}) };
    }""")
    check(res['nbad'] == 0, f'F1 load-all: {res["nbad"]} failures: {res["bad"]}')
    notes.append(f'F1 loaded {res["n"]} puzzles via the dev loader {res["kinds"]}: {res["nbad"]} failures')
    check(not errs, f'F1 errors: {errs}')
    await ctx.close()

    # F2. solve 3 Use it puzzles through the real input path (cell-first, pointer)
    for pid in ['w0-use-01', 'w2-use-05', 'w4-use-12']:
        ctx, page, errs = await flow_page(browser, f'#p={pid}')
        sol = await dbg(page, '() => Array.from(__debug.S.sol)')
        vals = await dbg(page, '() => Array.from(__debug.S.values)')
        for i in range(81):
            if vals[i]: continue
            await ui_cell(page, i); await ui_key(page, sol[i])
        await page.wait_for_timeout(1600)
        st = await dbg(page, "() => ({ solved: __debug.S.solved, mistakes: __debug.S.mistakes, toast: document.getElementById('toast').classList.contains('show'), title: document.getElementById('toastTitle').textContent, status: document.getElementById('status').textContent })")
        check(st['solved'] and st['toast'] and st['mistakes'] == 0 and st['title'] == 'Solved', f'F2 {pid}: {st}')
        check(not errs, f'F2 {pid} errors: {errs}')
        notes.append(f'F2 {pid}: solved through the UI ({sum(1 for v in vals if not v)} placements), toast shown, mistakes {st["mistakes"]}')
        # autosave per id: reload restores the solved board
        await page.wait_for_timeout(400)
        await page.reload(); await page.wait_for_function('() => window.__debug')
        st2 = await dbg(page, '() => ({ id: __debug.S.id, solved: __debug.S.solved, filled: Array.from(__debug.S.values).every(v => v) })')
        check(st2 == {'id': pid, 'solved': True, 'filled': True}, f'F2 {pid}: autosave not restored after reload: {st2}')
        await ctx.close()

    # F3. dead end on purpose -> banner -> Rewind
    ctx, page, errs = await flow_page(browser, '#p=w2-use-03')
    plan = await page.evaluate("""() => {
      // greedy: wrong digits that never clash visibly, until isDeadEnd
      const D = window.__debug, v = Array.from(D.S.values), sol = D.S.sol, plan = [];
      const clash = (i, d) => { for (let j = 0; j < 81; j++) if (j !== i && v[j] === d && (((j/9)|0) === ((i/9)|0) || j%9 === i%9 || ((((j/9)|0)/3|0) === (((i/9)|0)/3|0) && ((j%9)/3|0) === ((i%9)/3|0)))) return true; return false; };
      // first two correct placements, so Rewind has a correct snapshot to go back to
      let placed = 0;
      for (let i = 0; i < 81 && placed < 2; i++) if (!v[i]) { v[i] = sol[i]; plan.push([i, sol[i], 'ok']); placed++; }
      // a few wrong digits that do not yet break the board (silent), then any non-clashing wrong digit
      for (let guard = 0; guard < 81 && !D.solver.isDeadEnd(v); guard++) {
        let done = false;
        const quiet = plan.length < 5;
        for (let pass = quiet ? 0 : 1; pass < 2 && !done; pass++)
          for (let i = 0; i < 81 && !done; i++) if (!v[i]) for (let d = 1; d <= 9; d++) if (d !== sol[i] && !clash(i, d)) {
            v[i] = d;
            if (pass === 0 && D.solver.isDeadEnd(v)) { v[i] = 0; continue; }
            plan.push([i, d, 'wrong']); done = true; break;
          }
        if (!done) break;
      }
      return { plan, dead: D.solver.isDeadEnd(v), conflicts: D.solver.findConflicts(v).length };
    }""")
    check(plan['dead'] and plan['conflicts'] == 0, f'F3 could not build a dead-end plan: {plan}')
    # notes in a cell that stays empty, to check they survive the rewind
    note_cell = await dbg(page, "(used) => { const v = __debug.S.values; for (let i = 80; i >= 0; i--) if (!v[i] && !used.includes(i)) return i; return -1; }", [p[0] for p in plan['plan']])
    sol_nc = await dbg(page, f'() => __debug.S.sol[{note_cell}]')
    await ui_cell(page, note_cell); await ui_mod(page, 'Pencil'); await ui_key(page, sol_nc); await ui_mod(page, 'Pencil')
    banner_seen_at = None
    for k, (i, d, kind) in enumerate(plan['plan']):
        await ui_cell(page, i); await ui_key(page, d)
        await page.wait_for_timeout(30)
        shown = await dbg(page, "() => document.getElementById('dead').classList.contains('show')")
        if shown and banner_seen_at is None: banner_seen_at = k
    await page.wait_for_timeout(300)
    before = await dbg(page, '() => ({ mistakes: __debug.S.mistakes, silent: __debug.S.silentWrong, dead: __debug.S.deadEnd })')
    n_wrong = sum(1 for p in plan['plan'] if p[2] == 'wrong')
    check(banner_seen_at == len(plan['plan']) - 1, f'F3 banner should appear exactly at the dead-end move (appeared at {banner_seen_at}, plan {len(plan["plan"])})')
    check(before['mistakes'] == 0 and before['silent'] == n_wrong and before['dead'], f'F3 before rewind: {before} (wrong placed {n_wrong})')
    vis = await page.locator('#dead .key').is_visible()
    check(vis, 'F3 Rewind key not visible')
    await page.screenshot(path=str(OUT / 'flow-deadend-banner.png'))
    await ui_tap(page, '#dead .key')
    await page.wait_for_timeout(700)
    after = await dbg(page, f"""() => {{ const S = __debug.S; let ok = true, placed = 0;
      for (let i = 0; i < 81; i++) if (S.values[i]) {{ if (S.values[i] !== S.sol[i]) ok = false; if (!S.given[i]) placed++; }}
      return {{ ok, placed, mistakes: S.mistakes, dead: S.deadEnd, banner: document.getElementById('dead').classList.contains('show'),
               note: !!(S.notes[{note_cell}] & (1 << ({sol_nc} - 1))), deadNow: __debug.solver.isDeadEnd(S.values) }}; }}""")
    check(after['ok'] and after['placed'] == 2 and after['mistakes'] == 1 and not after['dead'] and not after['banner'] and not after['deadNow'],
          f'F3 after rewind: {after}')
    check(after['note'], 'F3 a still-valid note made earlier was lost by Rewind')
    check(not errs, f'F3 errors: {errs}')
    notes.append(f'F3 dead end: {n_wrong} silent wrong digits (no mistakes, silentWrong={before["silent"]}), banner at the dead-end move, Rewind -> {after["placed"]} correct placed digits kept, mistakes 0 -> {after["mistakes"]}, valid note kept')
    await ctx.close()

    # F4. Spot it through the UI: W1 placement, W3 elimination, W4 pair, an alternative step
    async def spot(pid, which='stored'):
        ctx, page, errs = await flow_page(browser, f'#p={pid}')
        step = await dbg(page, """(which) => { const S = __debug.S, st = __debug.entry(S.id).item.step;
          if (which === 'stored') return st;
          return S.spot.steps.find(x => JSON.stringify(x.place) !== JSON.stringify(st.place) || x.tech !== st.tech) || null; }""", which)
        if step is None:
            await ctx.close(); return f'{pid}: no alternative step'
        if step['place']:
            await ui_cell(page, step['place']['cell']); await ui_key(page, step['place']['digit'])
        else:
            await ui_mod(page, 'Pencil')
            for c, d in step['eliminate']:
                await ui_cell(page, c); await ui_key(page, d)
                await page.wait_for_timeout(20)
        await page.wait_for_timeout(1300)
        st = await dbg(page, "() => ({ solved: __debug.S.solved, mistakes: __debug.S.mistakes, toast: document.getElementById('toast').classList.contains('show'), title: document.getElementById('toastTitle').textContent, key: document.querySelector('#againKey .lbl').textContent, status: document.getElementById('status').textContent })")
        ok = st['solved'] and st['toast'] and st['title'] == 'Spotted it' and st['key'] == 'Next' and st['mistakes'] == 0
        await page.screenshot(path=str(OUT / f'flow-spot-{pid}-{which}.png'))
        # Next keycap goes to the following item
        await ui_tap(page, '#againKey'); await page.wait_for_timeout(200)
        nxt = await dbg(page, '() => __debug.S.id')
        await ctx.close()
        if not ok: return f'{pid} ({which}): {st}'
        if errs: return f'{pid} ({which}) errors: {errs}'
        return f'ok {pid} ({which}, {step["tech"]}{", place" if step["place"] else ", " + str(len(step["eliminate"])) + " eliminations"}) -> Next = {nxt}'

    alt_pid = None
    ctx, page, _ = await flow_page(browser)
    alt_pid = await dbg(page, "() => __debug.allIds().find(id => __debug.entry(id).kind === 'spotIt' && __debug.entry(id).item.alts > 1)")
    await ctx.close()
    for pid, which in [('w1-spot-01', 'stored'), ('w3-spot-01', 'stored'), ('w4-spot-01', 'stored'), ('w4-spot-02', 'stored'), (alt_pid, 'alt')]:
        r = await spot(pid, which)
        if check(r.startswith('ok'), f'F4 spot it {r}'): notes.append('F4 ' + r)

    # F5. Spot it instant feedback: a wrong digit shows at once; erasing the true candidate is a mistake and comes back
    ctx, page, errs = await flow_page(browser, '#p=w3-spot-01')
    info = await dbg(page, """() => { const S = __debug.S; for (let i = 0; i < 81; i++) if (!S.values[i] && S.notes[i]) {
        let wrong = 0; for (let d = 1; d <= 9; d++) if ((S.notes[i] >> (d-1)) & 1 && d !== S.sol[i]) { wrong = d; break; }
        if (wrong) return { i, wrong, sol: S.sol[i] }; } }""")
    await ui_cell(page, info['i']); await ui_key(page, info['wrong'])
    await page.wait_for_timeout(500)
    f1 = await dbg(page, f"() => ({{ m: __debug.S.mistakes, red: __debug.cells[{info['i']}].el.classList.contains('conflict') }})")
    await ui_mod(page, 'Undo'); await page.wait_for_timeout(200)
    await ui_mod(page, 'Pencil'); await ui_cell(page, info['i']); await ui_key(page, info['sol'])
    await page.wait_for_timeout(800)
    f2 = await dbg(page, f"() => ({{ m: __debug.S.mistakes, back: !!(__debug.S.notes[{info['i']}] & (1 << ({info['sol']} - 1))), solved: __debug.S.solved }})")
    check(f1 == {'m': 1, 'red': True}, f'F5 wrong digit in Spot it: {f1}')
    check(f2 == {'m': 2, 'back': True, 'solved': False}, f'F5 erase true candidate: {f2}')
    check(not errs, f'F5 errors: {errs}')
    notes.append(f'F5 Spot it feedback: wrong digit shown at once (red, mistakes 1); erasing the true candidate -> mistake 2, note restored')
    await ctx.close()

    # F6. dev menu opens, lists 140 campaign chips, switches puzzles, autosave per id
    ctx, page, errs = await flow_page(browser, '#p=q-easy-007')
    await ui_cell(page, await dbg(page, '() => __debug.S.values.findIndex(v => !v)'))
    sol0 = await dbg(page, '() => { const i = __debug.S.values.findIndex(v => !v); return [i, __debug.S.sol[i]]; }')
    await ui_key(page, sol0[1]); await page.wait_for_timeout(100)
    await ui_tap(page, '#pid'); await page.wait_for_timeout(450)
    n_chips = await page.locator('#devSheet .chip[data-id^="w"]').count()
    await page.screenshot(path=str(OUT / 'flow-devmenu.png'))
    await page.locator('#devSheet .chip[data-id="w2-master-03"]').click(); await page.wait_for_timeout(300)
    id1 = await dbg(page, '() => __debug.S.id')
    await ui_tap(page, '#pid'); await page.wait_for_timeout(400)
    await page.locator('#devSheet .wrow', has_text='easy').locator('input').fill('7')
    await page.locator('#devSheet .wrow', has_text='easy').locator('.chip', has_text='Go').click(); await page.wait_for_timeout(300)
    back = await dbg(page, f'() => ({{ id: __debug.S.id, v: __debug.S.values[{sol0[0]}] }})')
    await ui_tap(page, '#pid'); await page.wait_for_timeout(400)
    today = await page.locator('#devSheet .note').first.text_content()
    await page.locator('#devSheet .chip', has_text='Play today').click(); await page.wait_for_timeout(300)
    did = await dbg(page, '() => __debug.S.id')
    check(n_chips == 140 and id1 == 'w2-master-03' and back == {'id': 'q-easy-007', 'v': sol0[1]} and did.startswith('d-'),
          f'F6 dev menu: chips {n_chips}, switched to {id1}, back {back}, daily {did}')
    check(not errs, f'F6 errors: {errs}')
    notes.append(f'F6 dev menu: {n_chips} campaign chips, switching keeps per-id progress ({back}), {today.strip()}')
    await ctx.close()
    return failures, notes


async def main():
    want_parity = '--flow' not in sys.argv
    want_flow = '--parity' not in sys.argv
    assert (DIST / 'index.html').exists(), 'run node tools/build.mjs first'
    servers = [start_server(PROTO_DIR, P_PROTO), start_server(DIST, P_BUILD)]
    time.sleep(0.6)
    failures = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            if want_parity:
                f, report = await run_parity(browser)
                failures += f
                print('PARITY')
                for r in report: print('  ' + json.dumps(r))
            if want_flow:
                f, notes = await run_flow(browser)
                failures += f
                print('FLOW')
                for n in notes: print('  ' + n)
            await browser.close()
    finally:
        for s in servers: s.terminate()
    if failures:
        print(f'\nFAIL ({len(failures)})')
        for f in failures: print('  - ' + f)
        sys.exit(1)
    print('\nPASS')


if __name__ == '__main__':
    asyncio.run(main())
