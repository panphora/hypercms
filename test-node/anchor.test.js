import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { isAnchorable, MIN_ANCHOR_PX } from '../src/anchor.js'

// jsdom has no layout engine: every getBoundingClientRect() answers 0x0, so a
// test that relied on the real box would report "not anchorable" for everything
// and prove nothing. Each case below stubs getBoundingClientRect on the element
// under test with the box a browser would report.
function rect(el, width, height) {
  el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 })
  return el
}

function makeDom(html) {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
}

test('isAnchorable: no element, and an object with no getBoundingClientRect, are not anchorable', () => {
  assert.equal(isAnchorable(null), false)
  assert.equal(isAnchorable(undefined), false)
  assert.equal(isAnchorable({ closest: () => null }), false)
})

test('isAnchorable: a heading with a real box is anchorable', () => {
  const dom = makeDom('<h1 class="title">Hello</h1>')
  const el = rect(dom.window.document.querySelector('.title'), 200, 24)
  assert.equal(isAnchorable(el), true)
  dom.window.close()
})

test('isAnchorable: an empty inline span with zero width is not anchorable', () => {
  const dom = makeDom('<span class="empty"></span>')
  const el = rect(dom.window.document.querySelector('.empty'), 0, 18)
  assert.equal(isAnchorable(el), false)
  dom.window.close()
})

test('isAnchorable: a real box inside [cms-template] is never anchorable', () => {
  const dom = makeDom('<div cms-template hidden><p class="seed">Item</p></div>')
  const el = rect(dom.window.document.querySelector('.seed'), 200, 24)
  assert.equal(isAnchorable(el), false)
  dom.window.close()
})

test('isAnchorable: a real box inside [data-hcms-shell] is never anchorable', () => {
  const dom = makeDom('<div data-hcms-shell><p class="chrome">Panel</p></div>')
  const el = rect(dom.window.document.querySelector('.chrome'), 200, 24)
  assert.equal(isAnchorable(el), false)
  dom.window.close()
})

test('isAnchorable: the area floor is inclusive — exactly MIN_ANCHOR_PX square is anchorable', () => {
  const dom = makeDom('<span class="tiny">x</span>')
  const el = rect(dom.window.document.querySelector('.tiny'), MIN_ANCHOR_PX, MIN_ANCHOR_PX)
  assert.equal(isAnchorable(el), true)
  dom.window.close()
})
