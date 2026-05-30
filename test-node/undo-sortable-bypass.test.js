import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// Regression for the H4 finding in plans/hyperclayjs/undo-redo-codex-review.md:
// the drag-sort global (`hypercmsCommit`) and `api._commit` structural-commit
// paths must route through commitWithUndo, so with undo loaded a reorder lands
// as a single labeled commit (not a generic idle 'Edit', and no apply+rollback
// noise). The keyboard move buttons already did this; these two paths did not.

const PAGE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "products": [".product", { "name": ".n" }] }
  </script>
  <div>
    <div class="product"><span class="n">A</span></div>
    <div class="product"><span class="n">B</span></div>
    <div class="product"><span class="n">C</span></div>
  </div>
</body></html>`

async function loadUndo() {
  try {
    return (await import('../../hyper-undo/src/scope.js')).createScope
  } catch {
    return null // sibling package unavailable in this checkout; covered by browser tests
  }
}

function pageNames() {
  return Array.from(document.querySelectorAll('.product .n')).map((e) => e.textContent)
}

test('api._commit routes a reorder through commitWithUndo (labeled, single, reversible)', async () => {
  const createScope = await loadUndo()
  if (!createScope) return
  if (isOpen()) close()
  const dom = loadPage(PAGE)
  // idleWindowMs large so nothing closes implicitly mid-test; we drive commits explicitly.
  const scope = createScope({ scope: document.body, idleWindowMs: 500 })
  scope.start()
  window.hyperclay.undo = scope
  try {
    open()
    scope.clear() // clean baseline: discard anything buffered/recorded during open()
    assert.equal(scope.canUndo, false, 'baseline is empty after clear')

    // Reorder the form: move the first card to the end (A,B,C -> B,C,A), then commit.
    const slot = document.querySelector('[data-hcms-form-root] .hcms-array-items')
    const cards = Array.from(slot.querySelectorAll(':scope > [data-hcms-card]'))
    slot.appendChild(cards[0])
    api._commit()

    assert.deepEqual(pageNames(), ['B', 'C', 'A'], 'page reflects the reorder')
    assert.deepEqual(
      scope.history.map((c) => c.label),
      ['Update'],
      'exactly one labeled commit (not a generic "Edit", no rollback noise)',
    )

    scope.undo()
    assert.deepEqual(pageNames(), ['A', 'B', 'C'], 'undo restores the original page order')
  } finally {
    window.hyperclay.undo = undefined
    scope.stop()
    close()
    dom.window.close()
  }
})

test('window.hypercmsCommit (drag-sort global) routes through commitWithUndo', async () => {
  const createScope = await loadUndo()
  if (!createScope) return
  if (isOpen()) close()
  const dom = loadPage(PAGE)
  const scope = createScope({ scope: document.body, idleWindowMs: 500 })
  scope.start()
  window.hyperclay.undo = scope
  try {
    open()
    scope.clear()

    const slot = document.querySelector('[data-hcms-form-root] .hcms-array-items')
    const cards = Array.from(slot.querySelectorAll(':scope > [data-hcms-card]'))
    slot.appendChild(cards[0]) // A,B,C -> B,C,A in the form
    assert.equal(typeof window.hypercmsCommit, 'function', 'global sortable commit is installed')
    window.hypercmsCommit()

    assert.deepEqual(pageNames(), ['B', 'C', 'A'], 'page reflects the drag reorder')
    assert.deepEqual(
      scope.history.map((c) => c.label),
      ['Reorder'],
      'drag-sort lands as a single "Reorder" commit, not an idle "Edit"',
    )
  } finally {
    window.hyperclay.undo = undefined
    scope.stop()
    close()
    dom.window.close()
  }
})

test('a no-op _commit with undo loaded records nothing', async () => {
  const createScope = await loadUndo()
  if (!createScope) return
  if (isOpen()) close()
  const dom = loadPage(PAGE)
  const scope = createScope({ scope: document.body, idleWindowMs: 500 })
  scope.start()
  window.hyperclay.undo = scope
  try {
    open()
    scope.clear()
    api._commit() // nothing changed → commit() is a skipped no-op
    assert.equal(scope.canUndo, false, 'no spurious commit when the apply is a no-op')
  } finally {
    window.hyperclay.undo = undefined
    scope.stop()
    close()
    dom.window.close()
  }
})
