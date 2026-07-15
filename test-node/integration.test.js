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

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
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
    const titleInput = document.querySelector('[data-hcms-path="title"] textarea')
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
  assert.throws(() => open(), /no rules found for data-rules-name~="cms"/)
  dom.window.close()
})

test('integration: open({ rules: object }) uses the literal rules', () => {
  const dom = loadPage(
    '<!DOCTYPE html><html><head></head><body><h1 class="title">Hello</h1></body></html>',
  )
  open({ rules: { title: '.title' } })
  try {
    const titleInput = document.querySelector('[data-hcms-path="title"] textarea')
    assert.equal(titleInput.value, 'Hello')
  } finally {
    close()
  }
  dom.window.close()
})

test('integration: open({ rules: "token" }) throws when the token resolves nothing', () => {
  // A literal object always resolves, so only a token (or omitted) source can
  // fail to resolve. Assert a named token with no matching tag throws clearly.
  const dom = loadPage('<!DOCTYPE html><html><body><h1 class="title">Hi</h1></body></html>')
  assert.throws(() => open({ rules: 'nope' }), /no rules found for data-rules-name~="nope"/)
  dom.window.close()
})

test('integration: open({ rules: "token" }) resolves a named tag', () => {
  const dom = loadPage(
    '<!DOCTYPE html><html><head>' +
      '<script data-rules-name="custom" data-rules-version="1" type="application/json">{ "title": ".title" }</script>' +
      '</head><body><h1 class="title">Named</h1></body></html>',
  )
  open({ rules: 'custom' })
  try {
    const titleInput = document.querySelector('[data-hcms-path="title"] textarea')
    assert.equal(titleInput.value, 'Named')
  } finally {
    close()
  }
  dom.window.close()
})


test('integration: a bare scalar whose page element holds markup upgrades to a richtext contenteditable (default)', () => {
  const dom = loadPage(
    '<!DOCTYPE html><html><head></head><body><div class="body"><b>Hi</b> there</div></body></html>',
  )
  open({ rules: { body: '.body' } })
  try {
    const field = document.querySelector('[data-hcms-path="body"] [contenteditable][data-hcms-field="body"]')
    assert.ok(field, 'richtext contenteditable field rendered')
    assert.equal(field.innerHTML, '<b>Hi</b> there', 'markup round-trips through @innerHTML')
  } finally {
    close()
  }
  dom.window.close()
})

test('integration: richText:false keeps a markup scalar as a plain textarea', () => {
  const dom = loadPage(
    '<!DOCTYPE html><html><head></head><body><div class="body"><b>Hi</b> there</div></body></html>',
  )
  open({ rules: { body: '.body' }, richText: false })
  try {
    const field = document.querySelector('[data-hcms-path="body"] textarea[data-hcms-field="body"]')
    assert.ok(field, 'plain textarea rendered when the upgrade is opted out')
    assert.equal(field.value, 'Hi there', 'text is flattened for the plain-text control')
  } finally {
    close()
  }
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
