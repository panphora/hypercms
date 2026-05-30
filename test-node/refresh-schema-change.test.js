import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, refresh, api } from '../src/hypercms.js'

// If livesync swaps the rules tag, refresh should re-read it and re-derive
// formRules so the form structure tracks the new schema.
test('refresh: rules tag swap is picked up', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
    <h1 class="title">Hi</h1>
    <p class="sub">sub</p>
  </body></html>`)
  open()
  try {
    assert.deepEqual(Object.keys(api.getData()), ['title'])
    const old = document.querySelector('script[data-rules-name~="cms"]')
    old.textContent = JSON.stringify({ title: '.title', sub: '.sub' })
    refresh()
    const data = api.getData()
    assert.deepEqual(Object.keys(data).sort(), ['sub', 'title'])
    assert.equal(data.sub, 'sub')
  } finally {
    close()
    dom.window.close()
  }
})
