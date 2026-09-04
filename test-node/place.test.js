import { test } from 'node:test'
import assert from 'node:assert/strict'
import { place, placeHandle, GAP, VIEWPORT_INSET, PLACEMENT_SLACK } from '../src/place.js'

// place() is pure geometry, so no DOM here: rects are the plain objects a real
// getBoundingClientRect() would hand back.
function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

const VIEWPORT = { width: 1000, height: 800 }
const BAR = { width: 240, height: 60 }

test('place: room above the anchor puts the popover above it', () => {
  const anchor = rect(100, 400, 200, 40)
  const out = place({ anchor, bar: BAR, viewport: VIEWPORT })
  assert.equal(out.mode, 'above')
  assert.equal(out.y, anchor.top - GAP - BAR.height)
  assert.equal(out.x, anchor.left)
})

test('place: an anchor near the top with no room above falls to below', () => {
  const anchor = rect(100, 10, 200, 40)
  const out = place({ anchor, bar: BAR, viewport: VIEWPORT })
  assert.equal(out.mode, 'below')
  assert.equal(out.y, anchor.bottom + GAP)
})

test('place: an anchor taller than the viewport\'s spare room goes to a side rail', () => {
  const viewport = { width: 1000, height: 400 }
  const anchor = rect(100, 5, 200, 390)
  const out = place({ anchor, bar: BAR, viewport })
  assert.ok(
    out.mode === 'rail-left' || out.mode === 'rail-right',
    `expected a side rail, got ${out.mode}`
  )
  assert.equal(out.mode, 'rail-right', 'the wider side wins')
})

test('place: an anchor scrolled entirely off the top is hidden', () => {
  const anchor = rect(100, -100, 200, 80)
  const out = place({ anchor, bar: BAR, viewport: VIEWPORT })
  assert.equal(out.mode, 'hidden')
})

test('place: an anchor that fills the viewport pins the popover to the top', () => {
  const viewport = { width: 400, height: 300 }
  const anchor = rect(0, 0, 400, 300)
  const out = place({ anchor, bar: BAR, viewport })
  assert.equal(out.mode, 'pinned')
  assert.equal(out.y, VIEWPORT_INSET)
})

// aboveY lands at 5: inside the slack window [VIEWPORT_INSET - PLACEMENT_SLACK,
// VIEWPORT_INSET), so the rung passes only for an anchor that is already above.
test('place: hysteresis keeps an already-above popover above at the boundary', () => {
  const aboveY = VIEWPORT_INSET - 3
  assert.ok(aboveY < VIEWPORT_INSET && aboveY >= VIEWPORT_INSET - PLACEMENT_SLACK)
  const anchor = rect(100, aboveY + GAP + BAR.height, 200, 40)

  const sticky = place({ anchor, bar: BAR, viewport: VIEWPORT, current: 'above' })
  assert.equal(sticky.mode, 'above', 'current:above holds the mode through the boundary')

  const fresh = place({ anchor, bar: BAR, viewport: VIEWPORT, current: null })
  assert.notEqual(fresh.mode, 'above', 'with no current mode there is no slack to spend')
  assert.equal(fresh.mode, 'below')
})

test('placeHandle: a mid-page anchor gets its handle on the top-right corner', () => {
  const anchor = rect(100, 200, 200, 40)
  const handle = { width: 24, height: 24 }
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.equal(out.x, anchor.right - handle.width + 6)
  assert.equal(out.y, anchor.top - 6)
})

test('placeHandle: an anchor flush with the right edge is clamped inside the viewport', () => {
  const anchor = rect(800, 200, 200, 40)
  const handle = { width: 24, height: 24 }
  assert.equal(anchor.right, VIEWPORT.width, 'the anchor really is flush with the edge')
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.equal(out.x, VIEWPORT.width - handle.width - VIEWPORT_INSET)
  assert.ok(out.x + handle.width <= VIEWPORT.width - VIEWPORT_INSET)
})

test('placeHandle: an anchor at the very top of the document is clamped below the top inset', () => {
  const anchor = rect(100, 0, 200, 40)
  const handle = { width: 24, height: 24 }
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.equal(out.y, VIEWPORT_INSET)
})
