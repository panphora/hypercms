import { engine } from 'hyper-html-api'
import { buildForm } from './form-builder.js'
import { morphForm } from './morph.js'
import { injectDefaults, injectComponents } from './templates.js'
import { deriveFormRules } from './form-rules.js'
import { coerceBooleans, applyErrorState } from './events.js'

const ENGINE_OPTS = { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }

export function refreshForm(ctx, { ignoreActiveValue } = {}) {
  // Re-resolve rules every refresh, source-aware: an object source returns the
  // same literal (tagNode null); a token source re-resolves the tag so a
  // livesync-replaced rules tag is picked up. Document-scoped via ctx.doc.
  const found = engine.findRules(ctx.doc, ctx.rulesSource || 'cms')
  if (found) {
    ctx.pageRules = found.rules
    ctx.rulesTagNode = found.tagNode
  }
  // Re-derive formRules so schema changes (rule shape, template overrides) flow through.
  injectDefaults(ctx.doc)
  injectComponents(ctx.doc, ctx.pageRules)
  ctx.formRules = deriveFormRules(ctx.pageRules, ctx.doc)

  const newData = coerceBooleans(
    engine.extract(ctx.pageRoot, ctx.pageRules, ENGINE_OPTS),
    ctx.pageRules
  )
  const fragment = buildForm({
    pageRules: ctx.pageRules,
    formRules: ctx.formRules,
    data: newData,
    doc: ctx.doc,
  })
  morphForm(ctx.formRoot, fragment, { ignoreActiveValue })
  // morphForm rebuilds the form structure; inline error slots get wiped. Re-apply
  // the last error state so error messages survive across observer-driven refreshes
  // (e.g., the rollback after a failed add).
  applyErrorState(ctx)
  // Update fingerprint so subsequent commits against the new page state compare correctly.
  if (ctx.updateFingerprint) ctx.updateFingerprint()
}

export function installObserver({ debounce = 100, onRefresh }) {
  const M = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.Mutation) || null
  if (!M || typeof M.onAnyChange !== 'function') {
    throw new Error('hypercms: window.hyperclay.Mutation is required. Load hyperclayjs (or just the mutation utility) before initializing hypercms.')
  }
  let paused = 0
  const unsub = M.onAnyChange({ debounce }, () => {
    if (paused > 0) return
    onRefresh()
  })
  return {
    unsubscribe: typeof unsub === 'function' ? unsub : () => {},
    pause() { paused++ },
    resume() { paused = Math.max(0, paused - 1) },
  }
}
