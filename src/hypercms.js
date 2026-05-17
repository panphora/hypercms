import { engine } from 'hyper-html-api'
import * as pathUtil from './path.js'
import { scaffold } from './scaffold.js'
import { morphForm } from './morph.js'
import { injectDefaults } from './templates.js'
import { deriveFormRules } from './form-rules.js'
import { buildForm } from './form-builder.js'
import { bindEvents, commit, onAdd as evOnAdd, onRemove as evOnRemove, extractFormData } from './events.js'
import { mountShell, setShellStyles } from './shell.js'
import { refreshForm, installObserver } from './refresh.js'

export function installStyles(text) {
  setShellStyles(text)
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

  const fragment = buildForm({ pageRules, formRules, data, doc })
  shell.formRoot.appendChild(fragment)

  bindEvents(ctx)

  ctx.observerHandle = installObserver({
    pageRoot,
    doc,
    onRefresh: () => refreshForm(ctx),
    shellRoot: shell.root,
  })

  state.isOpen = true
  state.ctx = ctx
  state.shell = shell
  state.opts = opts

  ctx.dispatch('hcms:open', { pageRoot })
}

export function close() {
  if (!state.isOpen) return
  const { ctx, shell } = state
  ctx.dispatch('hcms:close', null)
  ctx.observerHandle?.unsubscribe?.()
  ctx.detachEvents?.()
  shell.destroy()
  state.isOpen = false
  state.ctx = null
  state.shell = null
  state.opts = null
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
    const el = ctx.formRoot.querySelector(`[data-hcms-path="${cssEscape(path)}"] [data-hcms-field], [data-hcms-path="${cssEscape(path)}"][data-hcms-field]`)
    if (!el) throw new Error(`hypercms: no element at path "${path}"`)
    if ('value' in el) el.value = value == null ? '' : String(value)
    else el.textContent = value == null ? '' : String(value)
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
    commit(extractFormData(ctx), { path: '', structural: true }, ctx)
  },
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
