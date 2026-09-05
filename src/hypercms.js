import { engine } from 'hyper-html-api'
import * as pathUtil from './path.js'
import { scaffold } from './scaffold.js'
import { morphForm } from './morph.js'
import {
  commit,
  commitWithUndo,
  onAdd as evOnAdd,
  onRemove as evOnRemove,
  extractFormData,
  restampAllSiblings,
} from './events.js'
import { setShellStyles, markStylesBundled } from './shell.js'
import { createSidebarView } from './views/sidebar.js'
import { createInlineView } from './views/inline.js'
import {
  state,
  createSession,
  startSession,
  teardownSession,
  nextSearchAfterClose,
  shouldAutoOpenFromSearch,
} from './session.js'
import { maybeInjectToggle } from './toggle.js'
import { platform, onPlatformEvent, MUTATION_READY } from './platform.js'
import { cleanRichClayFromSnapshot } from './richclay-bridge.js'

export { nextSearchAfterClose, shouldAutoOpenFromSearch }

export function installStyles(text) {
  setShellStyles(text)
}

export function markBundledStyles(doc) {
  markStylesBundled(doc)
}

// Strip hypercms's own body chrome from the SAVE clone so it never reaches disk
// (the shell element itself is [save-remove], but the hcms-open class lives on
// <body>, outside the stripped subtree). Registered once at first open():
// onPrepareForSave runs save-only, on a clone, so it never touches the live DOM,
// and removing absent classes is a no-op when the shell is closed. Guarded so it
// degrades cleanly when the host save pipeline (hyperclayjs) isn't present.
let prepareHookInstalled = false
function installSavePrepareHook() {
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
function installSnapshotHook() {
  if (snapshotHookInstalled) return
  const onSnapshot = platform('onSnapshot')
  if (typeof onSnapshot !== 'function') return
  onSnapshot((clonedDocEl) => {
    cleanRichClayFromSnapshot(clonedDocEl, typeof window !== 'undefined' ? window : null)
  })
  snapshotHookInstalled = true
}

// The views a session can be rendered through. A name that is not in here is a
// caller error, never a fallback: silently opening a sidebar when someone asked
// for the inline editor would read as the inline editor being broken.
const VIEWS = {
  sidebar: createSidebarView,
  inline: createInlineView,
}

export function open(opts = {}) {
  // Everything that can be rejected is rejected before anything is destroyed. A
  // bad view name or a missing page must not leave a caller with the session
  // they had already torn down.
  const viewName = opts.view || 'sidebar'
  const makeView = VIEWS[viewName]
  if (!makeView) {
    throw new Error(`hypercms: unknown view "${viewName}" (expected ${Object.keys(VIEWS).join(' or ')})`)
  }
  // A switch changes the presentation of one session, not the session. Someone
  // calling open({ view: 'sidebar' }) means "show me this in the sidebar"; they
  // are not restating the pageRoot, the rules and the callbacks they opened
  // with. Resolving those from this call alone silently retargets the CMS at
  // document.body with the default rules tag and stops calling onChange.
  // state.opts holds the active session's options and teardown clears it, so it
  // has to be read here, before anything is torn down.
  const effective = state.isOpen ? { ...state.opts, ...opts, view: viewName } : opts

  const pageRoot = effective.pageRoot || (typeof document !== 'undefined' ? document.body : null)
  if (!pageRoot) throw new Error('hypercms: no pageRoot available')
  const doc = pageRoot.ownerDocument || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('hypercms: no document available')

  // Reopening the view that is already up is a silent no-op, not a warning: a
  // host wiring a button to open({ view }) should be able to call it without
  // first asking what is open. Switching views tears the old one down WITHOUT
  // the close-only side effects — no hcms:close URL rewrite, no focus restore —
  // because a switch is one continuous session from the person's side, not a
  // close followed by an open.
  let carriedFocus = null
  if (state.isOpen) {
    if (state.ctx.view.name === viewName) return
    carriedFocus = state.ctx.previouslyFocused
    teardownSession(state.ctx, { restoreFocus: false, updateUrl: false })
  }

  installSavePrepareHook()
  installSnapshotHook()

  const view = makeView({ doc, pageRoot, opts: effective })
  const ctx = createSession({ view, doc, pageRoot, opts: effective, onCloseRequested: () => close() })
  // Where focus was before the FIRST open, carried across the switch. Closing
  // the second view should return the person where they started, not to
  // whatever held focus after the first view was pulled out from under them.
  if (carriedFocus) ctx.previouslyFocused = carriedFocus

  // Everything past here touches the live DOM, the module-level state, and
  // external subscriptions (observer, undo, livesync). A throw in here — most
  // notably installObserver when window.hyperclay.Mutation isn't loaded — would
  // otherwise strand the mounted view in the DOM with no way to close it (close()
  // early-returns while state.isOpen is false). Tear down whatever was wired,
  // without the close-only side effects (no hcms:close, no URL rewrite, no focus
  // restore), then rethrow so host misuse still fails loudly.
  try {
    view.mount(ctx.initialData)
    startSession(ctx)
    view.focusOnOpen()

    state.isOpen = true
    state.ctx = ctx
    state.opts = effective

    ctx.dispatch('hcms:open', { pageRoot })
  } catch (err) {
    // A failed switch already destroyed the view that was up, so nothing is
    // mounted and nothing can be reopened; the least bad outcome is handing
    // focus back where it started. On a first open focus never moved, so
    // restoring it there would be a no-op either way.
    teardownSession(ctx, { dispatch: false, restoreFocus: !!carriedFocus, updateUrl: false })
    throw err
  }
}

export function close() {
  if (!state.isOpen) return
  teardownSession(state.ctx)
}

export function refresh() {
  if (!state.isOpen) return
  state.ctx.view.refresh('api')
}

export function isOpen() {
  return state.isOpen
}

// Which view owns the active session. Nothing may infer this from
// body.hcms-open, which describes only the sidebar's page shift and says nothing
// about an inline session.
export function currentView() {
  return state.isOpen && state.ctx ? state.ctx.view.name : null
}

export const api = {
  getData() {
    if (!state.isOpen) return null
    return extractFormData(state.ctx)
  },
  setValue(path, value) {
    if (!state.isOpen) throw new Error('hypercms: cms is not open')
    const ctx = state.ctx
    const pathArr = pathUtil.fromString(path)
    const rule = pathUtil.getRuleAtPath(ctx.pageRules, pathArr)
    if (rule === undefined) throw new Error(`hypercms: no rule at path "${path}"`)
    if (typeof rule !== 'string' || rule.endsWith('[]')) {
      throw new Error(`hypercms: setValue requires a leaf scalar path; "${path}" is not a leaf`)
    }
    const field = findLeafField(ctx.formRoot, path)
    if (!field) throw new Error(`hypercms: no field element at path "${path}"`)
    writeFieldValue(field, value, ctx.formRoot, path)
    commit(extractFormData(ctx), { path, structural: false }, ctx)
  },
  addItem(arrayPath) {
    if (!state.isOpen) throw new Error('hypercms: cms is not open')
    evOnAdd(arrayPath, state.ctx)
  },
  removeItem(itemPath) {
    if (!state.isOpen) throw new Error('hypercms: cms is not open')
    const ctx = state.ctx
    const pathArr = pathUtil.fromString(itemPath)
    // Validate path: must be an array item — last segment is a non-negative
    // integer, parent rule must be an array (object-array or scalar-array).
    const lastSeg = pathArr[pathArr.length - 1]
    if (typeof lastSeg !== 'number') {
      throw new Error(`hypercms: removeItem requires an item path; "${itemPath}" is not an array index`)
    }
    const parentRule = pathUtil.getRuleAtPath(ctx.pageRules, pathArr.slice(0, -1))
    const parentIsArray = Array.isArray(parentRule) || (typeof parentRule === 'string' && parentRule.endsWith('[]'))
    if (!parentIsArray) {
      throw new Error(`hypercms: removeItem requires an item path; parent of "${itemPath}" is not an array`)
    }
    const itemEl = ctx.formRoot.querySelector(`[data-hcms-path="${cssEscape(itemPath)}"]`)
    if (!itemEl) throw new Error(`hypercms: no element at path "${itemPath}"`)
    evOnRemove(itemEl, ctx)
  },
  refresh,
  _commit() {
    if (!state.isOpen) return
    const ctx = state.ctx
    restampAllSiblings(ctx.formRoot)
    return commitWithUndo('Update', () =>
      commit(extractFormData(ctx), { path: '', structural: true }, ctx)
    )
  },
}

function findLeafField(formRoot, path) {
  const esc = cssEscape(path)
  // Prefer a tag-qualified leaf (input/textarea/select/img/a) — since v0.3
  // stamps data-hcms-field on the wrapping container too, a bare attribute
  // match would resolve to the container and lose the value write.
  const leafSel =
    `[data-hcms-path="${esc}"] input[data-hcms-field], ` +
    `[data-hcms-path="${esc}"] textarea[data-hcms-field], ` +
    `[data-hcms-path="${esc}"] select[data-hcms-field], ` +
    `[data-hcms-path="${esc}"] img[data-hcms-field], ` +
    `[data-hcms-path="${esc}"] a[data-hcms-field], ` +
    `[data-hcms-path="${esc}"] [contenteditable][data-hcms-field], ` +
    // Leaf is the path-stamped element itself (inline-stamped fields):
    `input[data-hcms-path="${esc}"][data-hcms-field], ` +
    `textarea[data-hcms-path="${esc}"][data-hcms-field], ` +
    `select[data-hcms-path="${esc}"][data-hcms-field], ` +
    `img[data-hcms-path="${esc}"][data-hcms-field], ` +
    `a[data-hcms-path="${esc}"][data-hcms-field], ` +
    `[contenteditable][data-hcms-path="${esc}"][data-hcms-field]`
  return formRoot.querySelector(leafSel)
}

function writeFieldValue(el, value, formRoot, path) {
  const tag = (el.tagName || '').toUpperCase()
  const type = (el.getAttribute('type') || '').toLowerCase()
  if (tag === 'INPUT' && type === 'checkbox') {
    el.checked = value === true || value === 'true'
    return
  }
  if (tag === 'INPUT' && type === 'radio') {
    // Radios sharing the same path act as a group. Toggle the matching option.
    const esc = cssEscape(path)
    const group = formRoot.querySelectorAll(
      `[data-hcms-path="${esc}"][data-hcms-field][type="radio"], [data-hcms-path="${esc}"] [data-hcms-field][type="radio"]`
    )
    if (group.length) {
      group.forEach((r) => { r.checked = String(r.value) === String(value ?? '') })
    } else {
      el.checked = String(el.value) === String(value ?? '')
    }
    return
  }
  if (tag === 'IMG') {
    el.src = value == null ? '' : String(value)
    return
  }
  if (tag === 'A') {
    el.href = value == null ? '' : String(value)
    return
  }
  if (el.hasAttribute && el.hasAttribute('contenteditable')) {
    el.innerHTML = value == null ? '' : String(value)
    return
  }
  if ('value' in el) {
    el.value = value == null ? '' : String(value)
    return
  }
  el.textContent = value == null ? '' : String(value)
}

// ?cms=true auto-open. When the page URL carries cms=true at load, open the CMS
// for everyone (no gating — this is a feature showcase; a non-admin's edits stay
// DOM-local and the host save path shows its view-mode notice). open() is
// idempotent-safe (it returns quietly if the same view is already open), so a
// host that also calls open() never double-mounts. No special opts — host
// defaults apply.
//
// Patience matters here: this runs at module load from the dist IIFE, which a
// host typically loads BEFORE installing window.hyperclay.Mutation (the Mutation
// install often sits behind an `await import(...)` that resumes after this script,
// even after DOMContentLoaded). open() needs <body> AND Mutation, so we poll for
// both rather than firing eagerly. Firing without Mutation would throw out of
// installObserver, escape module evaluation, and abort esbuild's
// window.hypercms assignment — taking the host's own wiring down with it.
const SAFETY_POLL_MS = 250
const AUTO_OPEN_DEADLINE_MS = 10000
export function maybeAutoOpen() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!shouldAutoOpenFromSearch(window.location ? window.location.search : '')) return
  if (state.isOpen) return
  whenReady(() => {
    if (state.isOpen) return
    try {
      open()
    } catch (err) {
      console.warn('hypercms: auto-open failed', err)
    }
  })
}

