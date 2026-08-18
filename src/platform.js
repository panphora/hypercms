// The optional platform hypercms rides: the mutation hub, undo, the save-prepare
// hook, rich text, and the two upload helpers. Every one degrades to null, so the
// CMS still runs in a bare HTML file with no client at all.
//
// TWO clients provide this and they disagree on names. hyperclayjs owns
// window.hyperclay; clayjs owns window.clay and renamed things on the way past
// (onPrepareForSave -> addDocumentTransform, consent -> confirm). clay.RichClay and
// clay.quickcrop exist; uploadFileBasic has no clay equivalent, so a clayjs page
// keeps the cropped image as an inline data: URL instead of uploading it. So this
// is a capability table rather than a namespace pointer: `window.clay ??
// window.hyperclay` would resolve to clay, find no onPrepareForSave, and silently
// stop stripping the CMS's own chrome out of every save.
//
// Reads happen per call, never cached. A client can install a capability after
// hypercms evaluates — that is the whole reason whenReady() below exists.
const CAPABILITIES = {
  Mutation:         (clay, hyperclay) => clay?.Mutation ?? hyperclay?.Mutation,
  undo:             (clay, hyperclay) => clay?.undo ?? hyperclay?.undo,
  onPrepareForSave: (clay, hyperclay) => clay?.addDocumentTransform ?? hyperclay?.onPrepareForSave,
  consent:          (clay, hyperclay) => clay?.confirm ?? hyperclay?.consent,
  RichClay:         (clay, hyperclay) => clay?.RichClay ?? hyperclay?.RichClay,
  quickcrop:        (clay, hyperclay) => clay?.quickcrop ?? hyperclay?.quickcrop,
  uploadFileBasic:  (clay, hyperclay) => clay?.uploadFileBasic ?? hyperclay?.uploadFileBasic,
}

// Pass `win` when the caller already holds a realm (a doc.defaultView from a form
// mounted into another document); it defaults to the ambient one.
export function platform(name, win) {
  const read = CAPABILITIES[name]
  if (!read) throw new Error(`hypercms: unknown platform capability "${name}"`)
  const scope = win || (typeof window !== 'undefined' ? window : null)
  if (!scope) return null
  return read(scope.clay, scope.hyperclay) || null
}

// Both spellings of the same signal. Each client fires exactly one name: clayjs
// its own, hyperclayjs the legacy one. Listening for both is what lets one build
// of hypercms ride either client. The name-keyed guard below stays regardless, so
// a listener on both names still can't double-fire if a client ever dispatches
// the pair again.
export const MUTATION_READY = ['clay:mutation-ready', 'hyperclay:mutation-ready']
export const LIVESYNC_APPLIED = ['clay:sync-applied', 'hyperclay:livesync-applied']

// Subscribe to every spelling of one signal, delivering the handler ONCE per
// occurrence. No client dispatches the pair today, but one that did would make a
// plain listener on each name fire the handler twice for one event: two form
// re-extracts, or two open() calls.
//
// The first name to arrive claims the tick, and only a DIFFERENT name is suppressed
// while it holds the claim. That distinction is what makes this exact rather than a
// heuristic: no client dispatches one name twice for one occurrence, so a repeat of
// the claiming name is always a second occurrence and always gets through — even
// when it lands in the same tick, which is precisely what a caller doing two
// synchronous applies looks like. Guarding on "have I run at all this tick" would
// swallow that.
//
// Returns an unsubscribe that removes every name.
export function onPlatformEvent(target, names, handler) {
  let claimedBy = null
  const wrapped = (event) => {
    if (claimedBy !== null && claimedBy !== event.type) return
    claimedBy = event.type
    queueMicrotask(() => { claimedBy = null })
    handler(event)
  }
  for (const name of names) target.addEventListener(name, wrapped)
  return () => { for (const name of names) target.removeEventListener(name, wrapped) }
}
