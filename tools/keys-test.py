#!/usr/bin/env python3
"""keys-test.py — keycap styles, colorways, switch sounds and the Settings sheet.

    node tools/build.mjs && python3 tools/keys-test.py

K1 matrix: style (sa / cherry / lp) x layout (plain / checker) x 2 presets x
   light / dark at 390x844 (+ a few at 375x667): pad screenshots, no scroll, no
   overlap (keys, plate, Hint/Check, board), legend contrast >= 4.5:1 for every
   key (legend colour vs the cap's --base, from computed styles).
K2 contrast sweep: every preset x layout x theme (computed styles, all keys,
   plus the latched legend colour).
K3 press: the pressed transform (= the style's travel) is applied in the same
   task as the pointerdown (before any frame), and released on pointerup.
K4 locked vs latched: different computed treatment and different pixels, every style.
K5 Level 0: .l0-dim keys are flat outlined slots (body hidden, outline on), every style.
K6 settings: default = SA + Retro + Plain; setSettings persists across reload
   (localStorage 'sudoku.settings.v1'); the sheet opens from the gear, fits
   390x844 / 375x667 (scrolls inside), and a tile tap changes the style.
K7 sound: a digit press logs pen() -> sw(pen), release -> sw(up); pencil and
   mods route to sw(pencil) / sw(mod); classic (?keys=classic) never calls sw.
   Offline render: every switch voice produces sound at a sane level.
Screenshots: /tmp/keys-shots (overview-*.png = combined grids).
"""
import asyncio, json, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = Path('/tmp/keys-shots'); OUT.mkdir(exist_ok=True)
CHROME = '/usr/bin/google-chrome'
PORT = int(os.environ.get('KEYS_PORT', 8795))   # step7: env override (parallel checkouts)
STYLES = ['sa', 'cherry', 'lp']
LAYOUTS = ['plain', 'checker']
TRAVEL = {'sa': 3.5, 'cherry': 3.0, 'lp': 2.0}
PRESETS = ['retro', 'ink', 'mint', 'rose', 'ocean', 'forest']
PAIRS = {('sa', 'plain'): ['retro', 'ocean'], ('sa', 'checker'): ['ink', 'mint'],
         ('cherry', 'plain'): ['rose', 'forest'], ('cherry', 'checker'): ['retro', 'ink'],
         ('lp', 'plain'): ['mint', 'ocean'], ('lp', 'checker'): ['forest', 'rose']}
SMALL = {('sa', 'plain', 'retro'), ('cherry', 'checker', 'ink'), ('lp', 'checker', 'forest')}

failures, notes = [], []
def check(cond, msg):
    if not cond: failures.append(msg)
    return cond

WRAP_SFX = """() => {
  const o = window.__debug.sfx; window.__sfxLog = [];
  for (const k of Object.keys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || typeof d.value !== 'function' || k === 'unlock') continue;
    const fn = d.value; o[k] = function (...a) { window.__sfxLog.push(k + '(' + a.join(',') + ')'); return fn.apply(this, a); };
  }
}"""

# legend colour vs cap colour for every key in the pad + Hint/Check
CONTRAST_JS = """() => {
  const rgb = s => { s = s.trim(); if (s[0] === '#') { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 1]; }
    const m = s.match(/[\\d.]+/g).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const out = [];
  for (const k of document.querySelectorAll('#pad .key, .hkeys .key')) {
    if (k.classList.contains('locked')) continue;
    const cs = getComputedStyle(k), base = rgb(cs.getPropertyValue('--base'));
    const lg = k.querySelector('.lg') || k.querySelector('.lbl');
    const col = rgb(getComputedStyle(lg).color);
    const latch = rgb(cs.getPropertyValue('--lgl'));
    out.push({ key: k.getAttribute('aria-label'), legend: +cr(col, base).toFixed(2), latched: +cr(latch, base).toFixed(2), alpha: col[3] });
  }
  return out;
}"""

