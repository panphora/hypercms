import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, refresh, api } from '../src/hypercms.js'
import { withoutShell } from '../src/shell-isolation.js'
import { engine } from 'hyper-html-api'

// Repro from codex finding #1: shell items appear in extract.
// The fix is the shared withoutShell helper. Verify both the direct helper
// and the refresh()-mediated path produce clean extracts.
test('withoutShell helper: extract on pageRoot ignores mounted shell', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "tags": "li[]" }
    </script>
    <ul id="tags"><li>alpha</li><li>beta</li></ul>
  </body></html>`)
  open()
  try {
    const pageRoot = document.body
    const shellRoot = document.querySelector('[data-hcms-shell]')
    const rules = engine.findRulesIn(pageRoot) || engine.findRulesIn(document.documentElement)
    // Without withoutShell, the shell's li items would leak in.
    const data = withoutShell(pageRoot, shellRoot, (root) => engine.extract(root, rules.rules))
    assert.deepEqual(data.tags, ['alpha', 'beta'])
  } finally {
    close()
    dom.window.close()
  }
})

// v0.3 fix #1 (Critical): scalar applies must run against shell-less pageRoot
// too. Previously only structural applies wrapped withoutShell, so broad rules
// (`li[]`) mutated the shell's own li items mid-write.
test('scalar apply: writes to page only, never to shell li items', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "tags": "li[]" }
    </script>
    <ul id="tags"><li>alpha</li><li>beta</li></ul>
  </body></html>`)
  open()
  try {
    // Edit the first scalar-array input via the form, which triggers a
    // non-structural apply. Without v0.3's wrap, broad `li[]` would also
    // overwrite the shell's add-button li.
    const input = document.querySelector('[data-hcms-form-root] [data-hcms-array-item] input')
    input.value = 'GAMMA'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    // Page reflects edit:
    const pageTags = Array.from(document.querySelectorAll('#tags li')).map((l) => l.textContent)
    assert.deepEqual(pageTags, ['GAMMA', 'beta'])
    // Shell is still mounted + intact:
    const shell = document.querySelector('[data-hcms-shell]')
    assert.ok(shell, 'shell preserved')
    assert.ok(shell.querySelector('[data-hcms-form-root]'), 'form still inside shell')
  } finally {
    close()
    dom.window.close()
  }
})

test('refresh: form data after refresh matches page-only data', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "tags": "li[]" }
    </script>
    <ul id="tags"><li>alpha</li><li>beta</li></ul>
  </body></html>`)
  open()
  try {
    document.querySelector('#tags').innerHTML = '<li>gamma</li><li>delta</li>'
    refresh()
    assert.deepEqual(api.getData().tags, ['gamma', 'delta'])
  } finally {
    close()
    dom.window.close()
  }
})
