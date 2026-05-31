import { test } from 'node:test'
import assert from 'node:assert/strict'
import HyperMorph from 'hyper-morph'
import { morphForm } from '../src/morph.js'

// HyperMorph.morph is a non-writable inherited property, so spy by defining an
// own shadowing property and remove it (re-exposing the inherited method) after.
function spyMorph(calls) {
  Object.defineProperty(HyperMorph, 'morph', {
    value: (root, frag, o) => calls.push(o),
    configurable: true,
    writable: true,
  })
}
function restoreMorph() {
  delete HyperMorph.morph
}

test('morphForm defaults ignoreActiveValue true, honors false override, preserves other opts', () => {
  const calls = []
  spyMorph(calls)
  try {
    morphForm({}, {})
    morphForm({}, {}, { ignoreActiveValue: false })
  } finally {
    restoreMorph()
  }
  assert.equal(calls[0].ignoreActiveValue, true)
  assert.equal(calls[1].ignoreActiveValue, false)
  assert.equal(calls[0].formStateSync, 'property')
  assert.equal(calls[0].restoreFocus, true)
  assert.equal(calls[0].morphStyle, 'innerHTML')
})
