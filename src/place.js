// Where to put a floating thing next to a page element.
//
// COPIED, deliberately, from richclay/src/toolbar-float.js:1-59. Not imported:
// hypercms must not gain a hard richclay dependency to lay out a popover on a
// page that contains no rich text at all. The ladder is the same one richclay's
// floating toolbar has been using in production, and the copy is verbatim apart
// from the two notes below, so a fix on either side can be read across.
//
// Two differences from the original, both because a popover is not a toolbar:
//
//  1. A popover has ONE size. richclay measures a horizontal bar and a vertical
//     rail because its toolbar reflows between them; ours does not. Callers pass
//     the same box as both `bar` and `rail`, which collapses the side-rail rung
//     of the ladder into a plain "put it beside the anchor" without changing a
//     line of the math.
//
//  2. The `hidden` rung is a backstop here, not the visibility test. It compares
//     the anchor to the viewport, which cannot see an anchor clipped by an
//     overflow: hidden ancestor while still inside the viewport — the case that
//     floats a control over whatever is visible in its place. The inline view
//     decides visibility from an IntersectionObserver, which accounts for
//     ancestor clipping by construction (measured, plan §3.1.2), and only asks
//     for a placement once it knows the anchor is showing.

export const GAP = 16
export const GAP_LADDER = [16, 8, 0]
export const VIEWPORT_INSET = 8
export const PLACEMENT_SLACK = 4

// Pure placement ladder: above -> below -> beside -> pinned to viewport top.
// All coords are viewport-relative (the host is position: fixed). `current` gets
// PLACEMENT_SLACK of hysteresis so the mode doesn't flip-flop at exact
// boundaries while the page scrolls.
export function place({ anchor, bar, rail = bar, viewport, current = null }) {
  const slack = (mode) => (current === mode ? PLACEMENT_SLACK : 0)

  if (
    anchor.bottom <= 0 ||
    anchor.top >= viewport.height ||
    anchor.right <= 0 ||
    anchor.left >= viewport.width
  ) {
    return { mode: 'hidden', x: 0, y: 0 }
  }

  const clampX = (width) =>
    Math.max(VIEWPORT_INSET, Math.min(anchor.left, viewport.width - width - VIEWPORT_INSET))

  const aboveY = anchor.top - GAP - bar.height
  if (aboveY >= VIEWPORT_INSET - slack('above')) {
    return { mode: 'above', x: clampX(bar.width), y: aboveY }
  }

  const belowY = anchor.bottom + GAP
  if (belowY + bar.height <= viewport.height - VIEWPORT_INSET + slack('below')) {
    return { mode: 'below', x: clampX(bar.width), y: belowY }
  }

  const rightSpace = viewport.width - anchor.right - VIEWPORT_INSET
  const leftSpace = anchor.left - VIEWPORT_INSET
  const sides =
    rightSpace >= leftSpace
      ? [['rail-right', rightSpace], ['rail-left', leftSpace]]
      : [['rail-left', leftSpace], ['rail-right', rightSpace]]

  for (const [mode, space] of sides) {
    for (const gap of GAP_LADDER) {
      if (rail.width + gap > space + slack(mode)) continue
      const x =
        mode === 'rail-right'
          ? Math.min(anchor.right + gap, viewport.width - rail.width - VIEWPORT_INSET)
          : Math.max(anchor.left - gap - rail.width, VIEWPORT_INSET)
      const maxY = Math.min(anchor.bottom, viewport.height - VIEWPORT_INSET) - rail.height
      const y = Math.max(VIEWPORT_INSET, Math.min(Math.max(anchor.top, VIEWPORT_INSET), maxY))
      return { mode, x, y, gap }
    }
  }

  return { mode: 'pinned', x: clampX(bar.width), y: VIEWPORT_INSET }
}

// A handle sits ON its anchor's top-right corner, overlapping it, so it reads as
// belonging to that element rather than floating near it. No ladder: a handle is
// small enough that it always fits, and moving it around the anchor would make
// the page feel like it was shuffling under the pointer.
//
// The one thing it does need is the viewport clamp. A card flush against the
// right edge would otherwise put its handle half off-screen, and a heading at
// the very top of the document would put it above the fold.
export function placeHandle({ anchor, handle, viewport, inset = 6 }) {
  const x = Math.max(
    VIEWPORT_INSET,
    Math.min(anchor.right - handle.width + inset, viewport.width - handle.width - VIEWPORT_INSET)
  )
  const y = Math.max(
    VIEWPORT_INSET,
    Math.min(anchor.top - inset, viewport.height - handle.height - VIEWPORT_INSET)
  )
  return { x, y }
}
