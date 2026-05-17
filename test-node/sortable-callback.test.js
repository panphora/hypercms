import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

// The onsorted attribute must point at a callable that's globally reachable
// in the hyperclayjs sortable's resolution path. After v0.2 we use a flat
// `hypercmsCommit` global so the [sortable] attribute can call it directly.
test('sortable container has onsorted attribute pointing at a global callable', async () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div><div class="product"><span class="n">A</span></div></div>
  </body></html>`)
  open()
  try {
    const slot = document.querySelector('[data-hcms-form-root] .hcms-array-items')
    assert.ok(slot, 'array slot present')
    const cb = slot.getAttribute('onsorted')
    assert.match(cb, /hypercmsCommit\(\)/, 'onsorted invokes hypercmsCommit()')
    assert.equal(typeof window.hypercmsCommit, 'function', 'hypercmsCommit is callable on window')
    // Manually invoke as if from hyperclayjs's sortable (new Function('return (async function(evt) { ... })'))
    const fn = new Function(`return (async function(evt) { ${cb} })`)()
    await fn({})
    // Page should still match form state — no errors thrown.
    const path = slot.parentElement.getAttribute('data-hcms-path')
    assert.equal(path, 'products')
  } finally {
    close()
    dom.window.close()
  }
})
