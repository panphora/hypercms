import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { injectDefaults } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'

function setupDoc(html = '<!DOCTYPE html><html><head></head><body></body></html>') {
  return new JSDOM(html).window.document
}

test('buildForm: scalar field with value', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const pageRules = { title: '.title' }
  const formRules = deriveFormRules(pageRules, doc)
  const fragment = buildForm({ pageRules, formRules, data: { title: 'Hello' }, doc })
  const fieldRow = fragment.querySelector('[data-hcms-path="title"]')
  assert.ok(fieldRow, 'field row stamped with path')
  const input = fieldRow.querySelector('input[data-hcms-field="title"]')
  assert.ok(input)
  assert.equal(input.value, 'Hello')
})

test('buildForm: object with two children', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const pageRules = { author: { name: '.n', bio: '.b' } }
  const formRules = deriveFormRules(pageRules, doc)
  const fragment = buildForm({ pageRules, formRules, data: { author: { name: 'Ada', bio: 'cs' } }, doc })
  const authorSection = fragment.querySelector('[data-hcms-path="author"]')
  assert.ok(authorSection)
  const fields = authorSection.querySelectorAll('.hcms-field')
  assert.equal(fields.length, 2)
  const nameInput = fragment.querySelector('[data-hcms-path="author.name"] input')
  assert.equal(nameInput.value, 'Ada')
})

test('buildForm: object-array with three items', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const pageRules = { products: ['.product', { name: '.n', price: '.p' }] }
  const formRules = deriveFormRules(pageRules, doc)
  const data = {
    products: [
      { name: 'A', price: '1' },
      { name: 'B', price: '2' },
      { name: 'C', price: '3' },
    ],
  }
  const fragment = buildForm({ pageRules, formRules, data, doc })
  const cards = fragment.querySelectorAll('[data-hcms-card]')
  assert.equal(cards.length, 3)
  assert.equal(cards[0].getAttribute('data-hcms-path'), 'products.0')
  assert.equal(cards[2].getAttribute('data-hcms-path'), 'products.2')
  const nameAt2 = fragment.querySelector('[data-hcms-path="products.2.name"] input')
  assert.equal(nameAt2.value, 'C')
})

test('buildForm: scalar-array', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const pageRules = { tags: 'li.tag[]' }
  const formRules = deriveFormRules(pageRules, doc)
  const fragment = buildForm({ pageRules, formRules, data: { tags: ['a', 'b'] }, doc })
  const items = fragment.querySelectorAll('[data-hcms-array-item]')
  assert.equal(items.length, 2)
  const inputs = fragment.querySelectorAll('[data-hcms-array-item] input')
  assert.equal(inputs[0].value, 'a')
  assert.equal(inputs[1].value, 'b')
})

test('buildForm: sortable attribute stamped on array container', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const pageRules = { products: ['.product', { name: '.n' }] }
  const formRules = deriveFormRules(pageRules, doc)
  const fragment = buildForm({ pageRules, formRules, data: { products: [] }, doc })
  const items = fragment.querySelector('.hcms-array-items')
  assert.ok(items.hasAttribute('sortable'))
  assert.ok(items.hasAttribute('onsorted'))
})

test('buildForm: no-reorder template skips sortable', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="products" data-hcms-no-reorder>
      <section class="hcms-array">
        <div class="hcms-array-items"></div>
        <button data-hcms-action="add">+</button>
      </section>
    </template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const pageRules = { products: ['.product', { name: '.n' }] }
  const formRules = deriveFormRules(pageRules, doc)
  const fragment = buildForm({ pageRules, formRules, data: { products: [] }, doc })
  const items = fragment.querySelector('.hcms-array-items')
  assert.equal(items.hasAttribute('sortable'), false)
})

test('buildForm: inline template for items', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="products.*">
      <div class="custom">
        <input data-hcms-field="name"/>
        <button data-hcms-action="remove">x</button>
      </div>
    </template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const pageRules = { products: ['.product', { name: '.n' }] }
  const formRules = deriveFormRules(pageRules, doc)
  const data = { products: [{ name: 'A' }, { name: 'B' }] }
  const fragment = buildForm({ pageRules, formRules, data, doc })
  const items = fragment.querySelectorAll('[data-hcms-card]')
  assert.equal(items.length, 2)
  assert.ok(items[0].classList.contains('custom'))
  assert.equal(items[0].querySelector('input').value, 'A')
})

// v0.3 fix #6 (Should-fix): radio templates have multiple inputs at the
// same field — populateScalarValue must hydrate all of them, not just the
// first. Previously only the first radio got `checked` set, so re-opening
// with the third option selected showed the first option highlighted.
test('buildForm: radio group hydrates the matching input across all options', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="color">
      <fieldset class="hcms-field" data-hcms-shape="scalar">
        <legend data-hcms-label></legend>
        <label><input type="radio" data-hcms-field="color" value="red"/>red</label>
        <label><input type="radio" data-hcms-field="color" value="green"/>green</label>
        <label><input type="radio" data-hcms-field="color" value="blue"/>blue</label>
      </fieldset>
    </template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const pageRules = { color: '.c@data-color' }
  const formRules = deriveFormRules(pageRules, doc)
  const fragment = buildForm({ pageRules, formRules, data: { color: 'blue' }, doc })
  const radios = fragment.querySelectorAll('input[type="radio"][data-hcms-field="color"]')
  assert.equal(radios.length, 3, 'all three radios rendered')
  const checked = Array.from(radios).filter((r) => r.checked).map((r) => r.value)
  assert.deepEqual(checked, ['blue'], 'only the matching option is checked')
})

test('buildForm: labels humanized from key', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const pageRules = { productName: '.n' }
  const formRules = deriveFormRules(pageRules, doc)
  const fragment = buildForm({ pageRules, formRules, data: { productName: 'x' }, doc })
  const fieldRow = fragment.querySelector('[data-hcms-path="productName"]')
  const label = fieldRow.querySelector('[data-hcms-label]')
  assert.equal(label.textContent, 'Product Name')
})
