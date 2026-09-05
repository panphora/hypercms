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

test('placeHandle: a handle taller than its anchor sits beside it, covering nothing', () => {
  // The link that started this: in a real browser a 36x31 handle over a 108x18
  // anchor covered 28% of it, including the last word of the link text.
  const anchor = rect(100, 200, 108, 18)
  const handle = { width: 36, height: 31 }
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.equal(out.mode, 'beside-right')
  assert.ok(out.x >= anchor.right, 'the handle starts at or after the anchor ends')
  assert.equal(out.y + handle.height / 2, anchor.top + anchor.height / 2, 'centred on the anchor')
})

test('placeHandle: a roomy anchor still overlaps, because there is plenty left to see', () => {
  const anchor = rect(100, 200, 200, 120)
  const handle = { width: 36, height: 31 }
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.equal(out.mode, 'over')
  assert.ok(out.x < anchor.right, 'it really is over the anchor, not beside it')
})

test('placeHandle: a small anchor with no room to its right flips to its left', () => {
  const anchor = rect(880, 200, 108, 18)
  const handle = { width: 36, height: 31 }
  assert.ok(
    anchor.right + 4 + handle.width > VIEWPORT.width - VIEWPORT_INSET,
    'the right side really is too tight'
  )
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.equal(out.mode, 'beside-left')
  assert.ok(out.x + handle.width <= anchor.left, 'it clears the anchor on the left')
})

test('placeHandle: a small anchor in the top corner stays inside both insets', () => {
  const anchor = rect(0, 0, 40, 10)
  const handle = { width: 36, height: 31 }
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.ok(out.x >= VIEWPORT_INSET && out.y >= VIEWPORT_INSET)
  assert.ok(out.x + handle.width <= VIEWPORT.width - VIEWPORT_INSET)
})

// prefer: 'corner' is what a control that BELONGS to a row asks for. The two
// tests above stay the whole statement of the auto rule handles keep using.
test('placeHandle: prefer corner overrides the small-anchor rule and puts the control on the row', () => {
  // The measured case: a 114x31 row strip on a 718x36 card. 36 is short of the
  // 46.5 the auto rule wants, so it sends the strip beside the row instead —
  // right for a handle floating near a link, wrong for a strip that belongs to
  // the row it operates on.
  const anchor = rect(100, 400, 718, 36)
  const strip = { width: 114, height: 31 }

  const auto = placeHandle({ anchor, handle: strip, viewport: VIEWPORT })
  assert.equal(auto.mode, 'beside-right', 'the auto rule really does send this one beside')
  assert.ok(auto.x >= anchor.right, 'and beside here means wholly outside the row')

  const corner = placeHandle({
    anchor, handle: strip, viewport: VIEWPORT, prefer: 'corner', inset: 0,
  })
  assert.equal(corner.mode, 'over')
  assert.ok(corner.x >= anchor.left, 'inside the row on the left')
  assert.ok(corner.x + strip.width <= anchor.right, 'and inside it on the right')
  assert.ok(corner.y >= anchor.top, 'inside it at the top')
  assert.ok(corner.y + strip.height <= anchor.bottom, 'and at the bottom')
})

test('placeHandle: corner mode is still clamped to the viewport, on both axes', () => {
  // Flush against the top-right corner of the document, and too short for the
  // auto rule, so this is the corner branch doing the clamping and not the
  // beside one.
  const anchor = rect(892, 0, 108, 18)
  const strip = { width: 114, height: 31 }
  assert.equal(anchor.right, VIEWPORT.width, 'the anchor really is flush with the edge')
  assert.ok(
    anchor.right - strip.width > VIEWPORT.width - strip.width - VIEWPORT_INSET,
    'unclamped it would run off the right'
  )

  const out = placeHandle({
    anchor, handle: strip, viewport: VIEWPORT, prefer: 'corner', inset: 0,
  })
  assert.equal(out.mode, 'over')
  assert.equal(out.x, VIEWPORT.width - strip.width - VIEWPORT_INSET)
  assert.equal(out.y, VIEWPORT_INSET, 'and off the top of the fold')
})

test('placeHandle: a wide, thin anchor spanning the viewport is clamped, not pushed off the left', () => {
  // Too short to overlap and too wide to sit on the right, so it flips left and
  // the flip lands outside the viewport. This is the only case where the beside
  // path's clamp does any work.
  const anchor = rect(10, 200, 980, 18)
  const handle = { width: 36, height: 31 }
  const out = placeHandle({ anchor, handle, viewport: VIEWPORT })
  assert.equal(out.mode, 'beside-left')
  assert.ok(anchor.left - 4 - handle.width < VIEWPORT_INSET, 'unclamped it would be off-screen')
  assert.equal(out.x, VIEWPORT_INSET)
})
