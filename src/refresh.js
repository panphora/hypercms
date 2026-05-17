import { engine } from 'hyper-html-api'
import { buildForm } from './form-builder.js'
import { morphForm } from './morph.js'
import { withoutShell } from './shell-isolation.js'
import { injectDefaults } from './templates.js'
import { deriveFormRules } from './form-rules.js'

export function refreshForm(ctx) {
  // Re-read rules tag every refresh so a livesync-replaced rules tag is picked up.
  const found =
    engine.findRulesIn(ctx.pageRoot) ||
    (ctx.doc.documentElement && engine.findRulesIn(ctx.doc.documentElement)) ||
    engine.findRulesIn(ctx.doc)
  if (found) {
    ctx.pageRules = found.rules
    ctx.rulesTagNode = found.tagNode
  }
  // Re-derive formRules so schema changes (rule shape, template overrides) flow through.
  injectDefaults(ctx.doc)
  ctx.formRules = deriveFormRules(ctx.pageRules, ctx.doc)

  const newData = withoutShell(ctx.pageRoot, ctx.shellRoot, (root) =>
    engine.extract(root, ctx.pageRules)
  )
  const fragment = buildForm({
    pageRules: ctx.pageRules,
    formRules: ctx.formRules,
    data: newData,
    doc: ctx.doc,
  })
  morphForm(ctx.formRoot, fragment)
  // Update fingerprint so subsequent commits against the new page state compare correctly.
  if (ctx.updateFingerprint) ctx.updateFingerprint()
}

export function installObserver({ pageRoot, doc, debounce = 100, onRefresh, shellRoot }) {
  let paused = 0
  const M = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.Mutation) || null
  if (M && typeof M.onAnyChange === 'function') {
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

  let timer = null
  const observer = new (doc.defaultView || globalThis).MutationObserver((mutations) => {
    if (paused > 0) return
    const relevant = mutations.some((m) => {
      const t = m.target
      if (!t || !t.closest) return true
      return !t.closest('[data-hcms-shell]')
    })
    if (!relevant) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      try { onRefresh() } catch (err) { console.error('hypercms: refresh failed', err) }
    }, debounce)
  })
  observer.observe(pageRoot, { childList: true, attributes: true, subtree: true, characterData: true })
  return {
    unsubscribe() { clearTimeout(timer); observer.disconnect() },
    pause() { paused++ },
    resume() { paused = Math.max(0, paused - 1) },
  }
}
