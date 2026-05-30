import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

test('max-items hides add button at the limit and blocks api.addItem', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="@object-array" data-hcms-max-items="2">
      <section class="hcms-array hcms-object-array" data-hcms-shape="object-array">
        <header class="hcms-array-header"><h3 data-hcms-label></h3></header>
        <div class="hcms-array-items"></div>
        <button type="button" class="hcms-add" data-hcms-action="add">+ Add</button>
      </section>
    </template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div>
      <div class="product"><span class="n">A</span></div>
      <div class="product"><span class="n">B</span></div>
    </div>
  </body></html>`)
  open()
  try {
    const addBtn = document.querySelector('[data-hcms-form-root] [data-hcms-action="add"]')
    assert.equal(addBtn.hidden, true, 'add button hidden at max')
    api.addItem('products')
    const cards = document.querySelectorAll('[data-hcms-form-root] [data-hcms-card]')
    assert.equal(cards.length, 2, 'addItem call is a no-op at max')
  } finally {
    close()
    dom.window.close()
  }
})

test('min-items hides remove buttons at the floor and blocks api.removeItem', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="@object-array" data-hcms-min-items="2">
      <section class="hcms-array hcms-object-array" data-hcms-shape="object-array">
        <header class="hcms-array-header"><h3 data-hcms-label></h3></header>
        <div class="hcms-array-items"></div>
        <button type="button" class="hcms-add" data-hcms-action="add">+ Add</button>
      </section>
    </template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div>
      <div class="product"><span class="n">A</span></div>
      <div class="product"><span class="n">B</span></div>
    </div>
  </body></html>`)
  open()
  try {
    const removeBtns = document.querySelectorAll('[data-hcms-form-root] [data-hcms-action="remove"]')
    assert.equal(removeBtns.length, 2, 'two remove buttons')
    removeBtns.forEach((b) => assert.equal(b.hidden, true, 'remove hidden at min'))
    api.removeItem('products.0')
    const cards = document.querySelectorAll('[data-hcms-form-root] [data-hcms-card]')
    assert.equal(cards.length, 2, 'removeItem call is a no-op at min')
  } finally {
    close()
    dom.window.close()
  }
})

test('no-add / no-remove hide their respective buttons', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="@object-array" data-hcms-no-add data-hcms-no-remove>
      <section class="hcms-array hcms-object-array" data-hcms-shape="object-array">
        <header class="hcms-array-header"><h3 data-hcms-label></h3></header>
        <div class="hcms-array-items"></div>
        <button type="button" class="hcms-add" data-hcms-action="add">+ Add</button>
      </section>
    </template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div>
      <div class="product"><span class="n">A</span></div>
    </div>
  </body></html>`)
  open()
  try {
    const addBtn = document.querySelector('[data-hcms-form-root] [data-hcms-action="add"]')
    const removeBtns = document.querySelectorAll('[data-hcms-form-root] [data-hcms-action="remove"]')
    assert.equal(addBtn.hidden, true, 'add hidden')
    removeBtns.forEach((b) => assert.equal(b.hidden, true, 'remove hidden'))
  } finally {
    close()
    dom.window.close()
  }
})
