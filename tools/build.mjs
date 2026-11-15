#!/usr/bin/env node
// build.mjs — bundles the game into dist/ with no dependencies.
//
//   node tools/build.mjs
//
// Output: dist/index.html (CSS + JS + puzzle data inlined), dist/sw.js
// (VERSION = 'sudoku-' + first 10 hex of sha256(index.html)), manifest and icons.
// Deterministic: the same sources give byte-identical output.
//
// The bundler is deliberately tiny and relies on a module CONVENTION that the
// game sources follow (the build fails loudly when a module breaks it):
//   - imports:  import { a, b as c } from './x.js';   or   import * as ns from './x.js';
//               (relative paths only; may span lines; no default / side-effect imports)
//   - exports:  export function f / export function* g / export async function h
//               export const NAME = ...;   (ONE declarator per statement)
//               export class C ...
//               export { a, b as c };
//     No `export let/var` (bindings are copied, not live), no default, no `export *`.
//   - no import cycles (modules run in dependency order, like ESM would).
// Each module becomes `const __m_x = (() => { const {..} = __m_dep; <body>; return {..}; })();`
// so modules keep their own scope. Exported objects are shared by reference.
// './puzzles-data.js' is a virtual module: `export const DATA = <data/puzzles.json>`.
/* --- level0: Level 0 scripts --- */
// './level0-data.js' is a virtual module: `export const SCRIPTS = { w0: <content/level0/w0.json>, … }`
// (one key per content/level0/*.json, by file name). Every script must pass
// validateScript() (src/level0-script.js) or the build fails.
/* --- end level0 --- */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const ENTRY = path.join(SRC, 'main.js');
const VIRTUAL = {
  [path.join(SRC, 'puzzles-data.js')]: () => {
    const json = JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/puzzles.json'), 'utf8')));
    return `export const DATA = ${json};\n`;
  },
  /* --- level0: Level 0 scripts --- */
  [path.join(SRC, 'level0-data.js')]: () => {
    const dir = path.join(ROOT, 'content/level0'), out = {};
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return `export const SCRIPTS = ${JSON.stringify(out)};\n`;
  },
  /* --- end level0 --- */
};

const fail = (file, msg) => { console.error(`build: ${path.relative(ROOT, file)}: ${msg}`); process.exit(1); };

const IMPORT_RE = /^import\s+(\{[^}]*\}|\*\s+as\s+[\w$]+)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+((?:async\s+)?function\s*\*?|const|class)\s+([\w$]+)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm;

function parseSpecifiers(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
    if (!m) throw new Error(`bad specifier "${s}"`);
    return { name: m[1], alias: m[2] || m[1] };
  });
}

const modules = new Map(); // abs path -> {id, deps, code}
const order = [];
const visiting = new Set();

function load(file, from) {
  if (modules.has(file)) return modules.get(file);
  if (visiting.has(file)) fail(from, `import cycle through ${path.relative(ROOT, file)} (not supported by the bundler)`);
  visiting.add(file);
  let src;
  if (VIRTUAL[file]) src = VIRTUAL[file]();
  else if (fs.existsSync(file)) src = fs.readFileSync(file, 'utf8');
  else fail(from, `cannot resolve ${path.relative(ROOT, file)}`);

  const id = '__m_' + path.relative(SRC, file).replace(/\.js$/, '').replace(/[^\w$]/g, '_');
  const imports = [];
  let body = src.replace(IMPORT_RE, (all, what, spec) => {
    if (!spec.startsWith('.')) fail(file, `only relative imports are supported: ${spec}`);
    imports.push({ what, file: path.resolve(path.dirname(file), spec) });
    return '';
  });
  if (/^\s*import\b/m.test(body)) fail(file, 'unsupported import form (see build.mjs header)');
  if (/^export\s+(let|var|default|\*)/m.test(body)) fail(file, 'unsupported export form: export let/var/default/* (see build.mjs header)');

  const exported = []; // [exportName, localName]
  body = body.replace(EXPORT_DECL_RE, (all, kind, name) => {
    exported.push([name, name]);
    return all.replace(/^export\s+/, '');
  });
  body = body.replace(EXPORT_LIST_RE, (all, list) => {
    for (const s of parseSpecifiers(list)) exported.push([s.alias, s.name]);
    return '';
  });
  if (/^export\b/m.test(body)) fail(file, 'unsupported export form (see build.mjs header)');
  // (A second declarator in an `export const` is not exported; importers that ask
  // for it fail below with "does not export".)

  const deps = imports.map((imp) => ({ ...imp, mod: load(imp.file, file) }));
  const head = deps.map(({ what, mod }) => {
    if (what.startsWith('*')) return `const ${what.replace(/^\*\s+as\s+/, '')} = ${mod.id};`;
    const specs = parseSpecifiers(what.slice(1, -1));
    for (const s of specs) if (!mod.exports.has(s.name)) fail(file, `${path.relative(ROOT, mod.file)} does not export "${s.name}"`);
    return `const { ${specs.map((s) => (s.name === s.alias ? s.name : `${s.name}: ${s.alias}`)).join(', ')} } = ${mod.id};`;
  }).join('\n');

  const ret = `return Object.freeze({ ${exported.map(([e, l]) => (e === l ? e : `${e}: ${l}`)).join(', ')} });`;
  const code = `/* ---- ${path.relative(ROOT, file)} ---- */\nconst ${id} = (() => {\n${head}\n${body.trim()}\n${ret}\n})();`;
  const mod = { id, file, exports: new Set(exported.map(([e]) => e)), code };
  visiting.delete(file);
  modules.set(file, mod);
  order.push(mod);
  return mod;
}

