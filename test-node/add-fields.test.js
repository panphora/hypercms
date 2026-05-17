import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// Pre-v0.2 `cloneAndStampItem` cloned the default `@object-array-item`
// template (which has no fields inside its `.hcms-card-fields` slot), so
// added cards were empty husks. v0.2's `buildItem` walks the itemShape and
// renders every field.
test('onAdd: new card has every field from item shape', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n", "price": ".p" }] }
    </script>
    <div><div class="product"><span class="n">a</span><span class="p">1</span></div></div>
  </body></html>`)
  open()
  try {
    api.addItem('products')
    const cards = document.querySelectorAll('[data-hcms-form-root] [data-hcms-card]')
    assert.equal(cards.length, 2, 'second card appended')
    const newCard = cards[1]
    // Query inputs only — since v0.3 stamps data-hcms-field on wrapping
    // containers too (option 1), a bare [data-hcms-field] would match the
    // container AND the input for each field.
    const fields = Array.from(newCard.querySelectorAll('input[data-hcms-field]')).map(
      (e) => e.getAttribute('data-hcms-field')
    )
    assert.deepEqual(fields.sort(), ['name', 'price'])
  } finally {
    close()
    dom.window.close()
  }
})

test('onAdd: scalar-array gets an item with a field input', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">{ "tags": "li[]" }</script>
    <ul><li>a</li></ul>
  </body></html>`)
  open()
  try {
    api.addItem('tags')
    const items = document.querySelectorAll('[data-hcms-form-root] [data-hcms-array-item]')
    assert.equal(items.length, 2)
    const field = items[1].querySelector('[data-hcms-field]')
    assert.ok(field, 'new scalar-array item contains a field')
  } finally {
    close()
    dom.window.close()
  }
})
