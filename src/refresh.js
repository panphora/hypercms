import { engine } from 'hyper-html-api'
import { buildForm } from './form-builder.js'
import { morphForm } from './morph.js'

export function refreshForm(ctx) {
  const newData = engine.extract(ctx.pageRoot, ctx.pageRules)
  const fragment = buildForm({
    pageRules: ctx.pageRules,
    formRules: ctx.formRules,
    data: newData,
    doc: ctx.doc,
  })
  morphForm(ctx.formRoot, fragment)
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
