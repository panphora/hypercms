import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { cleanRichClayFromSnapshot, markBound, BOUND_ATTR } from '../src/richclay-bridge.js'

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
      })
    }
  }
  return { FakeRichClay, calls }
}

const BOUND_HEADING =
  '<h1 data-richclay data-richclay-active="true" data-richclay-runtime-contenteditable="true" contenteditable="true" data-hcms-bound>Title</h1>'

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

test('a RichClay with no stripFromClone static still gets the markers removed', () => {
  const { dom, clone } = makeClone(BOUND_HEADING)
  class OldRichClay {}
  assert.doesNotThrow(() => {
    cleanRichClayFromSnapshot(clone, { richclay: { RichClay: OldRichClay } })
  })
  const h1 = clone.querySelector('h1')
  assert.equal(h1.hasAttribute('data-richclay'), false)
  assert.equal(h1.hasAttribute(BOUND_ATTR), false)
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
