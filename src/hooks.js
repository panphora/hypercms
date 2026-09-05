// The two clone hooks hypercms installs on the host client, and the retry that
// covers a client arriving after hypercms does.
//
// Their own module rather than private state inside hypercms.js, because the
// inline view has to install the snapshot hook too: by the time someone clicks
// a heading the client is certainly loaded, which makes the bind the reliable
// second trigger for a page that lost the readiness race. Importing that back
// out of the entry module would have made the entry module part of a cycle.

import { platform, onPlatformEvent, PLATFORM_READY } from './platform.js'
import { cleanRichClayFromSnapshot } from './richclay-bridge.js'

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
    const b = clonedDocEl && clonedDocEl.querySelector && clonedDocEl.querySelector('body')
    if (b) b.classList.remove('hcms-open', 'hcms-overlay', 'hcms-side-left')
  })
  prepareHookInstalled = true
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
    cleanRichClayFromSnapshot(clonedDocEl, typeof window !== 'undefined' ? window : null)
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
