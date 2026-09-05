import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { cleanRichClayFromSnapshot, markBound, BOUND_ATTR, RC_OWNED_ATTR } from '../src/richclay-bridge.js'

// richclay is not a dependency of hypercms, and a test that reached into the
// sibling repo by relative path would break for anyone who installs this
// package. So the strip below is a stand-in.
//
// Mirrors richclay's real strip, from richclay/src/hyperclay.js:194-200: it
// iterates RICHCLAY_SELECTOR and skips any region whose data-richclay-active is
// not "true", then removes the runtime attributes. This is a logic test of
// hypercms's ORDERING, not an integration test against richclay.
const RICHCLAY_SELECTOR = '[data-richclay], [richclay], [editable], [clay-editable]'

function makeFakeRichClay() {
  const calls = []
  class FakeRichClay {
    static stripFromClone(docEl) {
      calls.push(docEl)
      docEl.querySelectorAll(RICHCLAY_SELECTOR).forEach((region) => {
        if (region.getAttribute('data-richclay-active') !== 'true') return
        region.removeAttribute('contenteditable')
        region.removeAttribute('data-richclay-active')
        region.removeAttribute('data-richclay-runtime-contenteditable')
        if (region.getAttribute('data-richclay-runtime-marker') === 'true') {
          region.removeAttribute('data-richclay')
        }
        region.removeAttribute('data-richclay-runtime-marker')
      })
    }
  }
  return { FakeRichClay, calls }
}

const BOUND_HEADING =
  '<h1 data-richclay data-richclay-runtime-marker="true" data-richclay-active="true" data-richclay-runtime-contenteditable="true" contenteditable="true" data-hcms-bound>Title</h1>'

function makeClone(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  return { dom, clone: dom.window.document.body }
}

test('a bound heading comes out of the snapshot as plain markup', () => {
  const { dom, clone } = makeClone(BOUND_HEADING)
  const { FakeRichClay } = makeFakeRichClay()
  cleanRichClayFromSnapshot(clone, { richclay: { RichClay: FakeRichClay } })
  assert.equal(clone.querySelector('h1').outerHTML, '<h1>Title</h1>')
  dom.window.close()
})

test('THE ORDER TRAP: unmark-then-strip ships a permanently contenteditable heading', () => {
  const { FakeRichClay } = makeFakeRichClay()

  // Both orders written out locally, so the test document itself records why the
  // shipped one is the shipped one. Removing data-richclay first drops the
  // element out of RICHCLAY_SELECTOR, so the strip never sees it.
  const unmark = (cloneDocEl) => {
    for (const el of cloneDocEl.querySelectorAll(`[${BOUND_ATTR}]`)) {
      el.removeAttribute('data-richclay')
      el.removeAttribute(BOUND_ATTR)
    }
  }
  const unmarkThenStrip = (cloneDocEl) => { unmark(cloneDocEl); FakeRichClay.stripFromClone(cloneDocEl) }
  const stripThenUnmark = (cloneDocEl) => { FakeRichClay.stripFromClone(cloneDocEl); unmark(cloneDocEl) }

  const wrong = makeClone(BOUND_HEADING)
  unmarkThenStrip(wrong.clone)
  assert.match(wrong.clone.querySelector('h1').outerHTML, /contenteditable/)

  const right = makeClone(BOUND_HEADING)
  stripThenUnmark(right.clone)
  assert.equal(right.clone.querySelector('h1').outerHTML, '<h1>Title</h1>')

  wrong.dom.window.close()
  right.dom.window.close()
})

test("an author's own data-richclay element is byte-identical before and after", () => {
  const { dom, clone } = makeClone(`${BOUND_HEADING}<p data-richclay>Authored</p>`)
  const { FakeRichClay } = makeFakeRichClay()
  const before = clone.querySelector('p').outerHTML
  cleanRichClayFromSnapshot(clone, { richclay: { RichClay: FakeRichClay } })
  assert.equal(clone.querySelector('p').outerHTML, before)
  dom.window.close()
})

test('a clone with nothing hypercms bound never calls the strip', () => {
  const { dom, clone } = makeClone('<h1 data-richclay data-richclay-active="true">Authored</h1>')
  const { FakeRichClay, calls } = makeFakeRichClay()
  cleanRichClayFromSnapshot(clone, { richclay: { RichClay: FakeRichClay } })
  assert.equal(calls.length, 0)
  dom.window.close()
})

