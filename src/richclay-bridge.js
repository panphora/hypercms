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
export const BOUND_ATTR = 'data-hcms-bound'

export function resolveRichClay(win) {
  return (
    (win && win.richclay && win.richclay.RichClay) ||
    platform('RichClay', win) ||
    (win && typeof win.RichClay === 'function' ? win.RichClay : null)
  )
}

export function markBound(el) {
  if (el && typeof el.setAttribute === 'function') el.setAttribute(BOUND_ATTR, '')
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
    // Only ever ours. An element the author wrote data-richclay on carries no
    // marker, so its attribute survives byte for byte.
    el.removeAttribute('data-richclay')
    el.removeAttribute(BOUND_ATTR)
  }
}
