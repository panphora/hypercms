import { test } from 'node:test'
import assert from 'node:assert/strict'
import HyperMorph from 'hyper-morph'
import { loadPage } from './_helpers.js'
import { open, close, installStyles } from '../src/hypercms.js'

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello</h1>
</body></html>`

// Spy HyperMorph.morph: it's a non-writable inherited property, so shadow it
// with an own property and delete afterward to re-expose the inherited method.
function spyMorph(calls) {
  Object.defineProperty(HyperMorph, 'morph', {
    value: (root, frag, o) => calls.push(o),
    configurable: true,
    writable: true,
  })
}

test('open() subscribes to hyperclay:livesync-applied; the event refreshes with ignoreActiveValue:true; close() unsubscribes', () => {
  const dom = loadPage(FIXTURE)
  const calls = []
  spyMorph(calls)
  try {
    open()
    const ev = () => dom.window.document.dispatchEvent(
      new dom.window.CustomEvent('hyperclay:livesync-applied', { detail: { seq: 1 } })
    )

    ev()
    assert.equal(calls.length, 1, 'a livesync-applied event triggers one form refresh')
    assert.equal(calls[0].ignoreActiveValue, true, 'livesync refresh preserves the focused field')

    ev()
    assert.equal(calls.length, 2, 'a second event triggers a second refresh while open')

    close()
    ev()
    assert.equal(calls.length, 2, 'no refresh after close (unsubscribed)')
  } finally {
    delete HyperMorph.morph
    dom.window.close()
  }
})

test('livesync resync restores shell chrome (re-injects #hcms-shell-styles + re-adds hcms-open) after a morph wipes it', () => {
  const dom = loadPage(FIXTURE)
  const calls = []
  spyMorph(calls)
  try {
    installStyles('.hcms-shell { color: red }')
    open()
    const doc = dom.window.document
    assert.ok(doc.getElementById('hcms-shell-styles'), 'style injected on open')
    assert.ok(doc.body.classList.contains('hcms-open'), 'hcms-open set on open')

    // Simulate what a full-document live-sync morph does to the out-of-subtree
    // chrome: drop the head stylesheet and the body class.
    doc.getElementById('hcms-shell-styles').remove()
    doc.body.classList.remove('hcms-open')

    doc.dispatchEvent(new dom.window.CustomEvent('hyperclay:livesync-applied', { detail: { seq: 2 } }))

    assert.ok(doc.getElementById('hcms-shell-styles'), 'stylesheet re-injected after morph')
    assert.ok(doc.body.classList.contains('hcms-open'), 'hcms-open re-added after morph')
  } finally {
    close()
    installStyles('')
    delete HyperMorph.morph
    dom.window.close()
  }
})

test('a save-prepare hook strips hcms-open/hcms-overlay/hcms-side-left from the save clone but keeps page classes', () => {
  const dom = loadPage(FIXTURE)
  const hooks = []
  // Stub the hyperclayjs save pipeline so installSavePrepareHook (run at open)
  // captures the hook hypercms registers.
  dom.window.hyperclay.onPrepareForSave = (fn) => hooks.push(fn)
  try {
    open()
    assert.equal(hooks.length, 1, 'hypercms registered exactly one prepare-for-save hook')

    // Build a clone whose body carries both chrome classes and a real page class.
    const clone = dom.window.document.documentElement.cloneNode(true)
    clone.querySelector('body').className = 'hcms-open hcms-overlay hcms-side-left page-theme'

    hooks[0](clone)

    const cls = clone.querySelector('body').classList
    assert.equal(cls.contains('hcms-open'), false, 'hcms-open stripped from save clone')
    assert.equal(cls.contains('hcms-overlay'), false, 'hcms-overlay stripped')
    assert.equal(cls.contains('hcms-side-left'), false, 'hcms-side-left stripped')
    assert.equal(cls.contains('page-theme'), true, 'unrelated page class preserved')
  } finally {
    close()
    dom.window.close()
  }
})
