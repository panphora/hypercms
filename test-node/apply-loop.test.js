import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { applyWithRollback } from '../src/apply-loop.js'

function setupPage() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <h1 class="title">Old</h1>
  </body></html>`)
  return dom.window.document.body
}

test('applyWithRollback: scalar success writes new data', () => {
  const root = setupPage()
  const result = applyWithRollback(root, { title: '.title' }, { title: 'New' })
  assert.equal(result.ok, true)
  assert.equal(root.querySelector('.title').textContent, 'New')
})

test('applyWithRollback: scalar applies skip snapshot — error returned, page may diverge', () => {
  const root = setupPage()
  // Object data for a scalar rule → ShapeMismatch. Scalar path no longer
  // snapshots since string user input can't produce ShapeMismatch in real use.
  const result = applyWithRollback(root, { title: '.title' }, { title: { bad: 'shape' } })
  assert.equal(result.ok, false)
  assert.equal(result.error.name, 'ShapeMismatch')
})

test('applyWithRollback: structural failure restores snapshot', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <ul class="items"></ul>
  </body></html>`)
  const root = dom.window.document.body
  // Object-array with an empty list — engine will hit EmptyListInsert
  // when attempting to insert items with no template.
  const result = applyWithRollback(
    root,
    { items: ['.items li', { text: '.text' }] },
    { items: [{ text: 'first' }] },
    { structural: true }
  )
  assert.equal(result.ok, false)
  assert.equal(result.error.name, 'EmptyListInsert')
  // Page should be unchanged after rollback.
  assert.equal(root.querySelector('.items').children.length, 0)
})

// v0.4 fix #3 (P2): for object arrays, resolveContainerByPath used to call
// ctx.querySelector(itemSelector) and return the first MATCHING ITEM, not
// the array container. Subtree snapshot then captured the first item's
// children, and on rollback restoreChildren overwrote only that item —
// leaving any earlier list-level insert/reorder mutated. Fix mirrors the
// scalar-array path: walk to first?.parentElement.
//
// This test attaches a sentinel sibling to the array's parent and verifies
// rollback after a structural failure preserves it. With the bug the
// sentinel survives, BUT the original items array gets clobbered because
// only the first item's subtree is restored. With the fix, the parent's
// child list is the snapshot scope, so all items round-trip.
test('applyWithRollback: object-array rollback preserves all existing items', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="list">
      <div class="product" data-id="a"><span class="name">A</span></div>
      <div class="product" data-id="b"><span class="name">B</span></div>
      <div class="product" data-id="c"><span class="name">C</span></div>
    </div>
  </body></html>`)
  const root = dom.window.document.body
  // ShapeMismatch on a nested field forces the engine to throw partway
  // through the list apply — the kind of error rollback exists to handle.
  const result = applyWithRollback(
    root,
    { products: ['.product', { name: '.name' }] },
    { products: [{ name: 'A1' }, { name: { bad: 'shape' } }, { name: 'C1' }] },
    { structural: true, structuralPath: 'products' }
  )
  assert.equal(result.ok, false, 'structural apply failed as expected')
  // All three items must still be present after rollback. With the v0.3
  // bug, rollback would have restored only the first item's children
  // (leaving the second/third orphaned or removed).
  const items = root.querySelectorAll('#list .product')
  assert.equal(items.length, 3, 'parent-level rollback restored all three items')
  const ids = Array.from(items).map((p) => p.getAttribute('data-id'))
  assert.deepEqual(ids, ['a', 'b', 'c'], 'order + identity preserved')
})

// v0.3 fix #5 (Should-fix): structural rollback should snapshot only the
// affected array container, not the entire non-shell page. A listener
// attached to an unrelated button outside the array survives rollback.
test('applyWithRollback: subtree-only snapshot preserves listeners on unrelated nodes', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <button id="unrelated">Click me</button>
    <ul class="items"></ul>
  </body></html>`)
  const root = dom.window.document.body
  let clicks = 0
  const btn = root.querySelector('#unrelated')
  btn.addEventListener('click', () => { clicks++ })
  // Trigger a structural error against the empty list — engine raises
  // EmptyListInsert and the rollback runs against just the .items subtree.
  const result = applyWithRollback(
    root,
    { items: ['.items li', { text: '.text' }] },
    { items: [{ text: 'first' }] },
    { structural: true, structuralPath: 'items' }
  )
  assert.equal(result.ok, false)
  // The unrelated button is the same DOM node (subtree snapshot didn't
  // clone+replace it), so its listener still fires.
  btn.click()
  assert.equal(clicks, 1, 'listener on unrelated node survived structural rollback')
})

test('applyWithRollback: observer pause/resume invoked', () => {
  const root = setupPage()
  const calls = []
  const handle = {
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  }
  applyWithRollback(root, { title: '.title' }, { title: 'X' }, { observerHandle: handle })
  assert.deepEqual(calls, ['pause', 'resume'])
})

test('applyWithRollback: observer resumed even on error', () => {
  const root = setupPage()
  const calls = []
  const handle = {
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  }
  applyWithRollback(root, { title: '.title' }, { title: { bad: true } }, { observerHandle: handle })
  assert.deepEqual(calls, ['pause', 'resume'])
})
