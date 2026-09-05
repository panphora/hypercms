import { engine } from 'hyper-html-api'
import { buildForm } from './form-builder.js'
import { morphForm } from './morph.js'
import { injectDefaults, injectComponents } from './templates.js'
import { deriveFormRules } from './form-rules.js'
import { coerceBooleans, applyErrorState } from './events.js'
import { findUnresolved, applyUnresolvedState, stripReadOnly } from './unresolved.js'
import { enhanceFields } from './enhance.js'
import { platform } from './platform.js'
import { rowIdentitySeeder } from './row-identity.js'

const ENGINE_OPTS = { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }

export function refreshForm(ctx, { ignoreActiveValue } = {}) {
  // Re-resolve rules every refresh, source-aware: an object source returns the
  // same literal (tagNode null); a token source re-resolves the tag so a
  // livesync-replaced rules tag is picked up. Document-scoped via ctx.doc.
  const found = engine.findRules(ctx.doc, ctx.rulesSource || 'cms')
  if (found) {
    // Re-apply the rule upgrade open() performed: the tag holds the author's
    // bare rules, and using them raw would rebind upgraded fields back to
    // textContent mid-session. Route it through the SAME seam open() used
    // (session.js hands found.rules to view.prepareRules) rather than
    // hardcoding one view's upgrade here — that undid a wider upgrade on the
    // first refresh, silently flattening rich text back to plain.
    ctx.pageRules = ctx.view.prepareRules(found.rules)
    ctx.rulesTagNode = found.tagNode
  }
  // Re-derive formRules so schema changes (rule shape, template overrides) flow through.
  injectDefaults(ctx.doc)
  injectComponents(ctx.doc, ctx.pageRules)
  ctx.formRules = deriveFormRules(ctx.pageRules, ctx.doc)
  ctx.writeRules = stripReadOnly(ctx.pageRules)
  // Before the extract below, for the same readable-failure reason as open().
  ctx.unresolved = findUnresolved(ctx.pageRoot, ctx.pageRules)

  // The morph below can rebuild a form row, which drops its binding to the page
  // row it stood for. Read the pairing off this extract and re-establish it once
  // the morph has settled, so the first operation after a refresh is not left
  // guessing.
  const seeder = rowIdentitySeeder()
  const newData = coerceBooleans(
    engine.extract(ctx.pageRoot, ctx.pageRules, { ...ENGINE_OPTS, ...seeder.hooks }),
    ctx.pageRules
  )
  const fragment = buildForm({
    pageRules: ctx.pageRules,
    formRules: ctx.formRules,
    data: newData,
    doc: ctx.doc,
  })
  morphForm(ctx.formRoot, fragment, { ignoreActiveValue })
  seeder.seed(ctx.formRoot)
  // The morph can rebuild field nodes, dropping autosize heights and richclay
  // instances (instances are per-element); re-enhance whatever is new.
  enhanceFields(ctx.formRoot, ctx.doc)
  // morphForm rebuilds the form structure; inline error slots get wiped. Re-apply
  // the last error state so error messages survive across observer-driven refreshes
  // (e.g., the rollback after a failed add).
  applyErrorState(ctx)
  applyUnresolvedState(ctx)
  // Update fingerprint so subsequent commits against the new page state compare correctly.
  if (ctx.updateFingerprint) ctx.updateFingerprint()
}

export function installObserver({ debounce = 100, onRefresh }) {
  const M = platform('Mutation')
  if (!M || typeof M.onAnyChange !== 'function') {
    throw new Error('hypercms: a mutation hub is required (clay.Mutation or hyperclay.Mutation). Load clayjs or hyperclayjs, or just the mutation utility, before initializing hypercms.')
  }
  let paused = 0
  // The hub hands every subscriber the batch of changes it collected
  // ({ type: 'add' | 'remove' | 'attribute', element, parent, attribute,
  // oldValue, newValue }, see clayjs/src/lib/mutation.js). Discarding them was
  // fine while the only view was the sidebar, which refreshes wholesale. A view
  // that edits the page in place needs to know whether a batch is its own doing,
  // so pass them on and let the view decide.
  const unsub = M.onAnyChange({ debounce }, (changes) => {
    if (paused > 0) return
    onRefresh(changes)
  })
  return {
    unsubscribe: typeof unsub === 'function' ? unsub : () => {},
    pause() { paused++ },
    resume() { paused = Math.max(0, paused - 1) },
  }
}
