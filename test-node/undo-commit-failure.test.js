import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { injectDefaults } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { commit, commitWithUndo } from '../src/events.js'

// Tier 1b (6a): commitWithUndo's failure path must discard cleanly. With a real
// hyper-undo scope attached, a commit whose apply throws (ShapeMismatch) should
// leave the undo stack empty (no half-commit, no mutate+rollback noise) AND
// leave the scope unpaused (pause/resume is balanced in a finally). events.test.js
// covers commitWithUndo's branches with spies plus the success/no-op end-to-end
// paths; the real-scope FAILURE path is the gap this closes.
//
// commitWithUndo is the exact production wrapper used by api._commit, the
// add/remove/move handlers, and the drag-sort global, so driving it directly
// against a real ctx + scope exercises the real pause -> fn -> discardCaptured
// -> resume path.

async function loadUndo() {
  try {
    return (await import('../../hyper-undo/src/scope.js')).createScope
  } catch {
    return null // sibling package unavailable in this checkout; covered by browser tests
  }
}

const PAGE = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">A</h1>
</body></html>`

function buildCtx(pageRules, data) {
  const doc = document
  injectDefaults(doc)
  const formRules = deriveFormRules(pageRules, doc)
  const formHost = doc.createElement('div')
  formHost.setAttribute('data-hcms-form-root', '')
  doc.body.appendChild(formHost)
  const fragment = buildForm({ pageRules, formRules, data, doc })
  formHost.appendChild(fragment)
  const errorEl = doc.createElement('div')
  errorEl.hidden = true
  return {
    doc,
    pageRoot: doc.body,
    pageRules,
    formRules,
    formRoot: formHost,
    errorEl,
    lastFingerprint: null,
    lastData: null,
    observerHandle: null,
    dispatch: () => {},
  }
}

test('commitWithUndo failure path: a failed apply records nothing and leaves the scope unpaused', async () => {
  const createScope = await loadUndo()
  if (!createScope) return
  const dom = loadPage(PAGE)
  const ctx = buildCtx({ title: '.title' }, { title: 'A' })

  const scope = createScope({ scope: document.body, idleWindowMs: 500 })
  scope.start()
  window.hyperclay.undo = scope
  try {
    scope.clear() // clean baseline
    assert.equal(scope.canUndo, false, 'baseline is empty after clear')
    const historyBefore = scope.history.length

    // Object data for a scalar rule → ShapeMismatch inside engine.apply, the
    // kind of failed apply commitWithUndo's discard path exists to handle.
    const result = commitWithUndo('Update', () =>
      commit({ title: { bad: 'shape' } }, { path: 'title', structural: true }, ctx),
    )

    assert.equal(result.ok, false, 'the apply failed (not a skipped no-op)')
    assert.equal(result.error?.name, 'ShapeMismatch', 'failure is a ShapeMismatch')

    assert.equal(
      scope.history.length,
      historyBefore,
      'no half-commit landed: history is unchanged after the failed apply',
    )
    assert.equal(scope.canUndo, false, 'nothing became undoable after the failure')
    assert.equal(scope.isPaused, false, 'scope must not be left paused after the failure')
  } finally {
    window.hyperclay.undo = undefined
    scope.stop()
    dom.window.close()
  }
})
