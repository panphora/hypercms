// Can the inline view hang a control on this page element right now?
//
// Deliberately a question about the CURRENT state, never a cached verdict. A
// target inside a closed <details> or an inactive tab answers false now and
// true the moment the page reveals it, which is why the inline view re-runs
// this on every visibility change instead of classifying once at open.
//
// The area floor is not cosmetic padding and it is not redundant with
// IntersectionObserver. Measured in Chrome: an empty inline <span> reports
// isIntersecting true, ratio 1, on a zero-width box. Without the floor that
// draws a camera handle on a 0px target.
export const MIN_ANCHOR_PX = 8

// [cms-template] is the hidden list seed; [data-hcms-shell] is the CMS's own
// chrome, which both the sidebar panel and the inline host carry. Neither is
// page content, so neither ever gets a control.
const NEVER_ANCHOR = '[cms-template], [data-hcms-shell]'

export function isAnchorable(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false
  if (typeof el.closest === 'function' && el.closest(NEVER_ANCHOR)) return false
  const r = el.getBoundingClientRect()
  return r.width >= MIN_ANCHOR_PX && r.height >= MIN_ANCHOR_PX
}
