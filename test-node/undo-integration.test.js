import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { commitWithUndo } from '../src/events.js'

// commitWithUndo uses the pause-before / commit-on-success pattern:
//   - no undo loaded       -> just runs fn and returns its result
//   - fn returns { ok:true } -> pause, commitCaptured(label), resume
//   - fn returns falsy/!ok -> pause, discardCaptured(), resume (no commit)
//   - fn throws            -> pause, resume (finally), rethrow (no commit)

function makeSpy() {
  const calls = []
  return {
    calls,
    pause() { calls.push('pause') },
    resume() { calls.push('resume') },
    commitCaptured(label) { calls.push('commit:' + label) },
    discardCaptured() { calls.push('discard') },
  }
}

function setWindow(undo) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>')
  global.window = dom.window
  global.document = dom.window.document
  global.MutationObserver = dom.window.MutationObserver
  if (undo !== undefined) dom.window.hyperclay = { undo }
  return dom
}

test('commitWithUndo: runs fn and returns its result when no undo is present', () => {
  setWindow(undefined)
  let ran = false
  const r = commitWithUndo('Add', () => { ran = true; return { ok: true, value: 42 } })
  assert.equal(ran, true)
  assert.deepEqual(r, { ok: true, value: 42 })
})

test('commitWithUndo: ok result -> pause, commitCaptured, resume', () => {
  const spy = makeSpy()
  setWindow(spy)
  const r = commitWithUndo('Add foo', () => { spy.calls.push('apply'); return { ok: true } })
  assert.deepEqual(spy.calls, ['pause', 'apply', 'commit:Add foo', 'resume'])
  assert.deepEqual(r, { ok: true })
})

test('commitWithUndo: commitCaptured runs BEFORE resume (resume drains the buffer)', () => {
  const spy = makeSpy()
  setWindow(spy)
  commitWithUndo('Move', () => ({ ok: true }))
  const ci = spy.calls.indexOf('commit:Move')
  const ri = spy.calls.indexOf('resume')
  assert.ok(ci !== -1 && ri !== -1 && ci < ri, 'commit must precede resume')
})

test('commitWithUndo: failed apply (!ok) discards instead of committing', () => {
  const spy = makeSpy()
  setWindow(spy)
  const r = commitWithUndo('Remove', () => ({ ok: false, error: 'bad' }))
  assert.deepEqual(spy.calls, ['pause', 'discard', 'resume'])
  assert.ok(!spy.calls.some((c) => c.startsWith('commit:')), 'no commit on failed apply')
  assert.deepEqual(r, { ok: false, error: 'bad' })
})

test('commitWithUndo: resumes (finally) and rethrows on error without committing', () => {
  const spy = makeSpy()
  setWindow(spy)
  assert.throws(
    () => commitWithUndo('Add', () => { spy.calls.push('apply'); throw new Error('boom') }),
    /boom/,
  )
  assert.deepEqual(spy.calls, ['pause', 'apply', 'resume'])
  assert.ok(!spy.calls.some((c) => c.startsWith('commit:')), 'no commit on throw')
})

test('end-to-end: an ok structural apply becomes a reversible undo commit', async () => {
  let createScope
  try {
    ({ createScope } = await import('../../hyper-undo/src/scope.js'))
  } catch {
    return // sibling package unavailable in this checkout; covered by browser tests
  }
  const dom = setWindow(undefined)
  const scope = createScope({ scope: dom.window.document.body })
  scope.start()
  dom.window.hyperclay = { undo: scope }

  const parent = dom.window.document.body
  const before = parent.children.length

  const r = commitWithUndo('Add items', () => {
    const d = dom.window.document.createElement('div')
    d.textContent = 'hello'
    parent.appendChild(d)
    return { ok: true }
  })

  assert.deepEqual(r, { ok: true })
  assert.equal(parent.children.length, before + 1, 'node added')
  assert.equal(scope.canUndo, true, 'one commit recorded')

  scope.undo()
  assert.equal(parent.children.length, before, 'undo removed the node')

  scope.redo()
  assert.equal(parent.children.length, before + 1, 'redo re-added the node')

  scope.stop()
})

test('end-to-end: a failed apply (!ok) records no undo commit', async () => {
  let createScope
  try {
    ({ createScope } = await import('../../hyper-undo/src/scope.js'))
  } catch {
    return
  }
  const dom = setWindow(undefined)
  const scope = createScope({ scope: dom.window.document.body })
  scope.start()
  dom.window.hyperclay = { undo: scope }

  commitWithUndo('Add items', () => {
    const d = dom.window.document.createElement('div')
    dom.window.document.body.appendChild(d)
    return { ok: false }
  })

  assert.equal(scope.canUndo, false, 'failed apply leaves the undo stack empty')
  scope.stop()
})
