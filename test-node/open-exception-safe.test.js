import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist', 'hypercms.min.js')

// open() mounts the shell BEFORE installObserver, which throws when
// window.hyperclay.Mutation is absent. A throw there used to strand the shell in
// the DOM forever: close() early-returns while state.isOpen is false, so the
// orphan could never be torn down. open() must now clean up the shell it mounted
// and rethrow — loud failure for host misuse, but the DOM stays sane.
test('open(): a throw after mount leaves no orphan shell', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
    <h1 class="title">x</h1>
  </body></html>`)
  // Reproduce the failing precondition: no Mutation utility installed.
  delete dom.window.hyperclay.Mutation
  delete globalThis.hyperclay.Mutation

  assert.throws(() => open(), /Mutation/)
  assert.equal(isOpen(), false, 'state.isOpen stays false after the throw')
  assert.equal(document.querySelector('[data-hcms-shell]'), null, 'no orphan shell remains')

  dom.window.close()
})

test('open(): recovers cleanly on a later open once Mutation is present', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
    <h1 class="title">x</h1>
  </body></html>`)
  delete dom.window.hyperclay.Mutation
  delete globalThis.hyperclay.Mutation
  assert.throws(() => open(), /Mutation/)
  assert.equal(document.querySelectorAll('[data-hcms-shell]').length, 0)

  // Restore the Mutation stub the helper installs and open cleanly.
  const off = () => () => {}
  const stub = { onAnyChange: off, onAddOrRemove: off, onAddElement: off, onRemoveElement: off, onAttribute: off, pause() {}, resume() {} }
  dom.window.hyperclay.Mutation = stub
  globalThis.hyperclay.Mutation = stub

  open()
  assert.equal(isOpen(), true)
  assert.equal(document.querySelectorAll('[data-hcms-shell]').length, 1, 'exactly one shell after recovery')
  close()
  dom.window.close()
})

// Tiny smoke for the built IIFE: both fixes must survive minification and the
// bundle must stay syntactically valid. The patient auto-open uses a setInterval
// poll and both failure paths warn (never throw) — assert those markers are baked
// in, and that `node --check` parses the bundle.
test('dist: built bundle parses and carries both fixes', () => {
  const src = readFileSync(DIST, 'utf8')
  assert.match(src, /setInterval/, 'patient auto-open poll present')
  assert.match(src, /auto-open gave up/, 'auto-open deadline warning present')
  assert.match(src, /auto-open failed/, 'auto-open try/catch warning present')
  // node --check on the IIFE: a syntax error (or a throw-introducing edit that
  // breaks parsing) fails the build smoke here.
  execFileSync(process.execPath, ['--check', DIST])
})
