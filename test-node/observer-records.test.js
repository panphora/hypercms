import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installObserver } from '../src/refresh.js'

// installObserver reads the mutation hub off window, so the stub below is the
// whole platform for these tests. It captures the callback the hub was handed so
// the test can play the role of the hub and deliver a batch of changes.
function withHub(fn) {
  const captured = {}
  const hub = {
    onAnyChange(opts, callback) {
      captured.opts = opts
      captured.callback = callback
      return () => { captured.unsubscribed = true }
    },
  }
  const had = 'window' in globalThis
  const prev = globalThis.window
  globalThis.window = { hyperclay: { Mutation: hub } }
  try {
    return fn(captured)
  } finally {
    if (had) globalThis.window = prev
    else delete globalThis.window
  }
}

test('installObserver hands the hub\'s change records straight through to onRefresh', () => {
  withHub((captured) => {
    const seen = []
    installObserver({ onRefresh: (changes) => seen.push(changes) })
    const changes = [
      { type: 'attribute', element: {}, attribute: 'class', oldValue: 'a', newValue: 'b' },
      { type: 'add', element: {}, parent: {} },
    ]
    captured.callback(changes)
    assert.equal(seen.length, 1)
    assert.equal(seen[0], changes, 'the same array the hub collected, not a copy or a shape')
  })
})

test('installObserver forwards each batch and exposes only lifecycle cleanup', () => {
  withHub((captured) => {
    let calls = 0
    const handle = installObserver({ onRefresh: () => { calls++ } })

    captured.callback([])
    captured.callback([])
    assert.equal(calls, 2)
    assert.equal(handle.pause, undefined)
    assert.equal(handle.resume, undefined)
    handle.unsubscribe()
    assert.equal(captured.unsubscribed, true)
  })
})
