#!/usr/bin/env node
/*
 * build-theme.js — generate hypercms's pixel-quiet shell stylesheet.
 *
 * mirk.css styles a whole document (:root tokens, body font, universal
 * box-sizing, a relative @font-face url). hypercms injects a sidebar into an
 * arbitrary host page, so mirk must be SCOPED to .hcms-shell or it would
 * repaint the host body, change its box model, and fail to load the font.
 *
 * This reads the canonical mirk.css (single source of truth in mirk-ui-kit),
 * scopes every rule to .hcms-shell, rewrites the font url to the absolute CDN,
 * then appends the hypercms-owned pixel-quiet overrides. Output:
 * src/theme.generated.css, which the bundle entry installs as the shell CSS.
 *
 * Also vendors mirk.js (the delegated component runtime) into src/vendor so the
 * bundle can import it for its side effect.
 *
 * Run: npm run build:theme  (also runs first in `npm run build`).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// mirk-ui-kit normally sits next to the hypercms checkout, but in a git
// worktree (.claude/worktrees/<name>) the repo root is nested deeper, so walk
// up until a directory contains mirk-ui-kit/mirk.css.
function findMirkRepo(from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'mirk-ui-kit')
    if (fs.existsSync(path.join(candidate, 'mirk.css'))) return candidate
    if (path.dirname(dir) === dir) throw new Error('mirk-ui-kit/mirk.css not found above ' + from)
  }
}
const mirkRepo = findMirkRepo(root)

const MIRK_VERSION = '2.0.1'
const FONT_CDN =
  `https://cdn.jsdelivr.net/npm/mirk-interface@${MIRK_VERSION}/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2`

const SCOPE = '.hcms-shell'

// ---- selector scoping -------------------------------------------------------

// Split a string on a top-level separator, ignoring separators inside () or [].
function splitTopLevel(str, sep) {
  const out = []
  let depth = 0
  let buf = ''
  for (const ch of str) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === sep && depth === 0) {
      out.push(buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  if (buf.trim() !== '') out.push(buf)
  return out
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
}

// Map one mirk selector to its .hcms-shell-scoped form. Root-level selectors
// (:root / body / html, and the theme flags .light / .dark / [data-theme]) bind
// to the shell element itself; everything else binds to a descendant.
function scopeOne(sel) {
  sel = stripComments(sel).trim()
  if (!sel) return ''
  if (sel === ':root' || sel === 'body' || sel === 'html') return SCOPE
  if (sel === '*') return `${SCOPE} *`
  if (sel === '::before') return `${SCOPE} *::before`
  if (sel === '::after') return `${SCOPE} *::after`
  if (/^\.light\b/.test(sel) || /^\.dark\b/.test(sel) || sel.startsWith('[data-theme')) {
    return SCOPE + sel
  }
  return `${SCOPE} ${sel}`
}

function scopeSelectorList(list) {
  return splitTopLevel(list, ',').map(scopeOne).filter(Boolean).join(', ')
}

function rewriteFontFace(body) {
  return body.replace(
    /url\(\s*(['"]?)[^)'"]*DepartureMono-Regular\.woff2\1\s*\)/,
    `url('${FONT_CDN}')`
  )
}

// ---- block walker -----------------------------------------------------------

// Transform a sequence of rules (a stylesheet, or the inside of an at-rule
// block). Style rules get their selector list scoped; nested at-rules recurse.
function transformBlock(css) {
  let i = 0
  let out = ''
  const n = css.length
  while (i < n) {
    const ch = css[i]
    if (/\s/.test(ch)) { out += ch; i++; continue }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += css.slice(i, stop)
      i = stop
      continue
    }
    // Read the prelude up to a top-level '{' or ';'.
    let j = i
    let depth = 0
    while (j < n) {
      const c = css[j]
      if (c === '/' && css[j + 1] === '*') { const e = css.indexOf('*/', j + 2); j = e === -1 ? n : e + 2; continue }
      if (c === '{' && depth === 0) break
      if (c === ';' && depth === 0) break
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') depth--
      j++
    }
    if (j >= n) { out += css.slice(i); break }
    const prelude = css.slice(i, j)
    if (css[j] === ';') {
      // statement at-rule, e.g. `@layer base, components;`
      out += prelude + ';'
      i = j + 1
      continue
    }
    // css[j] === '{' — find the matching close brace.
    const bodyStart = j + 1
    let d = 1
    let k = bodyStart
    while (k < n && d > 0) {
      const c = css[k]
      if (c === '/' && css[k + 1] === '*') { const e = css.indexOf('*/', k + 2); k = e === -1 ? n : e + 2; continue }
      if (c === '{') d++
      else if (c === '}') { d--; if (d === 0) break }
      k++
    }
    const body = css.slice(bodyStart, k)
    i = k + 1
    const trimmed = prelude.trim()
    if (trimmed.startsWith('@')) {
      const atName = trimmed.split(/[\s({]/)[0]
      if (atName === '@font-face') {
        out += prelude + '{' + rewriteFontFace(body) + '}'
      } else if (atName === '@keyframes' || atName === '@-webkit-keyframes') {
        out += prelude + '{' + body + '}'
      } else {
        // @media / @layer / @supports / @scope — recurse into inner rules.
        out += prelude + '{' + transformBlock(body) + '}'
      }
    } else {
      out += scopeSelectorList(prelude) + ' {' + body + '}'
    }
  }
  return out
}

// ---- main -------------------------------------------------------------------

function read(p) { return fs.readFileSync(p, 'utf8') }

const mirkCss = read(path.join(mirkRepo, 'mirk.css'))
const scopedMirk = transformBlock(mirkCss)
const overrides = read(path.join(root, 'src', 'theme', 'pixel-quiet.overrides.css'))

const banner =
  '/* GENERATED by scripts/build-theme.js from mirk-ui-kit/mirk.css — DO NOT EDIT.\n' +
  '   Source of truth: mirk-ui-kit/mirk.css + src/theme/pixel-quiet.overrides.css.\n' +
  '   Regenerate with: npm run build:theme */\n\n'

const themeOut =
  banner +
  '/* ===== mirk-interface@' + MIRK_VERSION + ', scoped to .hcms-shell ===== */\n' +
  scopedMirk.trim() + '\n\n' +
  '/* ===== pixel-quiet overrides (hypercms-owned) ===== */\n' +
  overrides.trim() + '\n'

fs.writeFileSync(path.join(root, 'src', 'theme.generated.css'), themeOut, 'utf8')
console.log('✓ wrote src/theme.generated.css (' + themeOut.length + ' bytes)')

// Vendor the mirk.js delegated runtime so the bundle can import it.
const vendorDir = path.join(root, 'src', 'vendor')
fs.mkdirSync(vendorDir, { recursive: true })
const mirkJs = read(path.join(mirkRepo, 'mirk.js'))
const vendorBanner =
  '/* VENDORED from mirk-ui-kit/mirk.js — DO NOT EDIT. Regenerate: npm run build:theme */\n'
// Guard so this is import-safe in non-browser realms (e.g. Node tests that load
// hypercms before a jsdom window exists). In the browser the guard is a no-op.
const guarded =
  vendorBanner +
  'if (typeof window !== "undefined" && typeof document !== "undefined") {\n' +
  mirkJs.trimEnd() + '\n' +
  '}\n'
fs.writeFileSync(path.join(vendorDir, 'mirk.vendor.js'), guarded, 'utf8')
console.log('✓ wrote src/vendor/mirk.vendor.js')
