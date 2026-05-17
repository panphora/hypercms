import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// After v0.2's open() initializes lastFingerprint, the first setValue with
// the same value should short-circuit (no change event, no apply).
test('first setValue with unchanged value is a no-op', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
    <h1 class="title">Hello</h1>
  </body></html>`)
  open()
  try {
    let changes = 0
    document.body.addEventListener('hcms:change', () => { changes++ })
    api.setValue('title', 'Hello')
    assert.equal(changes, 0, 'no change event when value matches initial')
  } finally {
    close()
    dom.window.close()
  }
})