GEOM_JS = """() => {
  const r = el => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const pad = document.getElementById('pad'), p = r(pad);
  const plate = [p[0] - 7, p[1] - 7, p[2] + 7, p[3] + 7];
  const keys = [...pad.querySelectorAll(':scope > .key')].map(r);
  const hk = [...document.querySelectorAll('.hkeys .key')].filter(k => k.offsetParent).map(r);
  const board = r(document.getElementById('board'));
  const ov = (a, b) => a[0] < b[2] - .5 && b[0] < a[2] - .5 && a[1] < b[3] - .5 && b[1] < a[3] - .5;
  let keyOverlap = 0;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (ov(keys[i], keys[j])) keyOverlap++;
  return { vw: innerWidth, vh: innerHeight, scrollH: document.scrollingElement.scrollHeight, scrollW: document.scrollingElement.scrollWidth,
           plate, board, keyOverlap, hkPlate: hk.some(h => ov(h, plate)), hkBoard: hk.some(h => ov(h, board)),
           boardPlate: ov(board, plate), nkeys: keys.length };
}"""

def start_server():
    return subprocess.Popen(['node', str(ROOT / 'tools/serve.mjs'), '--dir', str(DIST), '--port', str(PORT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

async def new_page(browser, settings=None, hash_='#p=q-gentle-001', vp=(390, 844), scheme='light', motion='no-preference', query='', dsf=2, init=None):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, device_scale_factor=dsf,
                                    color_scheme=scheme, reduced_motion=motion)
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    if init: await page.add_init_script(init)
    # step7: keycaps are earned now; this suite sweeps every style / layout / preset, so it runs with DEV "unlock all"
    await page.add_init_script("try { if (!localStorage.getItem('sudoku.profile.v1')) localStorage.setItem('sudoku.profile.v1', JSON.stringify({ v: 1, flags: { devUnlockAll: true } })); } catch (e) {}")
    if settings is not None:
        await page.add_init_script(f"try {{ if (!sessionStorage.getItem('kt')) {{ localStorage.setItem('sudoku.settings.v1', {json.dumps(json.dumps(settings))}); sessionStorage.setItem('kt', '1'); }} }} catch (e) {{}}")
    await page.goto(f'http://127.0.0.1:{PORT}/?debug=1{query}{hash_}')
    await page.wait_for_function('() => window.__debug')
    return ctx, page, errs

def S(style, layout, preset, **kw):
    d = {'v': 1, 'style': style, 'layout': layout, 'preset': preset, 'sound': True, 'switchVol': 0.8}
    d.update(kw); return d

async def lock_and_latch(page):
    """Make 7 a used-up digit (fill every 7) and latch Pencil, so both states show."""
    await page.evaluate("""() => { const d = __debug, S = d.S; for (let i = 0; i < 81; i++) if (!S.values[i] && S.sol[i] === 7) S.values[i] = 7; d.refresh(); }""")
    b = await page.locator('.pad .key.mod[aria-label="Pencil"]').bounding_box()
    await page.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    await page.wait_for_timeout(350)

def crop_pad(path, g, dsf=2):
    im = Image.open(path)
    top = max(0, int((min(g['plate'][1], g['board'][3]) - 70) * dsf))
    return im.crop((0, top, im.width, im.height))

def grid(images, cols, labels, out, scale=0.5, pad=6):
    ims = [im.resize((int(im.width * scale), int(im.height * scale))) for im in images]
    w = max(i.width for i in ims); h = max(i.height for i in ims)
    rows = (len(ims) + cols - 1) // cols
    G = Image.new('RGB', (cols * (w + pad) + pad, rows * (h + 20 + pad) + pad), (255, 255, 255))
    d = ImageDraw.Draw(G)
    for k, (im, lab) in enumerate(zip(ims, labels)):
        x = pad + (k % cols) * (w + pad); y = pad + (k // cols) * (h + 20 + pad)
        d.text((x + 2, y + 4), lab, fill=(20, 20, 20))
        G.paste(im, (x, y + 20))
    G.save(out)

# ---------------------------------------------------------------------------
async def k1_matrix(browser):
    t = time.time(); n = 0; crops = {}
    for (style, layout), presets in PAIRS.items():
        for preset in presets:
            for scheme in ['light', 'dark']:
                vps = [(390, 844)] + ([(375, 667)] if (style, layout, preset) in SMALL else [])
                for vp in vps:
                    tag = f'{style}-{layout}-{preset}-{scheme}-{vp[0]}x{vp[1]}'
                    ctx, page, errs = await new_page(browser, S(style, layout, preset), vp=vp, scheme=scheme)
                    cls = await page.evaluate('() => document.documentElement.className')
                    check(all(c in cls.split() for c in ['kx', 'ks-' + style, 'cw-' + preset, 'cl-' + layout]), f'{tag}: html classes {cls}')
                    await lock_and_latch(page)
                    g = await page.evaluate(GEOM_JS)
                    check(g['scrollH'] <= g['vh'] and g['scrollW'] <= g['vw'], f'{tag}: page scrolls {g}')
                    check(g['plate'][0] >= 0 and g['plate'][2] <= g['vw'] and g['plate'][3] <= g['vh'], f'{tag}: plate off screen {g["plate"]}')
                    check(g['keyOverlap'] == 0 and g['nkeys'] == 12, f'{tag}: keys overlap ({g["keyOverlap"]}) / count {g["nkeys"]}')
                    check(not g['hkPlate'] and not g['hkBoard'] and not g['boardPlate'], f'{tag}: Hint/Check, plate or board overlap {g}')
                    con = await page.evaluate(CONTRAST_JS)
                    bad = [c for c in con if c['legend'] < 4.5 or c['alpha'] < 1]
                    check(not bad, f'{tag}: legend contrast < 4.5: {bad}')
                    path = OUT / f'{tag}.png'
                    await page.screenshot(path=str(path))
                    if vp == (390, 844): crops[(style, layout, preset, scheme)] = crop_pad(path, g)
                    check(not errs, f'{tag}: console errors {errs}')
                    await ctx.close(); n += 1
    labels, ims = [], []
    for style in STYLES:
        for layout in LAYOUTS:
            for scheme in ['light', 'dark']:
                p = PAIRS[(style, layout)][0 if scheme == 'light' else 1]
                ims.append(crops[(style, layout, p, scheme)]); labels.append(f'{style} / {layout} / {p} / {scheme}')
    grid(ims, 4, labels, OUT / 'overview-matrix.png', scale=0.42)
    notes.append(f'K1 {n} screenshots ({len(PAIRS) * 4} at 390x844 + {len(SMALL) * 2} at 375x667): no scroll, no overlap, every legend >= 4.5:1 ({time.time() - t:.0f}s)')

async def k1b_overviews(browser):
    """Same preset (Retro) for styles x layouts, and every preset in SA."""
    ims, labels = [], []
    for style in STYLES:
        for scheme in ['light', 'dark']:
            for layout in LAYOUTS:
                ctx, page, errs = await new_page(browser, S(style, layout, 'retro'), scheme=scheme)
                await lock_and_latch(page)
                g = await page.evaluate(GEOM_JS)
                path = OUT / f'ov-{style}-{layout}-retro-{scheme}.png'
                await page.screenshot(path=str(path))
                ims.append(crop_pad(path, g)); labels.append(f'{style} / {layout} / retro / {scheme}')
                await ctx.close()
    grid(ims, 4, labels, OUT / 'overview-styles-x-layouts.png', scale=0.42)
    ims, labels = [], []
    for preset in PRESETS:
        for scheme, layout in [('light', 'plain'), ('light', 'checker'), ('dark', 'plain'), ('dark', 'checker')]:
            ctx, page, errs = await new_page(browser, S('sa', layout, preset), scheme=scheme)
            g = await page.evaluate(GEOM_JS)
            path = OUT / f'ov-sa-{layout}-{preset}-{scheme}.png'
            await page.screenshot(path=str(path))
            ims.append(crop_pad(path, g)); labels.append(f'sa / {layout} / {preset} / {scheme}')
            await ctx.close()
    grid(ims, 4, labels, OUT / 'overview-presets.png', scale=0.36)
    notes.append('K1 overviews: overview-styles-x-layouts.png (Retro), overview-presets.png (6 presets, SA), overview-matrix.png')

async def k2_contrast(browser):
    worst = {}
    for scheme in ['light', 'dark']:
        ctx, page, errs = await new_page(browser, S('sa', 'plain', 'retro'), scheme=scheme)
        await page.evaluate("""() => { const d = __debug, S = d.S; for (let i = 0; i < 81; i++) if (!S.values[i] && S.sol[i] === 7) S.values[i] = 7; d.refresh(); }""")
        for preset in PRESETS:
            for layout in LAYOUTS:
                for style in STYLES:
                    await page.evaluate(f"() => __keys.setSettings({{ style: '{style}', layout: '{layout}', preset: '{preset}' }})")
                    con = await page.evaluate(CONTRAST_JS)
                    lo = min(c['legend'] for c in con); ll = min(c['latched'] for c in con)
                    k = (preset, scheme); worst[k] = min(worst.get(k, (99, 99))[0], lo), min(worst.get(k, (99, 99))[1], ll)
                    check(lo >= 4.5, f'K2 {preset}/{layout}/{style}/{scheme}: legend contrast {lo}')
                    check(ll >= 4.5, f'K2 {preset}/{layout}/{style}/{scheme}: latched legend contrast {ll}')
        check(not errs, f'K2 {scheme}: console errors {errs}')
        await ctx.close()
    notes.append('K2 lowest legend / latched-legend contrast per preset: ' + ', '.join(f'{p}-{s} {a:.2f}/{b:.2f}' for (p, s), (a, b) in sorted(worst.items())))

async def k3_press(browser):
    res = []
    for style in STYLES:
        ctx, page, errs = await new_page(browser, S(style, 'plain', 'retro'))
        r = await page.evaluate("""() => {
          const k = document.querySelector('.key.digit[data-d="5"]'), cap = k.querySelector('.cap');
          const ty = () => { const m = getComputedStyle(cap).transform; return m === 'none' ? 0 : +m.split(',')[5].replace(')', ''); };
          const before = ty();
          k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, button: 0, isPrimary: true }));
          const down = ty(), cls = k.classList.contains('down'), shade = getComputedStyle(k.querySelector('.tf'), '::after').opacity;
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, button: 0 }));
          return { before, down, cls, shade, up: k.classList.contains('down') };
        }""")
        check(r['before'] == 0 and abs(r['down'] - TRAVEL[style]) < 0.01 and r['cls'] and r['shade'] == '1' and not r['up'],
              f'K3 {style}: press not applied on the pointerdown task: {r}')
        res.append(f"{style} {r['down']}px")
        await ctx.close()
    notes.append('K3 pressed transform applied synchronously in the pointerdown task, before any frame: ' + ', '.join(res))

async def k4_locked_latched(browser):
    res = []
    for style in STYLES:
        for scheme in ['light', 'dark']:
            ctx, page, errs = await new_page(browser, S(style, 'plain', 'retro'), scheme=scheme)
            # latch digit 4 (number-first load) and lock digit 7
            await page.evaluate("""() => { const d = __debug, S = d.S; for (let i = 0; i < 81; i++) if (!S.values[i] && S.sol[i] === 7) S.values[i] = 7; S.selected = -1; d.refresh(); }""")
            b = await page.locator('.key.digit[data-d="4"]').bounding_box()
            await page.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
            await page.wait_for_timeout(700)
            st = await page.evaluate("""() => {
              const f = d => { const k = document.querySelector(`.key.digit[data-d="${d}"]`), cap = k.querySelector('.cap'), cs = getComputedStyle(cap);
                const m = cs.transform; return { cls: k.className, ty: m === 'none' ? 0 : +m.split(',')[5].replace(')', ''), capOp: +cs.opacity,
                  lg: getComputedStyle(k.querySelector('.lg')).color, cnt: +getComputedStyle(k.querySelector('.cnt')).opacity,
                  led: +getComputedStyle(k.querySelector('.led')).opacity, sw: +getComputedStyle(k.querySelector('.sw')).opacity }; };
              return { latched: f(4), locked: f(7), plain: f(5) };
            }""")
            la, lo, pl = st['latched'], st['locked'], st['plain']
            check('latched' in la['cls'] and la['led'] == 1 and la['ty'] > 1 and la['lg'] != pl['lg'], f'K4 {style}/{scheme}: latched treatment {la} vs {pl}')
            locked_ok = 'locked' in lo['cls'] and lo['cnt'] == 0 and lo['led'] == 0 and (lo['lg'] == 'rgba(0, 0, 0, 0)' or (lo['capOp'] == 0 and lo['sw'] == 1))
            check(locked_ok, f'K4 {style}/{scheme}: locked treatment {lo}')
            # pixels: the two keys must look clearly different
            for d in (4, 7):
                await page.locator(f'.key.digit[data-d="{d}"]').screenshot(path=str(OUT / f'state-{style}-{scheme}-{d}.png'))
            a = Image.open(OUT / f'state-{style}-{scheme}-4.png').convert('RGB'); c = Image.open(OUT / f'state-{style}-{scheme}-7.png').convert('RGB').resize(a.size)
            diff = ImageChops.difference(a, c).convert('L').point(lambda v: 255 if v > 24 else 0)
            frac = ImageStat.Stat(diff).mean[0] / 255
            check(frac > 0.04, f'K4 {style}/{scheme}: locked and latched keys look too alike ({frac:.3f})')
            res.append(f'{style}-{scheme} {frac * 100:.0f}%')
            await ctx.close()
    notes.append('K4 locked (blank/debossed or cap pulled, no badge, no LED) vs latched (held down, LED, accent legend); differing pixels: ' + ', '.join(res))

async def k5_level0(browser):
    res = []
    for style in STYLES:
        for scheme in ['light', 'dark']:
            ctx, page, errs = await new_page(browser, S(style, 'checker', 'ink' if scheme == 'light' else 'retro'), hash_='#l0=w0', scheme=scheme)
            b = await page.locator('.coach .key.ck.show:not(.skip)').first.bounding_box()
            await page.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
            await page.wait_for_timeout(300)
            b = await page.locator('.cell[data-i="28"]').bounding_box()
            await page.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
            await page.wait_for_timeout(600)
            r = await page.evaluate("""() => {
              const k = [...document.querySelectorAll('#pad .key.l0-dim')][0]; if (!k) return null;
              const g = (sel, p) => getComputedStyle(k.querySelector(sel))[p];
              return { n: document.querySelectorAll('#pad .key.l0-dim').length, sk: +g('.sk', 'opacity'), tf: +g('.tf', 'opacity'),
                       wall: +g('.wall', 'opacity'), shadow: +g('.shadow', 'opacity'), capSh: g('.cap', 'boxShadow'),
                       ink: (k.querySelector('.lg') || k.querySelector('.lbl')) ? getComputedStyle(k.querySelector('.lg') || k.querySelector('.lbl')).color : '',
                       plateInk: getComputedStyle(k).getPropertyValue('--plate-ink').trim() };
            }""")
            check(r and r['n'] > 0 and r['sk'] == 0 and r['tf'] == 0 and r['wall'] == 0 and r['shadow'] == 0 and 'inset' in r['capSh'],
                  f'K5 {style}/{scheme}: .l0-dim is not a flat outlined slot: {r}')
            await page.locator('#pad').screenshot(path=str(OUT / f'l0-{style}-{scheme}.png'))
            res.append(f"{style}-{scheme} {r and r['n']} dimmed")
            check(not errs, f'K5 {style}/{scheme}: console errors {errs}')
            await ctx.close()
    notes.append('K5 Level 0 .l0-dim keys = flat outlined slots (cap body, wall, shadow hidden; inset outline) in every style: ' + ', '.join(res))

async def k6_settings(browser):
    ctx, page, errs = await new_page(browser, None)
    s = await page.evaluate('() => __keys.getSettings()')
    cls = await page.evaluate('() => document.documentElement.className.split(" ")')
    check(s['style'] == 'sa' and s['preset'] == 'retro' and s['layout'] == 'plain' and s['sound'] is True,
          f'K6 default settings {s}')
    check('ks-sa' in cls and 'cw-retro' in cls and 'cl-plain' in cls, f'K6 default classes {cls}')
    await page.evaluate("() => __keys.setSettings({ style: 'cherry', layout: 'checker', preset: 'ocean', switchVol: 0.35, sound: false })")
    await page.reload(); await page.wait_for_function('() => window.__debug')
    s2 = await page.evaluate('() => __keys.getSettings()')
    raw = await page.evaluate("() => localStorage.getItem('sudoku.settings.v1')")
    cls = await page.evaluate('() => document.documentElement.className.split(" ")')
    muted = await page.evaluate('() => __debug.sfx.muted')
    check(s2 == {'style': 'cherry', 'layout': 'checker', 'preset': 'ocean', 'sound': False, 'switchVol': 0.35} and 'ks-cherry' in cls and 'cw-ocean' in cls and 'cl-checker' in cls and muted,
          f'K6 settings did not persist across reload: {s2} {cls} muted={muted} raw={raw}')
    # garbage in storage -> defaults, no crash; classic refused without debug
    await page.evaluate("() => localStorage.setItem('sudoku.settings.v1', '{bad json')")
    await page.reload(); await page.wait_for_function('() => window.__debug')
    s3 = await page.evaluate('() => __keys.getSettings()')
    check(s3['style'] == 'sa', f'K6 bad JSON did not fall back to defaults: {s3}')
    check(not errs, f'K6 console errors {errs}')
    await ctx.close()
    notes.append(f'K6 default = SA + Retro + Plain; persisted across reload as {raw}; bad JSON -> defaults')

    # the sheet: gear, fit, scroll, tile tap changes the style (with the swap wave)
    for vp, scheme, motion in [((390, 844), 'light', 'no-preference'), ((390, 844), 'dark', 'no-preference'), ((375, 667), 'light', 'no-preference'),
                               ((375, 667), 'dark', 'no-preference'), ((390, 844), 'light', 'reduce')]:
        if True:
            ctx, page, errs = await new_page(browser, None, vp=vp, scheme=scheme, motion=motion)
            await page.locator('#setBtn').click(); await page.wait_for_timeout(500)
            g = await page.evaluate("""() => { const s = document.getElementById('setSheet'), r = s.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, h: innerHeight, w: innerWidth, left: r.left, right: r.right,
                       sh: s.scrollHeight, ch: s.clientHeight, open: s.classList.contains('show'), sheetOpen: __debug.UI.sheetOpen,
                       docScroll: document.scrollingElement.scrollHeight }; }""")
            tag = f'{vp[0]}x{vp[1]}-{scheme}' + ('-reduced' if motion == 'reduce' else '')
            check(g['open'] and g['sheetOpen'] and g['top'] >= 0 and g['bottom'] <= g['h'] + 0.5 and g['left'] >= -0.5 and g['right'] <= g['w'] + 0.5 and g['docScroll'] <= g['h'],
                  f'K6 sheet {tag} does not fit: {g}')
            await page.screenshot(path=str(OUT / f'settings-{tag}.png'))
            # tap the Low-profile tile, then Checkerboard, then Forest
            await page.locator('.set-tile[data-style="lp"]').click(); await page.wait_for_timeout(120)
            await page.screenshot(path=str(OUT / f'settings-{tag}-wave.png'))
            await page.wait_for_timeout(600)
            await page.locator('.set-seg button[data-layout="checker"]').click(); await page.wait_for_timeout(700)
            await page.locator('.set-swatch[data-preset="forest"]').scroll_into_view_if_needed()
            await page.locator('.set-swatch[data-preset="forest"]').click(); await page.wait_for_timeout(700)
            s = await page.evaluate('() => __keys.getSettings()')
            pinned = await page.evaluate("() => document.querySelectorAll('.key.kpin').length")
            check(s['style'] == 'lp' and s['layout'] == 'checker' and s['preset'] == 'forest' and pinned == 0, f'K6 sheet taps {tag}: {s}, pinned {pinned}')
            if g['sh'] > g['ch']:
                await page.evaluate("() => { const s = document.getElementById('setSheet'); s.scrollTop = s.scrollHeight; }")
                await page.wait_for_timeout(100)
            await page.screenshot(path=str(OUT / f'settings-{tag}-after.png'))
            await page.keyboard.press('Escape'); await page.wait_for_timeout(450)
            closed = await page.evaluate("() => !document.getElementById('setSheet').classList.contains('show') && !__debug.UI.sheetOpen")
            check(closed, f'K6 Escape did not close the sheet {tag}')
            await page.screenshot(path=str(OUT / f'settings-{tag}-closed.png'))
            check(not errs, f'K6 sheet {tag} console errors {errs}')
            notes.append(f'K6 sheet {tag}: fits ({g["top"]:.0f}..{g["bottom"]:.0f} of {g["h"]}), {"scrolls inside" if g["sh"] > g["ch"] else "no scroll needed"}; tile/segment/swatch taps applied')
            await ctx.close()

OFFLINE_INIT = """(() => {
  window.__offline = null;
  window.AudioContext = function () { const c = new OfflineAudioContext(1, 22050, 44100); c.resume = () => Promise.resolve(); window.__offline = c; return c; };
  window.webkitAudioContext = window.AudioContext;
})();"""

async def k7_sound(browser):
    for style in STYLES:
        ctx, page, errs = await new_page(browser, S(style, 'plain', 'retro'))
        await page.evaluate(WRAP_SFX)
        check(await page.evaluate('() => __debug.sfx.keyStyle') == style, f'K7 {style}: sfx.keyStyle')
        async def tap(sel):
            b = await page.locator(sel).first.bounding_box()
            await page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
            await page.mouse.down(); await page.mouse.up()
        await page.evaluate('() => { window.__sfxLog.length = 0; }')
        await tap('.cell[data-i="1"]'); await tap('.key.digit[data-d="3"]')
        log = await page.evaluate('() => window.__sfxLog.slice()')
        i = log.index('pen()') if 'pen()' in log else -1
        check(i >= 0 and log[i + 1:i + 2] == ['sw(pen)'] and 'release()' in log and log[log.index('release()') + 1] == 'sw(up)',
              f'K7 {style}: digit press sfx sequence {log}')
        await page.evaluate('() => { window.__sfxLog.length = 0; }')
        await tap('.pad .key.mod[aria-label="Pencil"]'); await tap('.cell[data-i="3"]'); await tap('.key.digit[data-d="5"]')
        log2 = await page.evaluate('() => window.__sfxLog.slice()')
        check('mod()' in log2 and log2[log2.index('mod()') + 1] == 'sw(mod)' and 'pencil()' in log2 and log2[log2.index('pencil()') + 1] == 'sw(pencil)',
              f'K7 {style}: pencil / mod sfx sequence {log2}')
        if style == 'sa': notes.append(f'K7 sfx log, SA digit press: {log}; pencil mode: {log2}')
        check(not errs, f'K7 {style}: console errors {errs}')
        await ctx.close()
    ctx, page, errs = await new_page(browser, None, query='&keys=classic')
    await page.evaluate(WRAP_SFX)
    cls = await page.evaluate('() => document.documentElement.className')
    b = await page.locator('.cell[data-i="1"]').bounding_box(); await page.mouse.click(b['x'] + 5, b['y'] + 5)
    b = await page.locator('.key.digit[data-d="3"]').bounding_box(); await page.mouse.click(b['x'] + 20, b['y'] + 20)
    log = await page.evaluate('() => window.__sfxLog.slice()')
    sk = await page.evaluate("() => document.querySelectorAll('.key .sk').length")
    check('kx' not in cls.split() and not any(x.startswith('sw(') for x in log) and 'pen()' in log and sk == 0 and await page.evaluate('() => !document.getElementById("setBtn")'),
          f'K7 classic: {cls} {log} dressed={sk}')
    await ctx.close()
    notes.append(f'K7 classic (?debug=1&keys=classic): no .kx, no dressing, no gear, original clicks only: {log}')

    # offline render: each voice makes sound, at a level comparable to the classic click
    levels = {}
    for style, call in [('classic', 'pen'), ('sa', 'pen'), ('sa', 'pencil'), ('sa', 'up'), ('cherry', 'pen'), ('cherry', 'up'), ('lp', 'pen'), ('lp', 'up'), ('lp', 'pencil')]:
        q = '&keys=classic' if style == 'classic' else ''
        ctx, page, errs = await new_page(browser, None if style == 'classic' else S(style, 'plain', 'retro'), query=q, init=OFFLINE_INIT)
        fn = {'pen': 'pen', 'pencil': 'pencil', 'up': 'release'}[call]
        r = await page.evaluate(f"""async () => {{ const s = __debug.sfx; s.unlock(); s.{fn}();
          const buf = await window.__offline.startRendering(); const ch = buf.getChannelData(0);
          let pk = 0, e = 0, last = 0; for (let i = 0; i < ch.length; i++) {{ const a = Math.abs(ch[i]); if (a > pk) pk = a; e += a * a; if (a > 0.003) last = i; }}
          return {{ peak: pk, rms: Math.sqrt(e / ch.length), tail_ms: last / 44.1 }}; }}""")
        levels[f'{style}.{call}'] = r
        await ctx.close()
    base = levels['classic.pen']['peak']
    for k, r in levels.items():
        if k.endswith('.pen'): check(0.35 * base <= r['peak'] <= 1.8 * base, f'K7 {k}: peak {r["peak"]:.3f} vs classic {base:.3f}')
        check(r['peak'] > 0.004, f'K7 {k}: silent')
        check(r['tail_ms'] < 260, f'K7 {k}: tail too long {r["tail_ms"]:.0f} ms')
    notes.append('K7 offline render (peak / ms until < -50 dBFS): ' + ', '.join(f'{k} {r["peak"]:.2f}/{r["tail_ms"]:.0f}ms' for k, r in levels.items()))


async def main():
    if not (DIST / 'index.html').exists(): sys.exit('build first: node tools/build.mjs')
    only = sys.argv[1:]
    srv = start_server(); time.sleep(0.6)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=CHROME, args=['--autoplay-policy=no-user-gesture-required'])
            for name, fn in [('k1', k1_matrix), ('k1b', k1b_overviews), ('k2', k2_contrast), ('k3', k3_press), ('k4', k4_locked_latched),
                             ('k5', k5_level0), ('k6', k6_settings), ('k7', k7_sound)]:
                if only and name not in only: continue
                t = time.time()
                try: await fn(browser)
                except Exception as e: failures.append(f'{name} crashed: {e!r}')
                print(f'  {name} done in {time.time() - t:.1f}s', flush=True)
            await browser.close()
    finally:
        srv.terminate()
    print('KEYS')
    for n in notes: print('  ' + n)
    if failures:
        print('\nFAIL'); [print('  - ' + f) for f in failures]; sys.exit(1)
    print('\nPASS')

asyncio.run(main())
