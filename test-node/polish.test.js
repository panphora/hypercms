import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { open, close, api, isOpen } from '../src/hypercms.js'

function loadPage(html) {
  const dom = new JSDOM(html, { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  for (const k of Object.getOwnPropertyNames(dom.window)) {
    if (k in globalThis) continue
    const v = dom.window[k]
    if (typeof v === 'function' || (v && typeof v === 'object')) {
      try { globalThis[k] = v } catch {}
    }
  }
  installMutationStub(dom.window)
  return dom
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

test('addItem on empty list shows seed-item error message', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div id="list"></div>
  </body></html>`)
  open()
  try {
    let lastError = null
    document.body.addEventListener('hcms:error', (e) => { lastError = e.detail.error })
    api.addItem('products')
    assert.ok(lastError, 'error dispatched')
    assert.equal(lastError.name, 'EmptyListInsert')
  } finally {
    close()
  }
  dom.window.close()
})

test('addItem on non-array path throws', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "title": ".title" }
    </script>
    <h1 class="title">x</h1>
  </body></html>`)
  open()
  try {
    assert.throws(() => api.addItem('title'), /not an array|missing/)
  } finally {
    close()
  }
  dom.window.close()
})

test('setValue with unknown path throws', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "title": ".title" }
    </script>
    <h1 class="title">x</h1>
  </body></html>`)
  open()
  try {
    assert.throws(() => api.setValue('nope', 'y'), /no rule at path|no element at path|setValue requires a leaf/)
  } finally {
    close()
  }
  dom.window.close()
})

test('removeItem with unknown path throws', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div><div class="product"><span class="n">A</span></div></div>
  </body></html>`)
  open()
  try {
    assert.throws(() => api.removeItem('products.99'), /no element at path/)
  } finally {
    close()
  }
  dom.window.close()
})
