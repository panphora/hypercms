import { engine } from 'hyper-html-api'
import * as pathUtil from './path.js'
import { scaffold } from './scaffold.js'
import { morphForm } from './morph.js'
import { injectDefaults } from './templates.js'
import { deriveFormRules } from './form-rules.js'
import { buildForm } from './form-builder.js'
import {
  bindEvents,
  commit,
  commitWithUndo,
  suppressUndo,
  onAdd as evOnAdd,
  onRemove as evOnRemove,
  extractFormData,
  stableStringify,
  restampAllSiblings,
  coerceBooleans,
} from './events.js'
import { mountShell, setShellStyles, markStylesBundled } from './shell.js'
import { refreshForm, installObserver } from './refresh.js'
import { warnUnmatchedTemplates } from './diagnostics.js'

export function installStyles(text) {
  setShellStyles(text)
}

export function markBundledStyles(doc) {
  markStylesBundled(doc)
}

const state = {
  isOpen: false,
  ctx: null,
  shell: null,
  opts: null,
}

// Re-sync the form to the page after a change hypercms did NOT originate.
// `reason` selects whether the field the user is currently typing in snaps:
//   'undo' / 'redo' — the user's own deliberate action, so the focused field
//                     SHOULD snap to the reverted value (ignoreActiveValue:false).
//   'livesync'      — someone else's / the framework's change, so the user's
//                     in-progress focused field must NOT be yanked away
//                     (ignoreActiveValue:true). morphForm re-extracts every
//                     other field to the new page value, killing the stale-form
//                     clobber, while leaving the active field alone until blur.
// Both reasons route through this one handler so there is a single place to
// maintain the form-resync behavior.
function resyncForm(ctx, reason) {
  // open() may have moved on (closed, or reopened with a new ctx) between an
  // async morph completing and this firing.
  if (state.ctx !== ctx) return
  const ignoreActiveValue = reason === 'livesync'
  if (reason === 'livesync') {
    // A full-document morph can wipe the shell's <head> stylesheet and the
    // <body> chrome classes (both live outside the save-ignore shell subtree).
    // Re-assert them before re-extracting.
    state.shell?.restoreChrome?.()
  }
  refreshForm(ctx, { ignoreActiveValue })
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
  const onPrepareForSave =
    (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.onPrepareForSave) || null
  if (typeof onPrepareForSave !== 'function') return
  onPrepareForSave((clonedDocEl) => {
    const b = clonedDocEl && clonedDocEl.querySelector && clonedDocEl.querySelector('body')
    if (b) b.classList.remove('hcms-open', 'hcms-overlay', 'hcms-side-left')
  })
  prepareHookInstalled = true
}

