// The two clone hooks hypercms installs on the host client, and the retry that
// covers a client arriving after hypercms does.
//
// Their own module rather than private state inside hypercms.js, because the
// inline view has to install the snapshot hook too: by the time someone clicks
// a heading the client is certainly loaded, which makes the bind the reliable
// second trigger for a page that lost the readiness race. Importing that back
// out of the entry module would have made the entry module part of a cycle.

import { platform, onPlatformEvent, PLATFORM_READY } from './platform.js'
import { BOUND_ID_ATTR, cleanRichClayFromSnapshot, pristineMarkupFor } from './richclay-bridge.js'
import { SESSION_OPEN_CLASS } from './shell.js'

// Strip hypercms's own body chrome from the SAVE clone so it never reaches disk
// (the shell element itself is [save-remove], but the hcms-open class lives on
// <body>, outside the stripped subtree). Registered once at first open():
// onPrepareForSave runs save-only, on a clone, so it never touches the live DOM,
// and removing absent classes is a no-op when the shell is closed. Guarded so it
// degrades cleanly when the host save pipeline (hyperclayjs) isn't present.
let prepareHookInstalled = false
export function installSavePrepareHook() {
  if (prepareHookInstalled) return
  const onPrepareForSave = platform('onPrepareForSave')
  if (typeof onPrepareForSave !== 'function') return
  onPrepareForSave((clonedDocEl) => {
    restorePristineMarkup(clonedDocEl)
    stripSessionChrome(clonedDocEl)
  })
  prepareHookInstalled = true
}

// hypercms's own chrome lives on <body>, outside the [save-remove] shell, so it
// has to be taken off the clone by hand. Both hooks call this: the save hook
// because a client may offer onPrepareForSave and no onSnapshot, and the
// snapshot hook because that is the only one live sync reaches, and without it
// the session's own classes are broadcast to every other browser. Removing an
// absent class is a no-op, so running twice on a save costs nothing.
function stripSessionChrome(clonedDocEl) {
  const b = clonedDocEl && clonedDocEl.querySelector && clonedDocEl.querySelector('body')
  if (b) b.classList.remove('hcms-open', 'hcms-overlay', 'hcms-side-left', SESSION_OPEN_CLASS)
}

// A save can land while somebody is mid-session with an editor open on a
// heading. richclay rewrites a block's markup simply by being attached to it, so
// without this the file records that rewriting as though the author had typed
// it. The live editors are deliberately untouched: this is the clone, and the
// person editing keeps their caret and their selection.
function restorePristineMarkup(clonedDocEl) {
  if (!clonedDocEl || typeof clonedDocEl.querySelectorAll !== 'function') return
  for (const el of clonedDocEl.querySelectorAll(`[${BOUND_ID_ATTR}]`)) {
    const html = pristineMarkupFor(el)
    if (html !== null) el.innerHTML = html
    el.removeAttribute(BOUND_ID_ATTR)
  }
}

// Clean up after the richclay instances hypercms itself creates on page
// elements. Installed once at first open, alongside the save-prepare hook above,
// and for the same reason: the host client may not be loaded yet at module
// evaluation. onSnapshot rather than onPrepareForSave, because this has to run
// for live sync too — a hook on the save-only path fires after the editor's
// leftovers have already been broadcast to every other browser.
let snapshotHookInstalled = false
export function installSnapshotHook() {
  if (snapshotHookInstalled) return
  const onSnapshot = platform('onSnapshot')
  if (typeof onSnapshot !== 'function') return
  onSnapshot((clonedDocEl) => {
    restorePristineMarkup(clonedDocEl)
    cleanRichClayFromSnapshot(clonedDocEl, typeof window !== 'undefined' ? window : null)
    stripSessionChrome(clonedDocEl)
  })
  snapshotHookInstalled = true
}

// What open() calls: install both, and arm the retry when either could not be
// installed yet.
export function installHooks() {
  installSavePrepareHook()
  installSnapshotHook()
  if (!prepareHookInstalled || !snapshotHookInstalled) armHookRetry()
}

// Both hooks read a capability that can arrive after hypercms does, and both
// return without recording success when it is missing. Retry on the clients'
// readiness pair and disarm once both are in, so a page that lost the import
// race still gets its clone cleanup.
let offPlatformReady = null
function armHookRetry() {
  if (offPlatformReady || typeof document === 'undefined') return
  const retry = () => {
    installSavePrepareHook()
    installSnapshotHook()
    if (prepareHookInstalled && snapshotHookInstalled) {
      offPlatformReady?.()
      offPlatformReady = null
    }
  }
  offPlatformReady = onPlatformEvent(document, PLATFORM_READY, retry)
}
