// Shell isolation helper. The CMS shell is mounted somewhere under pageRoot
// (often document.body, sometimes inside an authored wrapper). Several
// operations need to read or apply against pageRoot WITHOUT seeing the shell:
//
//   - engine.extract on pageRoot would otherwise pick up shell input li/card
//     items as user data (broad rules like `li[]`)
//   - engine.apply on pageRoot would otherwise mutate the shell's own DOM,
//     destroying form state mid-write
//
// withoutShell(pageRoot, shellRoot, fn) detaches ONLY the shell element
// itself, runs fn(pageRoot), then reattaches the shell in its original spot.
// We don't walk up to a top-level ancestor of pageRoot — doing so would
// detach a wrapper that may also hold page content (e.g. shell mounted in
// <aside> inside <div id="page"> alongside articles).
export function withoutShell(pageRoot, shellRoot, fn) {
  if (!shellRoot || !shellRoot.parentNode || !pageRoot?.contains?.(shellRoot)) {
    return fn(pageRoot)
  }
  // Detaching the shell from the DOM blurs whatever's focused inside it
  // (input fields, buttons). Save the active element + selection state and
  // restore after reattach so keystroke commits preserve cursor position.
  const doc = shellRoot.ownerDocument
  const prevActive = doc?.activeElement
  let selStart = null, selEnd = null, selDir = null
  if (prevActive && shellRoot.contains(prevActive) && 'selectionStart' in prevActive) {
    try {
      selStart = prevActive.selectionStart
      selEnd = prevActive.selectionEnd
      selDir = prevActive.selectionDirection
    } catch {}
  }
  const parent = shellRoot.parentNode
  const nextSibling = shellRoot.nextSibling
  parent.removeChild(shellRoot)
  try {
    return fn(pageRoot)
  } finally {
    parent.insertBefore(shellRoot, nextSibling)
    if (prevActive && shellRoot.contains(prevActive) && typeof prevActive.focus === 'function') {
      try {
        prevActive.focus()
        if (selStart != null && typeof prevActive.setSelectionRange === 'function') {
          prevActive.setSelectionRange(selStart, selEnd, selDir || 'none')
        }
      } catch {}
    }
  }
}
