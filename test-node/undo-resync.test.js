import { test } from 'node:test'
import assert from 'node:assert/strict'
import HyperMorph from 'hyper-morph'
import { loadPage } from './_helpers.js'
import { open, close } from '../src/hypercms.js'

// A fake undo singleton exposing the full surface hypercms touches (on/off for
// the new focused-field re-sync subscription, plus the pause/discard helpers
// suppressUndo/commitWithUndo call during open). emit() drives the listeners so
// we can assert the corrective refresh fires with ignoreActiveValue:false.
function installFakeUndo(win) {
  const listeners = new Map()
  const fake = {
    on(name, fn) {
      let s = listeners.get(name)
      if (!s) { s = new Set(); listeners.set(name, s) }
      s.add(fn)
      return () => fake.off(name, fn)
    },
    off(name, fn) {
      const s = listeners.get(name)
      if (s) s.delete(fn)
    },
    emit(name) {
      const s = listeners.get(name)
      if (s) for (const fn of Array.from(s)) fn()
    },
    _count(name) {
      const s = listeners.get(name)
      return s ? s.size : 0
    },
    pause() {},
    resume() {},
    commitCaptured() {},
    discardCaptured() {},
    commit(_label, fn) { return fn && fn() },
    get canUndo() { return false },
    get canRedo() { return false },
  }
  win.hyperclay = win.hyperclay || {}
  win.hyperclay.undo = fake
  return fake
}

const FIXTURE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello</h1>
</body></html>`

test('open() subscribes to undo/redo; an emitted undo refreshes with ignoreActiveValue:false; close() unsubscribes', () => {
  const dom = loadPage(FIXTURE)
  const fake = installFakeUndo(dom.window)
  const calls = []
  // HyperMorph.morph is a non-writable inherited property; shadow it with an own
  // property to spy, then delete to re-expose the inherited method afterward.
  Object.defineProperty(HyperMorph, 'morph', {
    value: (root, frag, o) => calls.push(o),
    configurable: true,
    writable: true,
  })
  try {
    open()
    assert.equal(fake._count('undo'), 1, 'subscribed to undo on open')
    assert.equal(fake._count('redo'), 1, 'subscribed to redo on open')

    fake.emit('undo')
    assert.equal(calls.length, 1, 'undo event triggers one form refresh')
    assert.equal(calls[0].ignoreActiveValue, false, 'undo refresh overrides the focused field')

    fake.emit('redo')
    assert.equal(calls.length, 2, 'redo event triggers a form refresh too')
    assert.equal(calls[1].ignoreActiveValue, false, 'redo refresh overrides the focused field')
  } finally {
    close()
    delete HyperMorph.morph
  }
  assert.equal(fake._count('undo'), 0, 'unsubscribed from undo on close')
  assert.equal(fake._count('redo'), 0, 'unsubscribed from redo on close')
  dom.window.close()
})

test('without window.hyperclay.undo, open()/close() do not throw (degrades to today)', () => {
  const dom = loadPage(FIXTURE)
  // No undo installed: the guard in open() must skip the subscription cleanly.
  let threw = null
  try {
    open()
    close()
  } catch (e) {
    threw = e
  }
  assert.equal(threw, null)
  dom.window.close()
})
