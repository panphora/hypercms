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

export function resolveRichClay(win) {
  return (
    (win && win.richclay && win.richclay.RichClay) ||
    platform('RichClay', win) ||
    (win && typeof win.RichClay === 'function' ? win.RichClay : null)
  )
}

export function markBound(el, heldMarkup) {
  if (el && typeof el.setAttribute === 'function') {
    el.setAttribute(BOUND_ATTR, heldMarkup ? 'rich' : 'plain')
  }
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
    // Only the CMS's own marker. Whether data-richclay comes off is richclay's
    // call, not ours: removeRuntimeState drops it exactly when
    // data-richclay-runtime-marker says richclay invented it, and leaves an
    // author's own opt-in byte for byte. Removing it here as well took that
    // attribute out of the file for any element hypercms bound.
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
  el.removeAttribute(BOUND_ATTR)
}
