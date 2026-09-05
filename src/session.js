// The session core: everything an editing session is, independent of the chrome
// that renders it. Rule resolution, the ctx object every module reads, the first
// extract, the observer / undo / live-sync subscriptions, the global sortable
// wiring, event dispatch, and one idempotent teardown. A view (src/views/*)
// supplies the DOM; the session owns the state and the page.

import { engine } from 'hyper-html-api'
import { injectDefaults, injectComponents } from './templates.js'
import { deriveFormRules } from './form-rules.js'
import { warnUnmatchedTemplates } from './diagnostics.js'
import { findUnresolved, stripReadOnly } from './unresolved.js'
import { rowIdentitySeeder } from './row-identity.js'
import {
  commit,
  commitWithUndo,
  suppressUndo,
  extractFormData,
  stableStringify,
  restampAllSiblings,
  coerceBooleans,
} from './events.js'
import { installObserver } from './refresh.js'
import { platform, onPlatformEvent, LIVESYNC_APPLIED } from './platform.js'

const ENGINE_OPTS = { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }

export const state = {
  isOpen: false,
  ctx: null,
  opts: null,
}

// Build the session for one open(): resolve the rules, hand them to the view for
// its own preparation, derive the form schema, and take the first read of the
// page. The view is not mounted yet — ctx reads its DOM handles lazily, so the
// mount can stay inside open()'s try block.
export function createSession({ view, doc, pageRoot, opts = {}, onCloseRequested, onViewRequested }) {
  // Resolve rules via the union: an explicit rules object, a token string, or
  // the default token "cms". findRules is document-scoped, so a head-mounted
  // rules tag is found even though pageRoot defaults to <body>.
  const source = opts.rules !== undefined ? opts.rules : 'cms'
  const found = engine.findRules(doc, source)
  if (!found) {
    const what = typeof source === 'string' ? `data-rules-name~="${source}"` : 'the provided rules object'
    throw new Error(`hypercms: no rules found for ${what}`)
  }
  // The view's rule seam. The sidebar applies the rich-text upgrade (default on):
  // bare scalar rules whose page element contains child elements are rebound
  // through @innerHTML so links and inline formatting survive the round-trip, and
  // their form fields render the @richtext component.
  const pageRules = view.prepareRules(found.rules)
  const rulesTagNode = found.tagNode

  injectDefaults(doc)
  injectComponents(doc, pageRules)
  warnUnmatchedTemplates(doc, pageRules)
  const formRules = deriveFormRules(pageRules, doc)
  // The write half of the rules; see stripReadOnly. The form and every extract
  // keep the full tree.
  const writeRules = stripReadOnly(pageRules)
  // Runs before the first extract so a rule with invalid CSS names its field
  // instead of throwing a bare SyntaxError out of querySelectorAll.
  const unresolved = findUnresolved(pageRoot, pageRules)
  // Bind each form row to the page row it stands for while the two are still
  // known to correspond, which is now: the form the view builds comes from
  // exactly this read. Without it the first structural operation of a session has
  // no identity to go on and falls back to content matching.
  const seeder = rowIdentitySeeder()
  const data = coerceBooleans(engine.extract(pageRoot, pageRules, { ...ENGINE_OPTS, ...seeder.hooks }), pageRules)

  const ctx = {
    doc,
    pageRoot,
    pageRules,
    writeRules,
    formRules,
    rulesTagNode,
    rulesSource: source,
    richText: view.richText,
    view,
    seeder,
    initialData: data,
    get formRoot() { return view.formRoot },
    get shellRoot() { return view.root },
    get errorEl() { return view.errorEl },
    get noticeEl() { return view.noticeEl },
    unresolved,
    lastTwinSignature: null,
    lastFingerprint: null,
    lastData: null,
    observerHandle: null,
    undoUnsub: null,
    livesyncUnsub: null,
    onChange: opts.onChange,
    onError: opts.onError,
    confirmRemove: opts.confirmRemove,
    previouslyFocused: doc.activeElement,
    dispatch(name, detail) {
      const Ctor = (doc.defaultView && doc.defaultView.CustomEvent) || (typeof CustomEvent !== 'undefined' ? CustomEvent : null)
      if (!Ctor) return
      // Every event carries the page it belongs to and which view is rendering
      // it, so a document-level listener can tell a sidebar session from an
      // inline one without inspecting the DOM. Merged into the caller's detail
      // rather than replacing it: hcms:change still carries .data, hcms:error
      // still carries .error.
      const payload = { ...(detail || {}), pageRoot, view: view.name }
      const ev = new Ctor(name, { bubbles: true, cancelable: name === 'hcms:change', detail: payload })
      // A full-document morph (live sync, a version restore) can replace the
      // view root between mount and dispatch. Falling back to the page keeps the
      // event on the document instead of firing it into a detached tree where no
      // listener will ever see it.
      const target = view.root && view.root.isConnected !== false ? view.root : pageRoot
      target.dispatchEvent(ev)
    },
    onCloseRequested,
    // How a view asks to be rendered as a different one. The switch runs through
    // open({ view }), which carries this session's options across it, so the
    // request changes the presentation and not the session.
    onViewRequested,
  }
  ctx.updateFingerprint = () => {
    ctx.lastFingerprint = stableStringify(extractFormData(ctx))
  }
  view.ctx = ctx
  return ctx
}

