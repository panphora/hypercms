import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'

// The retry arms once per module lifetime, so this lives in its own file: any
// earlier open() in the same process would have armed it against a document
// that is gone by the time these run.

const FIXTURE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello</h1>
</body></html>`

// On the flat bundle the client's own import waterfall can finish after
// hypercms evaluates, so the first open() finds no onSnapshot and both installs
// return without recording success. Nothing called them again, which left the
// dashboard's ?cms=true entry path with no clone cleanup at all.
test('both save hooks install on the readiness signal when the capability arrived late', () => {
  const dom = loadPage(FIXTURE)
  const win = dom.window

  open()
  close()

  const snapshots = []
  const prepares = []
  win.hyperclay.onSnapshot = (fn) => snapshots.push(fn)
  win.hyperclay.onPrepareForSave = (fn) => prepares.push(fn)
  assert.equal(snapshots.length, 0, 'nothing installed while the capability was missing')
  assert.equal(prepares.length, 0)

  win.document.dispatchEvent(new win.CustomEvent('hyperclay:ready'))
  assert.equal(snapshots.length, 1, 'the readiness signal installed the snapshot hook')
  assert.equal(prepares.length, 1, 'and the save-prepare hook')

  win.document.dispatchEvent(new win.CustomEvent('hyperclay:ready'))
  assert.equal(snapshots.length, 1, 'a later signal does not register a second hook')
  assert.equal(prepares.length, 1)

  reset(dom)
})
