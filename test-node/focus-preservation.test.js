import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

// Scalar commits must preserve focus + selection on the focused input.
// Before v0.2 the apply-loop detached the entire shell for snapshot, blurring
// the input on every keystroke. v0.2 scalar path skips snapshot entirely.
test('keystroke commit preserves focus + selection on input', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "title": ".title" }
    </script>
    <h1 class="title">Hello</h1>
  </body></html>`)
  open()
  try {
    const input = document.querySelector('[data-hcms-form-root] input')
    assert.ok(input, 'form input present')
    input.focus()
    input.value = 'Helloo'
    input.setSelectionRange(6, 6)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(document.activeElement, input, 'focus retained after commit')
    assert.equal(document.querySelector('.title').textContent, 'Helloo', 'page reflects new value')
    assert.equal(input.selectionStart, 6, 'selection start preserved')
    assert.equal(input.selectionEnd, 6, 'selection end preserved')
  } finally {
    close()
    dom.window.close()
  }
})