// Auto-open is ready only once <body> is parsed AND window.hyperclay.Mutation is
// installed (open() needs both). NEVER throw out of module scope.
function autoOpenReady() {
  return !!document.body && !!platform('Mutation')
}

// Three layers, in order of preference:
//   1. Sync fast-path: if <body> and Mutation are already here, fire now.
//   2. Event: both clients dispatch a mutation-ready signal the instant they
//      install the mutation hub, under two spellings ('clay:mutation-ready' and
//      'hyperclay:mutation-ready'), so hypercms listens for both and dedups. On
//      loader pages this is moot — the loader's first wave evaluates mutation
//      before hypercms, so the fast-path wins — but the event catches any late
//      install (the deferred `await import()` ordering). The body gate is
//      re-checked in the handler because the event can land before <body> is
//      parsed.
//   3. Backstop: a slow self-cancelling 250ms poll for exotic hosts that hand-roll
//      window.hyperclay.Mutation by direct assignment WITHOUT dispatching the
//      event. It cancels the moment the event fires, open succeeds, or the
//      deadline is hit (warn, never throw).
function whenReady(fn) {
  if (autoOpenReady()) {
    // Defer one microtask. On the bundled entry (hypercms-bundle.js), installStyles()
    // runs AFTER this module evaluates, so firing open() synchronously here would
    // mount the shell with cssText still empty (an unstyled sidebar). A microtask
    // runs only after the synchronous bundle evaluation completes, by which point
    // styles are installed. The event/backstop paths below already fire post-eval,
    // so only this fast path needed deferring.
    queueMicrotask(fn)
    return
  }
  const deadline = Date.now() + AUTO_OPEN_DEADLINE_MS
  let done = false
  let timer = null
  let offMutationReady = null
  const finish = () => {
    if (done) return
    done = true
    if (timer !== null) clearInterval(timer)
    if (offMutationReady) offMutationReady()
  }
  function onMutationReady() {
    if (state.isOpen) {
      finish()
      return
    }
    if (autoOpenReady()) {
      finish()
      fn()
    }
    // Body may still be pending. Unlike the old one-shot listener this stays
    // subscribed, so a later dispatch is still caught and the backstop is no
    // longer the only remaining path.
  }
  offMutationReady = onPlatformEvent(document, MUTATION_READY, onMutationReady)
  timer = setInterval(() => {
    if (state.isOpen) {
      finish()
      return
    }
    if (autoOpenReady()) {
      finish()
      fn()
      return
    }
    if (Date.now() >= deadline) {
      finish()
      console.warn(
        'hypercms: ?cms=true auto-open gave up — no mutation hub appeared. ' +
        'Load clayjs or hyperclayjs (or just the mutation utility) so the CMS can initialize.'
      )
    }
  }, SAFETY_POLL_MS)
}

// Auto-open at module load (browser only — node tests import this without a real
// window, and the guards above no-op there).
maybeAutoOpen()

// Floating edit-mode toggle at module load (same browser-only no-op in node).
maybeInjectToggle({
  open,
  close,
  isOpen,
  hasRules: (doc) => !!engine.findRules(doc, 'cms'),
})

const cms = {
  open,
  close,
  refresh,
  api,
  get isOpen() { return state.isOpen },
  currentView,
  // Power-user exports (mostly for testing + advanced integration)
  path: pathUtil,
  scaffold,
  morphForm,
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
}

export { cms }
export default { cms }