export function open(opts = {}) {
  if (state.isOpen) {
    console.warn('cms.open() called while already open; ignoring')
    return
  }
  installSavePrepareHook()
  const pageRoot = opts.pageRoot || (typeof document !== 'undefined' ? document.body : null)
  if (!pageRoot) throw new Error('hypercms: no pageRoot available')
  const doc = pageRoot.ownerDocument || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('hypercms: no document available')

  // Resolve rules via the union: an explicit rules object, a token string, or
  // the default token "cms". findRules is document-scoped, so a head-mounted
  // rules tag is found even though pageRoot defaults to <body>.
  const source = opts.rules !== undefined ? opts.rules : 'cms'
  const found = engine.findRules(doc, source)
  if (!found) {
    const what = typeof source === 'string' ? `data-rules-name~="${source}"` : 'the provided rules object'
    throw new Error(`hypercms: no rules found for ${what}`)
  }
  const pageRules = found.rules
  const rulesTagNode = found.tagNode

  injectDefaults(doc)
  warnUnmatchedTemplates(doc, pageRules)
  const formRules = deriveFormRules(pageRules, doc)
  const data = coerceBooleans(engine.extract(pageRoot, pageRules, { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }), pageRules)

  // Suppress undo around mountShell: it toggles chrome-only classes on
  // document.body (hcms-open, etc.) which would otherwise land as undoable
  // page edits. The shell subtree itself is already filtered via save-ignore.
  const shell = suppressUndo(() => mountShell({
    mountTo: opts.mountTo || doc.body,
    side: opts.side || 'right',
    overlay: !!opts.overlay,
    showSaveButton: !!opts.showSaveButton,
    title: opts.title,
    eyebrow: opts.eyebrow,
    theme: opts.theme,
    doc,
  }))

  const ctx = {
    doc,
    pageRoot,
    pageRules,
    formRules,
    rulesTagNode,
    rulesSource: source,
    formRoot: shell.formRoot,
    shellRoot: shell.root,
    errorEl: shell.errorEl,
    lastFingerprint: null,
    lastData: null,
    observerHandle: null,
    undoUnsub: null,
    livesyncUnsub: null,
    onChange: opts.onChange,
    onError: opts.onError,
    previouslyFocused: doc.activeElement,
    dispatch(name, detail) {
      const Ctor = (doc.defaultView && doc.defaultView.CustomEvent) || (typeof CustomEvent !== 'undefined' ? CustomEvent : null)
      if (!Ctor) return
      const ev = new Ctor(name, { bubbles: true, cancelable: name === 'hcms:change', detail })
      shell.root.dispatchEvent(ev)
    },
    onCloseRequested() {
      close()
    },
  }
  ctx.updateFingerprint = () => {
    ctx.lastFingerprint = stableStringify(extractFormData(ctx))
  }

  // Everything past the shell mount touches the live DOM, the module-level state,
  // and external subscriptions (observer, undo, livesync). A throw in here — most
  // notably installObserver when window.hyperclay.Mutation isn't loaded — would
  // otherwise strand the mounted shell in the DOM with no way to close it (close()
  // early-returns while state.isOpen is false). Tear down whatever was wired,
  // exactly as close() does, then rethrow so host misuse still fails loudly.
  try {
  const fragment = buildForm({ pageRules, formRules, data, doc })
  shell.formRoot.appendChild(fragment)

  bindEvents(ctx)
  ctx.updateFingerprint()

  ctx.observerHandle = installObserver({
    onRefresh: () => refreshForm(ctx),
  })

  // Undo/redo is a deliberate local action (unlike livesync or in-flight typing),
  // so the focused form field SHOULD snap to the reverted value. The observer above
  // is source-blind, so subscribe to the undo scope and force a non-ignoring refresh.
  // Fires synchronously before the debounced observer refresh, which then no-ops on
  // the active field. Guarded so it degrades to today's behavior when undo isn't loaded.
  const u = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.undo) || null
  if (u && typeof u.on === 'function') {
    const onRevert = () => {
      if (state.ctx !== ctx) return
      resyncForm(ctx, 'undo')
      // A reverted change the consumer persists through onChange (e.g. the
      // collection dashboard PUTs the record, not the page) would otherwise lag
      // the undo: refreshForm re-syncs the form but never fires onChange, and a
      // commit() here would be fingerprint-skipped (refreshForm already updated
      // it). Extract the reverted state from the PAGE (the source of truth after
      // an undo/redo; the form can lag a morph) and fire onChange directly, but
      // only when it actually changed — guards spurious PUTs on undo/redo of
      // unrelated edits elsewhere on the page.
      const data = coerceBooleans(
        engine.extract(ctx.pageRoot, ctx.pageRules, { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }),
        ctx.pageRules
      )
      if (stableStringify(data) !== stableStringify(ctx.lastData)) {
        ctx.lastData = data
        ctx.onChange?.(data, { path: '', structural: false })
      }
    }
    u.on('undo', onRevert)
    u.on('redo', onRevert)
    ctx.undoUnsub = () => { u.off('undo', onRevert); u.off('redo', onRevert) }
  }

  // Live-sync / version-restore / any framework-applied full-document morph runs
  // inside window.hyperclay.Mutation.pause(), which the source-blind observer
  // above is deaf to — so without this the form stays stale after a remote edit
  // and the next local commit re-applies the stale data, clobbering the remote
  // change. Subscribe to the morph-applied signal live-sync emits and re-extract
  // with ignoreActiveValue:true (preserve the user's in-progress field). Same
  // document live-sync dispatches on; unsubscribed in close().
  const onLivesync = () => resyncForm(ctx, 'livesync')
  doc.addEventListener('hyperclay:livesync-applied', onLivesync)
  ctx.livesyncUnsub = () => doc.removeEventListener('hyperclay:livesync-applied', onLivesync)

  // Wire global sortable callback to current ctx (replaced by close()).
  globalCommitTarget.ctx = ctx
  installGlobalSortableCommit(doc)

  // Move focus into the shell — survives close+restore via previouslyFocused.
  focusFirstIn(shell.root)

  state.isOpen = true
  state.ctx = ctx
  state.shell = shell
  state.opts = opts

  ctx.dispatch('hcms:open', { pageRoot })
  } catch (err) {
    ctx.observerHandle?.unsubscribe?.()
    ctx.undoUnsub?.()
    ctx.livesyncUnsub?.()
    ctx.detachEvents?.()
    if (globalCommitTarget.ctx === ctx) globalCommitTarget.ctx = null
    suppressUndo(() => shell.destroy())
    state.isOpen = false
    state.ctx = null
    state.shell = null
    state.opts = null
    throw err
  }
}

