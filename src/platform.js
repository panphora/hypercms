// The optional platform hypercms rides: the mutation hub, undo, the save-prepare
// hook, rich text, and the two upload helpers. Every one degrades to null, so the
// CMS still runs in a bare HTML file with no client at all.
//
// TWO clients provide this and they disagree on names. hyperclayjs owns
// window.hyperclay; clayjs owns window.clay and renamed things on the way past
// (onPrepareForSave -> addDocumentTransform, consent -> confirm, uploadFileBasic ->
// upload). So this is a capability table rather than a namespace pointer:
// `window.clay ?? window.hyperclay` would resolve to clay, find no
// onPrepareForSave, and silently stop stripping the CMS's own chrome out of every
// save.
//
// Reads happen per call, never cached. A client can install a capability after
// hypercms evaluates — that is the whole reason whenReady() below exists.
const CAPABILITIES = {
  Mutation:         (clay, hyperclay) => clay?.Mutation ?? hyperclay?.Mutation,
  undo:             (clay, hyperclay) => clay?.undo ?? hyperclay?.undo,
  onPrepareForSave: (clay, hyperclay) => clay?.addDocumentTransform ?? hyperclay?.onPrepareForSave,
  // Distinct from onPrepareForSave above, and the difference is the whole point:
  // onPrepareForSave is save-only, so a hook there runs AFTER live sync has
  // already broadcast the document. onSnapshot runs on every snapshot, save and
  // sync alike, which is the only place a cleanup can sit and be seen by both.
  onSnapshot:       (clay, hyperclay) => clay?.onSnapshot ?? hyperclay?.onSnapshot,
  consent:          (clay, hyperclay) => clay?.confirm ?? hyperclay?.consent,
  RichClay:         (clay, hyperclay) => clay?.RichClay ?? hyperclay?.RichClay,
  quickcrop:        (clay, hyperclay) => clay?.quickcrop ?? hyperclay?.quickcrop,
  upload:           (clay, hyperclay) =>
    clay?.upload ?? (hyperclay?.uploadFileBasic ? adaptLegacyUpload(hyperclay.uploadFileBasic) : null),
}

// The one capability where the two clients differ in SHAPE and not just in name,
// so it is normalized here rather than at the call site. clay.upload answers one
// envelope for every outcome and never rejects; uploadFileBasic resolves on
// success and rejects on failure. A pick handler that had to know which client it
// was riding would grow two of every branch, and the branch that matters most is
// the one a rejection reads wrong: "this host does not store files" is not a
// failure, and a caller that catches it as one stops when it should have embedded.
//
// The legacy client has no cancellation, so `signal` is honored on the near side
// only: an upload already in flight runs to completion, and its result is
// discarded rather than written. That is the same outcome the caller's own
// ctx.closed check produces, one branch earlier.
const LEGACY_STATUS_CODES = {
  402: 'payment-required',
  413: 'too-large',
  415: 'unsupported-type',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
}

const aborted = () => ({ ok: false, msg: 'Upload cancelled', msgType: 'skipped', code: 'aborted', uploads: [] })

function adaptLegacyUpload(uploadFileBasic) {
  return async function upload(file, { onProgress, signal } = {}) {
    if (signal?.aborted) return aborted()
    try {
      // uploadFileBasic reports a bare percent; clay reports {loaded,total,percent}.
      // Callers draw from `percent`, which is the only field both can supply.
      const res = await uploadFileBasic(file, {
        onProgress: (percent) => { onProgress?.({ loaded: null, total: null, percent }) },
      })
      if (signal?.aborted) return aborted()
      const uploads = (res && res.uploads) || []
      if (typeof uploads[0]?.url !== 'string') {
        return { ok: false, msg: 'The host accepted the file but did not say where it put it', msgType: 'error', code: 'bad-response', uploads: [] }
      }
      return { ok: true, msg: res.msg || 'Uploaded', msgType: res.msgType || 'success', code: res.code || null, uploads }
    } catch (err) {
      if (signal?.aborted) return aborted()
      // The rejection carries the HTTP status and the raw body, so the host's own
      // code survives the round trip and the caller branches on the reason rather
      // than pattern-matching a message.
      let body = {}
      try { body = JSON.parse(err?.response || '{}') } catch { body = {} }
      const code = body.code || LEGACY_STATUS_CODES[err?.status] || 'error'
      return { ok: false, msg: (err && err.message) || 'Upload failed', msgType: 'error', code, uploads: [] }
    }
  }
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

// The readiness pair both clients publish once their public surface is
// assembled. clayjs fires clay:ready from its loader; hyperclayjs fires
// hyperclay:ready from exportToWindow. This is the handshake richclay uses for
// the same race, and it is the only reliable retry signal for a hook whose
// capability arrives later than hypercms does.
export const PLATFORM_READY = ['clay:ready', 'hyperclay:ready']

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
