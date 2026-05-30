import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api, refresh } from '../src/hypercms.js'

// External mutation + refresh + edit back to prior value must still commit.
// Without v0.2's updateFingerprint hook on refresh, lastFingerprint stays at
// the original value and the second edit short-circuits.
test('refresh updates fingerprint so edits-back commit', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "title": ".title" }
    </script>
    <h1 class="title">First</h1>
  </body></html>`)
  open()
  try {
    let changes = 0
    document.body.addEventListener('hcms:change', () => { changes++ })

    // External mutation — page becomes "Second", form follows on refresh.
    document.querySelector('.title').textContent = 'Second'
    refresh()
    assert.equal(api.getData().title, 'Second')

    // Edit form back to the original value; should still commit, not short-circuit.
    const input = document.querySelector('[data-hcms-form-root] input')
    input.value = 'First'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(document.querySelector('.title').textContent, 'First', 'page reflects revert')
    assert.ok(changes >= 1, 'change event fired for the revert')
  } finally {
    close()
    dom.window.close()
  }
})