function focusFirstIn(root) {
  const sel = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  const target = root.querySelector(sel)
  if (target && typeof target.focus === 'function') target.focus()
}

const globalCommitTarget = { ctx: null }

function installGlobalSortableCommit(doc) {
  const win = doc.defaultView || (typeof globalThis !== 'undefined' ? globalThis : null)
  if (!win) return
  const hypercmsCommitFn = function hypercmsCommitGlobal() {
    const ctx = globalCommitTarget.ctx
    if (!ctx) return
    restampAllSiblings(ctx.formRoot)
    // Route through commitWithUndo so a drag-reorder lands as a labeled
    // 'Reorder' commit (not a generic idle 'Edit') and a failed apply's
    // mutate+rollback is never recorded as a no-op commit. No-op pass-through
    // when undo isn't loaded.
    return commitWithUndo('Reorder', () =>
      commit(extractFormData(ctx), { path: '', structural: true }, ctx)
    )
  }
  if (typeof win.hypercmsCommit !== 'function') win.hypercmsCommit = hypercmsCommitFn
  // Also mirror to globalThis so non-window contexts (Node tests, workers)
  // can resolve the bare name from `new Function('hypercmsCommit()')`.
  if (typeof globalThis !== 'undefined' && typeof globalThis.hypercmsCommit !== 'function') {
    globalThis.hypercmsCommit = hypercmsCommitFn
  }
}

// The query param that drives ?cms=true auto-open. Closing the CMS rewrites it
// to cms=false (param kept) so a refresh/share of the post-close URL does not
// auto-reopen.
const AUTO_OPEN_PARAM = 'cms'

// Pure: given a location.search string, return the search string after a close.
// Only rewrites when cms=true is present; every other param + ordering is
// preserved, and a search without cms (or already cms=false) is returned
// unchanged so we never inject the param into a page that never carried it.
export function nextSearchAfterClose(search) {
  const str = typeof search === 'string' ? search : ''
  const qIndex = str.indexOf('?')
  const query = qIndex === -1 ? str : str.slice(qIndex + 1)
  if (!query) return str
  const params = new URLSearchParams(query)
  if (params.get(AUTO_OPEN_PARAM) !== 'true') return str
  params.set(AUTO_OPEN_PARAM, 'false')
  return '?' + params.toString()
}

// Pure: should the CMS auto-open for this location.search? Exactly 'true'.
export function shouldAutoOpenFromSearch(search) {
  const str = typeof search === 'string' ? search : ''
  const qIndex = str.indexOf('?')
  const query = qIndex === -1 ? str : str.slice(qIndex + 1)
  if (!query) return false
  return new URLSearchParams(query).get(AUTO_OPEN_PARAM) === 'true'
}

