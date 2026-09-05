import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'

// The snapshot hook installs once per module lifetime, so this lives in its own
// file: any earlier open() in the same process that found an onSnapshot would
// have installed it already, and this test would pass having proved nothing.

const FIXTURE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello <em>you</em></h1>
</body></html>`

class FakeRichClay {
  constructor(el) {
    this.element = el
    this.squire = null
    this.unsupported = false
    el.setAttribute('data-richclay', '')
    el.setAttribute('contenteditable', 'true')
    this.active = true
  }
  focus() {}
  destroy() {
    this.element.removeAttribute('contenteditable')
    this.element.removeAttribute('data-richclay')
  }
  static stripFromClone(docEl) {
    for (const el of docEl.querySelectorAll('[data-richclay]')) {
      el.removeAttribute('contenteditable')
    }
  }
}

// The failure this covers: on a page whose client finishes loading after
// hypercms, open() finds no onSnapshot and installs nothing. Binding is the
// second trigger, and the reliable one — by the time anyone has clicked a
// heading the client is certainly up. Without it, the editor's contenteditable
// goes out with every snapshot: into the saved file, and to every other browser
// live sync reaches.
test('binding a text target installs the snapshot hook the open() could not', () => {
  const dom = loadPage(FIXTURE)
  const win = dom.window
  win.richclay = { RichClay: FakeRichClay }

  open({ view: 'inline' })

  const snapshots = []
  win.hyperclay.onSnapshot = (fn) => snapshots.push(fn)
  assert.equal(snapshots.length, 0, 'open() had no capability to install into')

  const title = win.document.querySelector('.title')
  title.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.equal(title.hasAttribute('data-hcms-bound'), true, 'the click really did bind')
  assert.equal(snapshots.length, 1, 'the bind installed the hook')

  // And the hook that landed is the real cleanup, not just any callback.
  const clone = win.document.body.cloneNode(true)
  snapshots[0](clone)
  assert.equal(clone.querySelector('.title').outerHTML, '<h1 class="title">Hello <em>you</em></h1>')

  close()
  reset(dom)
})
