import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

// Regression for the second-pass High finding: open()/close() toggle chrome-only
// classes on document.body (hcms-open, etc.). With undo loaded, those must NOT
// enter the undo stack (suppressUndo wraps mountShell / shell.destroy), while
// real page-content edits still are recorded.

const PAGE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".t" }
  </script>
  <h1 class="t">Hello</h1>
</body></html>`

async function loadUndo() {
  try { return (await import('../../hyper-undo/src/scope.js')).createScope }
  catch { return null }
}

test('opening the CMS does not put the shell chrome into the undo stack', async () => {
  const createScope = await loadUndo()
  if (!createScope) return
  if (isOpen()) close()
  const dom = loadPage(PAGE)
  const scope = createScope({ scope: document.body, idleWindowMs: 20 })
  scope.start()
  window.hyperclay.undo = scope
  try {
    open()
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(document.body.classList.contains('hcms-open'), true, 'chrome applied')
    assert.equal(scope.canUndo, false, 'opening the CMS records no undo commit')
    // Belt-and-suspenders: an undo here must not strip the chrome.
    scope.undo()
    assert.equal(document.body.classList.contains('hcms-open'), true, 'undo never touches the shell chrome')
  } finally {
    window.hyperclay.undo = undefined
    scope.stop()
    close()
    dom.window.close()
  }
})

test('closing the CMS does not record the body-class removal', async () => {
  const createScope = await loadUndo()
  if (!createScope) return
  if (isOpen()) close()
  const dom = loadPage(PAGE)
  const scope = createScope({ scope: document.body, idleWindowMs: 20 })
  scope.start()
  window.hyperclay.undo = scope
  try {
    open()
    scope.clear() // baseline after open
    close()
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(document.body.classList.contains('hcms-open'), false, 'chrome removed')
    assert.equal(scope.canUndo, false, 'closing the CMS records no undo commit')
  } finally {
    window.hyperclay.undo = undefined
    scope.stop()
    if (isOpen()) close()
    dom.window.close()
  }
})

test('a real page edit while the CMS is open is still recorded and reversible', async () => {
  const createScope = await loadUndo()
  if (!createScope) return
  if (isOpen()) close()
  const dom = loadPage(PAGE)
  const scope = createScope({ scope: document.body, idleWindowMs: 20 })
  scope.start()
  window.hyperclay.undo = scope
  try {
    open()
    scope.clear()
    document.querySelector('h1.t').textContent = 'Changed' // real page content, outside the shell
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(scope.canUndo, true, 'real page edits are still recorded (suppression is scoped)')
    scope.undo()
    assert.equal(document.querySelector('h1.t').textContent, 'Hello', 'undo reverts the real edit')
  } finally {
    window.hyperclay.undo = undefined
    scope.stop()
    close()
    dom.window.close()
  }
})
