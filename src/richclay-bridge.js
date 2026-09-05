// hypercms's bridge to richclay: how it finds the class, and how it cleans up
// after the instances it creates.
//
// The cleanup exists because hypercms constructs `new RichClay(el, { hyperclay:
// false })`, and richclay installs its own save bridge only when that option is
// true (`richclay/src/richclay.js:135`). So on a page whose only richclay usage
// is hypercms's, NOTHING strips the editor's runtime state out of the document:
// a contenteditable heading reaches the file and stays editable forever.
// hypercms created those instances, so hypercms cleans them up.

import { platform } from './platform.js'

// Written on the live page element at bind time, removed from the snapshot
// clone. It is the only way to tell an element hypercms made rich from one the
// author marked up themselves: element identity does not survive cloneNode, so
// an in-memory Set cannot answer the question on the clone the hook receives.
//
// Its VALUE is whether the element held markup before richclay touched it:
// 'rich' or 'plain'. That has to be frozen here, because Squire wraps the
// content of a block it binds in a <div>, so from the first click the live DOM
// can no longer answer whether the author wrote markup in this element.
export const BOUND_ATTR = 'data-hcms-bound'

// Written beside the marker when hypercms's own construct call is what put
// data-richclay on the element. richclay 0.5.0 tracks the same provenance in
// data-richclay-runtime-marker and strips the attribute for us, but clayjs and
// hyperclayjs both vendor 0.4.0, which has no marker and leaves it in the file.
// data-richclay is richclay's mount selector, so left there it turns every
// heading anyone clicked into a permanent richclay region. hypercms knew the
// answer before it touched the element; it does not need to ask.
export const RC_OWNED_ATTR = 'data-hcms-owns-richclay'

export function resolveRichClay(win) {
  return (
    (win && win.richclay && win.richclay.RichClay) ||
    platform('RichClay', win) ||
    (win && typeof win.RichClay === 'function' ? win.RichClay : null)
  )
}

export function markBound(el, heldMarkup, richClayIsOurs) {
  if (!el || typeof el.setAttribute !== 'function') return
  el.setAttribute(BOUND_ATTR, heldMarkup ? 'rich' : 'plain')
  if (richClayIsOurs) el.setAttribute(RC_OWNED_ATTR, 'true')
}

// ⚠ THE ORDER IS LOAD-BEARING. richclay's strip iterates
// "[data-richclay], [richclay], [editable], [clay-editable]". Remove
// data-richclay first and a bare <h1> stops matching that selector, the strip
// skips it, and every runtime attribute richclay wrote reaches the file. Strip
// FIRST, unmark second. Both orders were run and the bytes compared; the other
// one ships a permanently contenteditable heading.
export function cleanRichClayFromSnapshot(cloneDocEl, win) {
  if (!cloneDocEl || typeof cloneDocEl.querySelectorAll !== 'function') return
  const bound = cloneDocEl.querySelectorAll(`[${BOUND_ATTR}]`)
  if (!bound.length) return

  const RichClay = resolveRichClay(win)
  if (RichClay && typeof RichClay.stripFromClone === 'function') {
    try {
      // A second pass over an already-stripped clone is string-identical, so
      // this stays correct on a page that also uses richclay directly and has
      // richclay's own bridge installed.
      RichClay.stripFromClone(cloneDocEl)
    } catch (err) {
      console.warn('[hypercms] richclay strip failed; editor state may reach the save', err)
    }
  }
  for (const el of bound) {
    // Whether data-richclay comes off is decided by who put it there, not by
    // which richclay is loaded. On 0.5.0 stripFromClone has already removed it
    // and this is a no-op; on the 0.4.0 copies clayjs and hyperclayjs vendor,
    // this is the only thing that removes it. An author's own opt-in never
    // carries the marker, so it is never touched.
    if (el.getAttribute(RC_OWNED_ATTR) === 'true') el.removeAttribute('data-richclay')
    el.removeAttribute(RC_OWNED_ATTR)
    el.removeAttribute(BOUND_ATTR)
  }
}

// A page element that carries the CMS marker but has no binding behind it: a
// clone the engine made of a bound row, or of a bound element it replaced while
// rolling back a failed apply. destroy() cannot reach it — destroy belongs to an
// instance and a clone has none — so it is left permanently editable with page
// undo switched off for it. The snapshot hook still cleans the saved file; this
// is the live page.
export function stripOrphanEditorState(el, win) {
  if (!el || typeof el.removeAttribute !== 'function') return
  const RichClay = resolveRichClay(win)
  if (RichClay && typeof RichClay.stripElement === 'function') {
    try {
      RichClay.stripElement(el)
    } catch (err) {
      console.warn('[hypercms] richclay element strip failed; the clone stays editable', err)
    }
  } else {
    // An older richclay with no per-element strip. These two are what actually
    // harm the live page; the rest is cosmetic and the snapshot hook removes it
    // from the file either way.
    el.removeAttribute('contenteditable')
    el.removeAttribute('no-undo')
  }
  if (el.getAttribute(RC_OWNED_ATTR) === 'true') el.removeAttribute('data-richclay')
  el.removeAttribute(RC_OWNED_ATTR)
  el.removeAttribute(BOUND_ATTR)
}