/* --- level0: validate the Level 0 scripts before bundling --- */
{
  const { validateScript } = await import('../src/level0-script.js');
  const dir = path.join(ROOT, 'content/level0');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const r = validateScript(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (!r.ok) fail(path.join(dir, f), 'invalid Level 0 script:\n  ' + r.errors.join('\n  '));
  }
}
/* --- end level0 --- */
load(ENTRY, ENTRY);
let js = order.map((m) => m.code).join('\n\n');
if (/<\/script/i.test(js)) js = js.replace(/<\/script/gi, '<\\/script');

let css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8').trim();
/* --- keys: keycap styles + Settings sheet CSS, appended after style.css --- */
css += '\n' + fs.readFileSync(path.join(SRC, 'keys.css'), 'utf8').trim();
/* --- end keys --- */
/* --- step7: progression screens + power charges CSS --- */
css += '\n' + fs.readFileSync(path.join(SRC, 'progress.css'), 'utf8').trim();
/* --- end step7 --- */
/* --- step8: Free Mode screen CSS, appended after keys.css --- */
css += '\n' + fs.readFileSync(path.join(SRC, 'freemode.css'), 'utf8').trim();
/* --- step9: backup code sheet + Settings row + Home link --- */
css += '\n' + fs.readFileSync(path.join(SRC, 'backup.css'), 'utf8').trim();
/* --- step10: effects pass (transitions, deltas, unlock moments), appended last --- */
css += '\n' + fs.readFileSync(path.join(SRC, 'effects.css'), 'utf8').trim();
/* --- end step8 --- */
const tpl = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
if (!tpl.includes('/*__STYLE__*/') || !tpl.includes('//__SCRIPT__')) fail(path.join(SRC, 'index.html'), 'template placeholders missing');
const html = tpl.replace('/*__STYLE__*/', () => css).replace('//__SCRIPT__', () => js);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html);

const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 10);
const swTpl = fs.readFileSync(path.join(SRC, 'sw.template.js'), 'utf8');
if (!/const VERSION = '[^']*';/.test(swTpl)) fail(path.join(SRC, 'sw.template.js'), 'VERSION line missing');
fs.writeFileSync(path.join(DIST, 'sw.js'), swTpl.replace(/const VERSION = '[^']*';/, `const VERSION = 'sudoku-${hash}';`)
  .replace('When you change any file, bump VERSION so players get the new build.', 'Generated by tools/build.mjs: VERSION is a hash of index.html, so every build busts the cache.'));
for (const f of fs.readdirSync(path.join(ROOT, 'public')).sort()) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(DIST, f));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const gz = (await import('node:zlib')).gzipSync(html, { level: 9 }).length;
console.log(`build: ${order.length} modules -> dist/index.html ${kb(html.length)} (${kb(gz)} gzip), sw VERSION sudoku-${hash}`);
