import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { cms, open, close, isOpen, api } from '../src/hypercms.js'

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
}

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
  <script id="hyper-html-api" data-rules-version="1" type="application/json">
  {
    "title": ".title",
    "author": { "name": ".author-name" },
    "products": [".product", { "name": ".product-name", "price": ".product-price" }],
    "tags": "li.tag[]"
  }
  </script>
  <h1 class="title">Hello</h1>
  <section><span class="author-name">Ada</span></section>
  <div>
    <div class="product"><span class="product-name">P1</span><span class="product-price">10</span></div>
    <div class="product"><span class="product-name">P2</span><span class="product-price">20</span></div>
  </div>
  <ul>
    <li class="tag">a</li>
    <li class="tag">b</li>
  </ul>
</body></html>`

test('integration: open mounts shell, dispatches hcms:open', () => {
  const dom = loadPage(FIXTURE)
  const fired = []
  document.body.addEventListener('hcms:open', (e) => fired.push(e))
  open()
  try {
    assert.equal(isOpen(), true)
    assert.equal(fired.length, 1)
    assert.ok(document.querySelector('[data-hcms-shell]'))
    assert.ok(document.querySelector('[data-hcms-form-root]'))
  } finally {
    close()
  }
  dom.window.close()
})

test('integration: form reflects page data', () => {
  const dom = loadPage(FIXTURE)
  open()
  try {
    const titleInput = document.querySelector('[data-hcms-path="title"] input')
    assert.equal(titleInput.value, 'Hello')
    const products = document.querySelectorAll('[data-hcms-card]')
    assert.equal(products.length, 2)
  } finally {
    close()
  }
  dom.window.close()
})

test('integration: api.setValue writes through to page', () => {
  const dom = loadPage(FIXTURE)
  open()
  try {
    api.setValue('title', 'NewTitle')
    assert.equal(document.querySelector('.title').textContent, 'NewTitle')
    const data = api.getData()
    assert.equal(data.title, 'NewTitle')
  } finally {
    close()
  }
  dom.window.close()
})

test('integration: api.addItem appends a product to page', () => {
  const dom = loadPage(FIXTURE)
  open()
  try {
    api.addItem('products')
    const products = document.querySelectorAll('.product')
    assert.equal(products.length, 3)
  } finally {
    close()
  }
  dom.window.close()
})

test('integration: close removes shell + body classes', () => {
  const dom = loadPage(FIXTURE)
  open()
  close()
  assert.equal(isOpen(), false)
  assert.equal(document.querySelector('[data-hcms-shell]'), null)
  assert.equal(document.body.classList.contains('hcms-open'), false)
  dom.window.close()
})

test('integration: open throws if no rules tag', () => {
  const dom = loadPage('<!DOCTYPE html><html><body></body></html>')
  assert.throws(() => open(), /no rules tag/)
  dom.window.close()
})

test('integration: open warns on double-open', () => {
  const dom = loadPage(FIXTURE)
  const orig = console.warn
  let warned = false
  console.warn = (msg) => { if (/already open/.test(msg)) warned = true }
  open()
  open()
  console.warn = orig
  assert.equal(warned, true)
  close()
  dom.window.close()
})