// Rewrite ?cms=true → ?cms=false via history.replaceState (no reload, hash and
// every other param preserved). No-op when the param isn't present or the
// History API is unavailable.
function toggleCloseParam() {
  if (typeof window === 'undefined' || !window.location || !window.history) return
  if (typeof window.history.replaceState !== 'function') return
  const current = window.location.search
  const next = nextSearchAfterClose(current)
  if (next === current) return
  window.history.replaceState(window.history.state, '', next + window.location.hash)
}

export function close() {
  if (!state.isOpen) return
  const { ctx, shell } = state
  const previouslyFocused = ctx.previouslyFocused
  ctx.dispatch('hcms:close', null)
  toggleCloseParam()
  ctx.observerHandle?.unsubscribe?.()
  ctx.undoUnsub?.()
  ctx.livesyncUnsub?.()
  ctx.detachEvents?.()
  // destroy() removes the chrome-only body classes; suppress so the inverse
  // class removal doesn't enter the undo stack either.
  suppressUndo(() => shell.destroy())
  state.isOpen = false
  state.ctx = null
  state.shell = null
  state.opts = null
  globalCommitTarget.ctx = null
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    try { previouslyFocused.focus() } catch (_) {}
  }
}

export function refresh() {
  if (!state.isOpen) return
  refreshForm(state.ctx)
}

export function isOpen() {
  return state.isOpen
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
  if ('value' in el) {
    el.value = value == null ? '' : String(value)
    return
  }
  el.textContent = value == null ? '' : String(value)
}

// ?cms=true auto-open. When the page URL carries cms=true at load, open the CMS
// for everyone (no gating — this is a feature showcase; a non-admin's edits stay
// DOM-local and the host save path shows its view-mode notice). open() is
// idempotent-safe (it warns + returns if already open), so a host that also calls
// open() never double-mounts. No special opts — host defaults apply.
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
  return !!document.body && !!(window.hyperclay && window.hyperclay.Mutation)
}

// Three layers, in order of preference:
//   1. Sync fast-path: if <body> and Mutation are already here, fire now.
//   2. Event: hyperclayjs's mutation.js dispatches 'hyperclay:mutation-ready' the
//      instant it installs window.hyperclay.Mutation. On loader pages this is
//      moot — the loader's first wave evaluates mutation before hypercms, so the
//      fast-path wins — but the event catches any late install (the deferred
//      `await import()` ordering). The body gate is re-checked in the handler
//      because the event can land before <body> is parsed.
//   3. Backstop: a slow self-cancelling 250ms poll for exotic hosts that hand-roll
//      window.hyperclay.Mutation by direct assignment WITHOUT dispatching the
//      event. It cancels the moment the event fires, open succeeds, or the
//      deadline is hit (warn, never throw).
function whenReady(fn) {
  if (autoOpenReady()) {
    fn()
    return
  }
  const deadline = Date.now() + AUTO_OPEN_DEADLINE_MS
  let done = false
  let timer = null
  const finish = () => {
    if (done) return
    done = true
    if (timer !== null) clearInterval(timer)
    document.removeEventListener('hyperclay:mutation-ready', onMutationReady)
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
    // Body may still be pending — the one-shot listener is already consumed,
    // so only the backstop remains to catch it once body arrives.
  }
  document.addEventListener('hyperclay:mutation-ready', onMutationReady, { once: true })
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
        'hypercms: ?cms=true auto-open gave up — window.hyperclay.Mutation never appeared. ' +
        'Load hyperclayjs (or the mutation utility) so the CMS can initialize.'
      )
    }
  }, SAFETY_POLL_MS)
}

// Auto-open at module load (browser only — node tests import this without a real
// window, and the guards above no-op there).
maybeAutoOpen()

const cms = {
  open,
  close,
  refresh,
  api,
  get isOpen() { return state.isOpen },
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