// Everything that outlives the mount: the fingerprint the commit path compares
// against, and the three external subscriptions plus the global sortable hook.
// Runs after the view is mounted, so a throw here is caught by open() and routed
// through teardownSession.
export function startSession(ctx) {
  ctx.updateFingerprint()

  ctx.observerHandle = installObserver({
    onRefresh: (changes) => ctx.view.refresh('observer', changes),
  })

  // Undo/redo is a deliberate local action (unlike livesync or in-flight typing),
  // so the focused form field SHOULD snap to the reverted value. The observer above
  // is source-blind, so subscribe to the undo scope and force a non-ignoring refresh.
  // Fires synchronously before the debounced observer refresh, which then no-ops on
  // the active field. Guarded so it degrades to today's behavior when undo isn't loaded.
  const u = platform('undo')
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
        engine.extract(ctx.pageRoot, ctx.pageRules, ENGINE_OPTS),
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
  // document live-sync dispatches on; unsubscribed in teardownSession.
  const onLivesync = () => resyncForm(ctx, 'livesync')
  ctx.livesyncUnsub = onPlatformEvent(ctx.doc, LIVESYNC_APPLIED, onLivesync)

  // Wire global sortable callback to current ctx (cleared by teardownSession).
  globalCommitTarget.ctx = ctx
  installGlobalSortableCommit(ctx.doc)
}

// Re-sync the view to the page after a change hypercms did NOT originate.
// `reason` selects whether the field the user is currently typing in snaps:
//   'undo' / 'redo' — the user's own deliberate action, so the focused field
//                     SHOULD snap to the reverted value (ignoreActiveValue:false).
//   'livesync'      — someone else's / the framework's change, so the user's
//                     in-progress focused field must NOT be yanked away
//                     (ignoreActiveValue:true). morphForm re-extracts every
//                     other field to the new page value, killing the stale-form
//                     clobber, while leaving the active field alone until blur.
// Both reasons route through the view's one refresh entry point.
function resyncForm(ctx, reason) {
  // open() may have moved on (closed, or reopened with a new ctx) between an
  // async morph completing and this firing.
  if (state.ctx !== ctx) return
  ctx.view.refresh(reason)
}

// The one teardown. close(), the failed-open path inside open(), and (later) a
// view switch all route through it; the options say only which of the three
// close-specific side effects apply.
export function teardownSession(ctx, { dispatch = true, restoreFocus = true, updateUrl = true, reason = 'close' } = {}) {
  if (!ctx || ctx.closed) return
  // Mark this ctx dead so any in-flight async work (e.g. an upload awaiting the
  // host uploader) bails instead of mutating the page / firing onChange after
  // teardown. Mirrors the state.ctx !== ctx guards on the undo/livesync paths.
  ctx.closed = true
  // An upload still in flight is torn down like any other subscription. The
  // ctx.closed check above already stops it writing; this stops it running.
  for (const controller of ctx.uploads || []) { try { controller.abort() } catch {} }
  ctx.uploads?.clear()
  const previouslyFocused = ctx.previouslyFocused
  if (dispatch) ctx.dispatch('hcms:close', { reason })
  if (updateUrl) toggleCloseParam()
  ctx.observerHandle?.unsubscribe?.()
  ctx.undoUnsub?.()
  ctx.livesyncUnsub?.()
  ctx.detachEvents?.()
  // destroy() removes the chrome-only body classes; suppress so the inverse
  // class removal doesn't enter the undo stack either.
  suppressUndo(() => ctx.view.destroy())
  clearState()
  if (restoreFocus && typeof previouslyFocused?.focus === 'function') {
    try { previouslyFocused.focus() } catch (_) {}
  }
}

function clearState() {
  state.isOpen = false
  state.ctx = null
  state.opts = null
  globalCommitTarget.ctx = null
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
