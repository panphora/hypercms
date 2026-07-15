import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { open, close, refresh, isOpen, api } from '../src/hypercms.js'

function loadPage(html) {
  const dom = new JSDOM(html, { url: 'http://localhost/' })
  exposeJsdomGlobals(dom.window)
  return dom
}

function exposeJsdomGlobals(win) {
  globalThis.window = win
  globalThis.document = win.document
  for (const k of Object.getOwnPropertyNames(win)) {
    if (k in globalThis) continue
    const v = win[k]
    if (typeof v === 'function' || (v && typeof v === 'object')) {
      try { globalThis[k] = v } catch {}
    }
  }
  installMutationStub(win)
}

function installMutationStub(win) {
  const noop = () => () => {}
  win.hyperclay = win.hyperclay || {}
  win.hyperclay.Mutation = {
    onAnyChange: noop, onAddOrRemove: noop, onAddElement: noop,
    onRemoveElement: noop, onAttribute: noop,
    pause() {}, resume() {},
  }
}

const FIXTURE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello</h1>
</body></html>`

test('refresh: re-extracts page data and updates form', () => {
  const dom = loadPage(FIXTURE)
  open()
  try {
    document.querySelector('.title').textContent = 'External'
    refresh()
    const input = document.querySelector('[data-hcms-path="title"] textarea')
    assert.equal(input.value, 'External')
  } finally {
    close()
  }
  dom.window.close()
})

test('refresh: commit short-circuits when data unchanged (no echo loop)', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open()
  try {
    let changeCount = 0
    document.body.addEventListener('hcms:change', () => changeCount++)
    api.setValue('title', 'X')
    // Second call with same data: should be a skipped commit, no change event
    api.setValue('title', 'X')
    assert.equal(changeCount, 1)
  } finally {
    close()
  }
  dom.window.close()
})
