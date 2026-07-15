import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { injectDefaults } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'

function setupDoc() {
  return new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window.document
}

function build(pageRules, data) {
  const doc = setupDoc()
  injectDefaults(doc)
  const formRules = deriveFormRules(pageRules, doc)
  return buildForm({ pageRules, formRules, data, doc })
}

// The defaults must render real mirk components so the generated form is
// pixel-quiet out of the box — while keeping every data-hcms-* binding hook.

test('default scalar renders a .mirk-textarea bound to the field', () => {
  const f = build({ title: '.title' }, { title: 'Hi' })
  const field = f.querySelector('[data-hcms-path="title"]')
  const input = field.querySelector('textarea.mirk-textarea[data-hcms-field="title"]')
  assert.ok(input, 'mirk-textarea present and field-bound')
  assert.equal(input.value, 'Hi')
})

test('default scalar-array add button is a mirk-button; items use .mirk-input', () => {
  const f = build({ tags: 'li.tag[]' }, { tags: ['a', 'b'] })
  const add = f.querySelector('[data-hcms-action="add"]')
  assert.ok(add.classList.contains('mirk-button'), 'add is a mirk-button')
  assert.ok(add.querySelector('.mirk-button__label'), 'add has a mirk label')
  const items = f.querySelectorAll('[data-hcms-array-item]')
  assert.equal(items.length, 2)
  assert.ok(items[0].querySelector('input.mirk-input[data-hcms-field]'), 'item field is a mirk-input')
  assert.ok(items[0].querySelector('[data-hcms-action="remove"]'), 'item has a remove control')
})

test('default object-array item is a mirk-sortable card with a grip + body slot', () => {
  const f = build({ products: ['.product', { name: '.n', price: '.p' }] }, {
    products: [{ name: 'Widget', price: '9.99' }],
  })
  const card = f.querySelector('[data-hcms-card]')
  assert.ok(card.classList.contains('mirk-sortable__item'), 'card carries mirk-sortable__item')
  // the dotted grip handle
  assert.equal(card.querySelectorAll('.mirk-sortable__grip .mirk-sortable__dot').length, 8)
  // the body holds the engine's field slot + its child mirk-input fields
  const body = card.querySelector('.mirk-sortable__body')
  assert.ok(body.querySelector('.hcms-card-fields'), 'card-fields slot inside the sortable body')
  assert.ok(card.querySelector('[data-hcms-path="products.0.name"] textarea.mirk-textarea'), 'child field is a mirk-textarea')
  // remove + reorder controls still present
  assert.ok(card.querySelector('[data-hcms-action="move-up"]'))
  // remove is the corner button: a square-able .hcms-remove--card holding the SVG ×
  const remove = card.querySelector('[data-hcms-action="remove"]')
  assert.ok(remove, 'remove control present')
  assert.ok(remove.classList.contains('hcms-remove--card'), 'remove carries the corner-button modifier')
  assert.ok(remove.querySelector('svg.hcms-x'), 'remove holds the crisp-line × icon')
})

test('default add button still toggles via constraint visibility (data-hcms-action preserved)', () => {
  // max-items on a custom array template hides the (mirk) add button at the cap.
  const doc = new JSDOM(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="@object-array" data-hcms-max-items="1">
      <section class="hcms-array hcms-array--cards" data-hcms-shape="object-array">
        <div class="hcms-array-items"></div>
        <button type="button" class="hcms-add mirk-button" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
      </section>
    </template>
  </head><body></body></html>`).window.document
  injectDefaults(doc)
  const pageRules = { products: ['.product', { name: '.n' }] }
  const formRules = deriveFormRules(pageRules, doc)
  const f = buildForm({ pageRules, formRules, data: { products: [{ name: 'A' }] }, doc })
  const add = f.querySelector('[data-hcms-action="add"]')
  assert.equal(add.hidden, true, 'add hidden at max-items even as a mirk-button')
})
