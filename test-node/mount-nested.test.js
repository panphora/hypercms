import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// mountTo a nested host inside pageRoot — shell-isolation walk-up must find
// the right ancestor so the shell isn't snapshotted into rollback clones.
test('mountTo nested under pageRoot still preserves shell on structural error', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div id="page">
      <div><div class="product"><span class="n">A</span></div></div>
      <aside id="shell-mount" save-ignore></aside>
    </div>
  </body></html>`)
  const mount = document.getElementById('shell-mount')
  open({ mountTo: mount })
  try {
    // Trigger a structural commit that hits an engine error. The simplest
    // structural path that the engine rejects is removing the only seed item
    // from a list — after our removeItem call, the live page list is empty,
    // then an `addItem` requires a seed; EmptyListInsert fires.
    api.removeItem('products.0')
    let lastErr = null
    document.body.addEventListener('hcms:error', (e) => { lastErr = e.detail.error })
    api.addItem('products')
    assert.ok(lastErr, 'structural error dispatched')
    // Shell still alive and mounted at its host:
    const shell = mount.querySelector('[data-hcms-shell]')
    assert.ok(shell, 'shell preserved under nested mount across rollback')
  } finally {
    close()
    dom.window.close()
  }
})