test('a RichClay with no stripFromClone leaves the page attributes to richclay', () => {
  const { dom, clone } = makeClone(BOUND_HEADING)
  class OldRichClay {}
  assert.doesNotThrow(() => {
    cleanRichClayFromSnapshot(clone, { richclay: { RichClay: OldRichClay } })
  })
  const h1 = clone.querySelector('h1')
  // Nothing stripped this element, so contenteditable is still on it. Removing
  // the opt-in while leaving contenteditable behind is worse than leaving both:
  // it would take the author's own marker out of the file AND leave the heading
  // permanently editable. Only the CMS's own marker comes off here.
  assert.equal(h1.hasAttribute('data-richclay'), true)
  assert.equal(h1.hasAttribute(BOUND_ATTR), false)
  dom.window.close()
})

test("an authored data-richclay on a BOUND element survives the snapshot", () => {
  const { dom, clone } = makeClone(
    '<h2 data-richclay data-richclay-active="true" data-richclay-runtime-contenteditable="true" contenteditable="true" data-hcms-bound>Authored and bound</h2>'
  )
  const { FakeRichClay } = makeFakeRichClay()
  cleanRichClayFromSnapshot(clone, { richclay: { RichClay: FakeRichClay } })
  const h2 = clone.querySelector('h2')
  // No runtime marker, so richclay never invented this attribute: the author
  // did, and hypercms binding the element is not a reason to take their opt-in
  // out of their file.
  assert.equal(h2.hasAttribute('data-richclay'), true)
  assert.equal(h2.hasAttribute('contenteditable'), false)
  assert.equal(h2.hasAttribute(BOUND_ATTR), false)
  dom.window.close()
})

test('the bound marker survives cloneNode, which is what the whole design rests on', () => {
  const { dom, clone } = makeClone('<h1 class="title">Title</h1>')
  const live = clone.querySelector('.title')
  markBound(live)
  const copy = clone.cloneNode(true)
  assert.equal(copy.querySelector('.title').hasAttribute(BOUND_ATTR), true)
  dom.window.close()
})

// --- review round 3 ------------------------------------------------------------

// richclay 0.4.0, which is what clayjs and hyperclayjs both vendor. Grepped
// against both vendor files: no data-richclay-runtime-marker anywhere in either
// bundle, and no removeAttribute('data-richclay') anywhere either. So its strip
// takes the runtime state off and leaves the mount selector in the file, which
// is the case the fake above cannot show because it models 0.5.0.
class VendoredRichClay {
  static stripFromClone(docEl) {
    docEl.querySelectorAll(RICHCLAY_SELECTOR).forEach((region) => {
      if (region.getAttribute('data-richclay-active') !== 'true') return
      region.removeAttribute('contenteditable')
      region.removeAttribute('data-richclay-active')
      region.removeAttribute('data-richclay-runtime-contenteditable')
    })
  }
}

const OURS_HEADING =
  '<h1 data-richclay data-richclay-active="true" data-richclay-runtime-contenteditable="true" contenteditable="true" data-hcms-bound="rich" data-hcms-owns-richclay="true">Title</h1>'

const AUTHORED_BOUND_HEADING =
  '<h2 data-richclay data-richclay-active="true" data-richclay-runtime-contenteditable="true" contenteditable="true" data-hcms-bound="rich">Authored and bound</h2>'

test('G2: on the vendored strip, hypercms removes the data-richclay its own bind put there', () => {
  const { dom, clone } = makeClone(OURS_HEADING)
  cleanRichClayFromSnapshot(clone, { richclay: { RichClay: VendoredRichClay } })
  // data-richclay is richclay's mount selector: left in the file it turns every
  // heading anyone clicked into a permanent richclay region.
  assert.equal(clone.querySelector('h1').outerHTML, '<h1>Title</h1>')
  dom.window.close()
})

test("G2b: an author's own data-richclay survives, on the vendored strip, even where hypercms bound", () => {
  const { dom, clone } = makeClone(AUTHORED_BOUND_HEADING)
  cleanRichClayFromSnapshot(clone, { richclay: { RichClay: VendoredRichClay } })
  const h2 = clone.querySelector('h2')
  // No ownership flag, so hypercms did not put this opt-in here and binding the
  // element is not a reason to take it out of the author's file.
  assert.equal(h2.hasAttribute('data-richclay'), true)
  assert.equal(h2.hasAttribute('contenteditable'), false)
  assert.equal(h2.hasAttribute(BOUND_ATTR), false)
  assert.equal(h2.hasAttribute(RC_OWNED_ATTR), false)
  dom.window.close()
})

test('markBound writes the ownership flag only when the bind is what mounted richclay', () => {
  const { dom, clone } = makeClone('<h1 class="ours">A</h1><h2 class="theirs" data-richclay>B</h2>')
  markBound(clone.querySelector('.ours'), true, true)
  markBound(clone.querySelector('.theirs'), true, false)
  assert.equal(clone.querySelector('.ours').getAttribute(RC_OWNED_ATTR), 'true')
  assert.equal(clone.querySelector('.theirs').hasAttribute(RC_OWNED_ATTR), false)
  dom.window.close()
})
