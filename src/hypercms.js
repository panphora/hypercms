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
  onAdd as evOnAdd,
  onRemove as evOnRemove,
  extractFormData,
  stableStringify,
  restampAllSiblings,
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

export function open(opts = {}) {
  if (state.isOpen) {
    console.warn('cms.open() called while already open; ignoring')
    return
  }
  const pageRoot = opts.pageRoot || (typeof document !== 'undefined' ? document.body : null)
  if (!pageRoot) throw new Error('hypercms: no pageRoot available')
  const doc = pageRoot.ownerDocument || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('hypercms: no document available')

  // The rules tag is typically in <head>, but pageRoot defaults to <body>.
  // Look up the whole document so head-mounted rules tags are found.
  const found = engine.findRulesIn(pageRoot) || engine.findRulesIn(doc.documentElement) || engine.findRulesIn(doc)
  if (!found) throw new Error('hypercms: no rules tag found in page')
  const pageRules = found.rules
  const rulesTagNode = found.tagNode

  injectDefaults(doc)
  warnUnmatchedTemplates(doc, pageRules)
  const formRules = deriveFormRules(pageRules, doc)
  const data = engine.extract(pageRoot, pageRules)

  const shell = mountShell({
    mountTo: opts.mountTo || doc.body,
    side: opts.side || 'right',
    overlay: !!opts.overlay,
    showSaveButton: !!opts.showSaveButton,
    doc,
  })

  const ctx = {
    doc,
    pageRoot,
    pageRules,
    formRules,
    rulesTagNode,
    formRoot: shell.formRoot,
    shellRoot: shell.root,
    errorEl: shell.errorEl,
    lastFingerprint: null,
    lastData: null,
    observerHandle: null,
    onChange: opts.onChange,
    onError: opts.onError,
    onSave: opts.onSave,
    previouslyFocused: doc.activeElement,
    dispatch(name, detail) {
      const Ctor = (doc.defaultView && doc.defaultView.CustomEvent) || (typeof CustomEvent !== 'undefined' ? CustomEvent : null)
      if (!Ctor) return
      const ev = new Ctor(name, { bubbles: true, cancelable: name === 'hcms:change' || name === 'hcms:save', detail })
      shell.root.dispatchEvent(ev)
    },
    onCloseRequested() {
      close()
    },
  }
  ctx.updateFingerprint = () => {
    ctx.lastFingerprint = stableStringify(extractFormData(ctx))
  }

  const fragment = buildForm({ pageRules, formRules, data, doc })
  shell.formRoot.appendChild(fragment)

  bindEvents(ctx)
  ctx.updateFingerprint()

  ctx.observerHandle = installObserver({
    pageRoot,
    doc,
    onRefresh: () => refreshForm(ctx),
    shellRoot: shell.root,
  })

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
    commit(extractFormData(ctx), { path: '', structural: true }, ctx)
  }
  if (typeof win.hypercmsCommit !== 'function') win.hypercmsCommit = hypercmsCommitFn
  // Also mirror to globalThis so non-window contexts (Node tests, workers)
  // can resolve the bare name from `new Function('hypercmsCommit()')`.
  if (typeof globalThis !== 'undefined' && typeof globalThis.hypercmsCommit !== 'function') {
    globalThis.hypercmsCommit = hypercmsCommitFn
  }
}

export function close() {
  if (!state.isOpen) return
  const { ctx, shell } = state
  const previouslyFocused = ctx.previouslyFocused
  ctx.dispatch('hcms:close', null)
  ctx.observerHandle?.unsubscribe?.()
  ctx.detachEvents?.()
  shell.destroy()
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
    const itemEl = state.ctx.formRoot.querySelector(`[data-hcms-path="${cssEscape(itemPath)}"]`)
    if (!itemEl) throw new Error(`hypercms: no element at path "${itemPath}"`)
    evOnRemove(itemEl, state.ctx)
  },
  refresh,
  _commit() {
    if (!state.isOpen) return
    const ctx = state.ctx
    restampAllSiblings(ctx.formRoot)
    commit(extractFormData(ctx), { path: '', structural: true }, ctx)
  },
}

function findLeafField(formRoot, path) {
  const esc = cssEscape(path)
  // Field may be the element with data-hcms-path itself (scalar template that
  // is also the field) or a [data-hcms-field] inside that container, or an
  // element stamped with the leaf path directly (inline path-stamped field).
  return (
    formRoot.querySelector(`[data-hcms-path="${esc}"][data-hcms-field]`) ||
    formRoot.querySelector(`[data-hcms-path="${esc}"] [data-hcms-field]`)
  )
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
