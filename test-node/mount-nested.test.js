import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api, refresh } from '../src/hypercms.js'

// mountTo a nested host inside pageRoot — shell-isolation walk-up must find
// the right ancestor so the shell isn't snapshotted into rollback clones.
// v0.3 fix #2 (Critical): withoutShell must detach only shellRoot, not an
// ancestor under pageRoot. With the old walk-up, mounting the shell into an
// <aside> that sat alongside page content inside the wrapper would detach the
// whole wrapper — refresh would extract empty data because the page content
// was gone too.
test('mountTo nested in wrapper alongside page content: refresh still sees page data', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "tags": "li[]" }
    </script>
    <div id="wrapper">
      <ul id="tags"><li>alpha</li><li>beta</li></ul>
      <aside id="shell-mount" save-ignore></aside>
    </div>
  </body></html>`)
  const mount = document.getElementById('shell-mount')
  open({ mountTo: mount })
  try {
    // Mutate the page list outside the shell and call refresh; v0.3's detach-
    // only-shellRoot makes the page (still living in the wrapper) visible
    // during the engine.extract.
    document.querySelector('#tags').innerHTML = '<li>gamma</li><li>delta</li>'
    refresh()
    assert.deepEqual(api.getData().tags, ['gamma', 'delta'])
  } finally {
    close()
    dom.window.close()
  }
})

test('mountTo nested under pageRoot still preserves shell on structural error', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
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
