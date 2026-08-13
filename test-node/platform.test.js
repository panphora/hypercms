import { test } from 'node:test'
import assert from 'node:assert/strict'
import { platform, onPlatformEvent, MUTATION_READY, LIVESYNC_APPLIED } from '../src/platform.js'

function withWindow(win, fn) {
  const had = 'window' in globalThis
  const prev = globalThis.window
  globalThis.window = win
  try {
    return fn()
  } finally {
    if (had) globalThis.window = prev
    else delete globalThis.window
  }
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0))

test('platform() finds Mutation under window.clay, under window.hyperclay, and returns null with neither', () => {
  const clayMutation = { onAnyChange() {} }
  withWindow({ clay: { Mutation: clayMutation } }, () => {
    assert.equal(platform('Mutation'), clayMutation)
  })

  const hyperclayMutation = { onAnyChange() {} }
  withWindow({ hyperclay: { Mutation: hyperclayMutation } }, () => {
    assert.equal(platform('Mutation'), hyperclayMutation)
  })

  withWindow({}, () => {
    assert.equal(platform('Mutation'), null)
  })
})

test("clayjs's renames resolve: clay.addDocumentTransform is onPrepareForSave, clay.confirm is consent", () => {
  const addDocumentTransform = () => {}
  const confirm = () => {}
  withWindow({ clay: { addDocumentTransform, confirm } }, () => {
    assert.equal(platform('onPrepareForSave'), addDocumentTransform, 'onPrepareForSave reads clay.addDocumentTransform')
    assert.equal(platform('consent'), confirm, 'consent reads clay.confirm')
  })
})

test('a clay namespace missing the capability falls through to hyperclay (the namespace-swap regression)', () => {
  const X = function RichClay() {}
  withWindow({ clay: { Mutation: {} }, hyperclay: { RichClay: X } }, () => {
    assert.equal(platform('RichClay'), X)
  })
})

test('platform() throws on a capability that is not in the table', () => {
  withWindow({}, () => {
    assert.throws(() => platform('nope'), /unknown platform capability "nope"/)
  })
})

test('onPlatformEvent delivers once when both spellings arrive back to back, and its unsubscribe removes every name', async () => {
  const target = new EventTarget()
  let calls = 0
  const off = onPlatformEvent(target, MUTATION_READY, () => { calls++ })

  for (const name of MUTATION_READY) target.dispatchEvent(new Event(name))
  assert.equal(calls, 1, 'the synchronous pair is one occurrence, not two')

  off()
  await macrotask()
  for (const name of MUTATION_READY) target.dispatchEvent(new Event(name))
  assert.equal(calls, 1, 'unsubscribe removed the listener under every spelling')
})

test('onPlatformEvent delivers again for a genuinely separate occurrence', async () => {
  const target = new EventTarget()
  let calls = 0
  const off = onPlatformEvent(target, LIVESYNC_APPLIED, () => { calls++ })

  for (const name of LIVESYNC_APPLIED) target.dispatchEvent(new Event(name))
  assert.equal(calls, 1)

  await macrotask()
  for (const name of LIVESYNC_APPLIED) target.dispatchEvent(new Event(name))
  assert.equal(calls, 2, 'the guard dedups one occurrence, it does not swallow a later one')

  off()
})

// The guard suppresses the OTHER spelling, never a repeat of the same one. Two
// dispatches of one name are always two occurrences, no matter how close together:
// no client spells a single occurrence twice the same way. livesync-resync.test.js
// depends on this — it fires two hyperclay:livesync-applied in one synchronous test
// body and expects two form refreshes.
test('the same spelling twice in one tick is two occurrences, not one', () => {
  const target = new EventTarget()
  let calls = 0
  const off = onPlatformEvent(target, LIVESYNC_APPLIED, () => { calls++ })

  const [clayName, legacyName] = LIVESYNC_APPLIED
  target.dispatchEvent(new Event(legacyName))
  target.dispatchEvent(new Event(legacyName))
  assert.equal(calls, 2, 'a repeat of the claiming name gets through in the same tick')

  target.dispatchEvent(new Event(clayName))
  assert.equal(calls, 2, 'the other spelling is still suppressed for that tick')

  off()
})
