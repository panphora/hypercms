import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const themePath = path.join(root, 'src', 'theme.generated.css')
const vendorPath = path.join(root, 'src', 'vendor', 'mirk.vendor.js')

function readTheme() {
  return fs.readFileSync(themePath, 'utf8')
}

// Strip CSS comments so leak assertions don't trip on prose in comments.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

test('theme.generated.css exists and is non-trivial', () => {
  assert.ok(fs.existsSync(themePath), 'run npm run build:theme')
  assert.ok(readTheme().length > 20000, 'generated theme is the full scoped kit')
})

test('mirk components are scoped to .hcms-shell', () => {
  const css = readTheme()
  assert.match(css, /\.hcms-shell \.mirk-input\b/)
  assert.match(css, /\.hcms-shell \.mirk-button\b/)
  assert.match(css, /\.hcms-shell \.mirk-sortable__item\b/)
  assert.match(css, /\.hcms-shell \.mirk-toggle\b/)
})

test('root + body + universal selectors are bound to the shell, not the page', () => {
  const css = stripComments(readTheme())
  // mirk's `:root { ... }` becomes `.hcms-shell { ... }` — no bare :root survives.
  assert.doesNotMatch(css, /(^|[\s,}])\:root\b/, 'no unscoped :root leaks to the host page')
  // mirk's `body { font-family }` becomes `.hcms-shell { font-family }`.
  assert.doesNotMatch(css, /(^|[\s,}])body\s*\{/, 'no unscoped body rule (host body untouched)')
  // mirk's universal box-sizing is scoped under the shell.
  assert.match(css, /\.hcms-shell \*\s*,\s*\.hcms-shell \*::before/)
  // the only `body` rules are the hcms-open page-shift helpers, all class-qualified.
  for (const m of css.matchAll(/(^|[\s,}])(body[^,{};]*)\{/g)) {
    assert.match(m[2], /hcms-open/, `unexpected body rule: ${m[2]}`)
  }
})

test('theme flags concatenate onto the shell element', () => {
  const css = readTheme()
  assert.match(css, /\.hcms-shell\.dark\b/)
  assert.match(css, /\.hcms-shell\[data-theme="dark"\]/)
})

test('@font-face url is rewritten to the absolute CDN (loads from any host)', () => {
  const css = readTheme()
  assert.match(css, /@font-face/)
  assert.match(css, /url\('https:\/\/cdn\.jsdelivr\.net\/npm\/mirk-interface@[\d.]+\/fonts\//)
  assert.doesNotMatch(css, /url\(['"]?fonts\//, 'no relative font url remains')
})

test('pixel-quiet token retune + geometry are present and scoped', () => {
  const css = readTheme()
  assert.match(css, /\.hcms-shell\.pixel-quiet\s*\{/)
  assert.match(css, /--mirk-canvas:\s*#F7F2EA/)
  assert.match(css, /\.hcms-shell-minibar\b/)
  assert.match(css, /\.hcms-shell-body\b/)
})

test('a mirk tags box used as the array slot keeps mirk row layout, not the stacked list', () => {
  const css = stripComments(readTheme())
  // The generic stacked-list layout is unlayered, so it would beat mirk's
  // @layer-components row-wrap on a slot that is also a .mirk-tags box and stack
  // the chips vertically. The rule must exempt mirk-tags so mirk governs it.
  assert.match(css, /\.hcms-array-items:not\(\.mirk-tags\)\s*\{[^}]*flex-direction:\s*column/)
  // No unguarded array-items rule may force a column onto a tags box.
  assert.doesNotMatch(css, /(^|[\s,}])\.hcms-array-items\s*\{[^}]*flex-direction:\s*column/)
})

test('vendored mirk runtime is guarded for non-browser realms', () => {
  const js = fs.readFileSync(vendorPath, 'utf8')
  assert.match(js, /typeof window !== "undefined"/)
  assert.match(js, /window\.__mirk/)
})

test('build-theme.js is deterministic (regenerating yields identical output)', () => {
  const before = readTheme()
  execFileSync('node', ['scripts/build-theme.js'], { cwd: root, stdio: 'ignore' })
  const after = readTheme()
  assert.equal(after, before, 'generated theme is stable across runs')
})
