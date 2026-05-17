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
