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

test('applyWithRollback: success path writes new data', () => {
  const root = setupPage()
  const result = applyWithRollback(root, { title: '.title' }, { title: 'New' })
  assert.equal(result.ok, true)
  assert.equal(root.querySelector('.title').textContent, 'New')
})

test('applyWithRollback: failure restores snapshot', () => {
  const root = setupPage()
  // Object data for a scalar rule → ShapeMismatch
  const result = applyWithRollback(root, { title: '.title' }, { title: { bad: 'shape' } })
  assert.equal(result.ok, false)
  assert.equal(result.error.name, 'ShapeMismatch')
  assert.equal(root.querySelector('.title').textContent, 'Old')
})

test('applyWithRollback: observer pause/resume invoked', () => {
  const root = setupPage()
  const calls = []
  const handle = {
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  }
  applyWithRollback(root, { title: '.title' }, { title: 'X' }, handle)
  assert.deepEqual(calls, ['pause', 'resume'])
})

test('applyWithRollback: observer resumed even on error', () => {
  const root = setupPage()
  const calls = []
  const handle = {
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  }
  applyWithRollback(root, { title: '.title' }, { title: { bad: true } }, handle)
  assert.deepEqual(calls, ['pause', 'resume'])
})
