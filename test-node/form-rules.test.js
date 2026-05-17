import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { injectDefaults } from '../src/templates.js'
import { deriveFormRules, fieldPropertyFor } from '../src/form-rules.js'

function setupDoc(html = '<!DOCTYPE html><html><head></head><body></body></html>') {
  return new JSDOM(html).window.document
}

test('fieldPropertyFor: input text → value', () => {
  const doc = setupDoc()
  const el = doc.createElement('input')
  assert.equal(fieldPropertyFor(el), 'value')
})

test('fieldPropertyFor: input checkbox → checked', () => {
  const doc = setupDoc()
  const el = doc.createElement('input')
  el.setAttribute('type', 'checkbox')
  assert.equal(fieldPropertyFor(el), 'checked')
})

test('fieldPropertyFor: textarea → value', () => {
  const doc = setupDoc()
  const el = doc.createElement('textarea')
  assert.equal(fieldPropertyFor(el), 'value')
})

test('fieldPropertyFor: img → src', () => {
  const doc = setupDoc()
  const el = doc.createElement('img')
  assert.equal(fieldPropertyFor(el), 'src')
})

test('fieldPropertyFor: a → href', () => {
  const doc = setupDoc()
  const el = doc.createElement('a')
  assert.equal(fieldPropertyFor(el), 'href')
})

// form-rules emits null-prototype objects so `__proto__` and similar can't
// be smuggled in as rule keys. Compare via JSON to ignore the prototype.
function eq(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
}

test('deriveFormRules: scalar', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ title: '.title' }, doc)
  eq(form, { title: '[data-hcms-field="title"]@value' })
})

test('deriveFormRules: object', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ author: { name: '.n', bio: '.b' } }, doc)
  eq(form, {
    author: {
      name: '[data-hcms-field="name"]@value',
      bio: '[data-hcms-field="bio"]@value',
    },
  })
})

test('deriveFormRules: object-array', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ products: ['.product', { name: '.n', price: '.p' }] }, doc)
  // Top-level array: scoped to the products container's items slot.
  eq(form, {
    products: ['[data-hcms-path="products"] > .hcms-array-items > [data-hcms-card]', {
      name: '[data-hcms-field="name"]@value',
      price: '[data-hcms-field="price"]@value',
    }],
  })
})

test('deriveFormRules: object-array nested uses suffix path match', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({
    products: ['.p', { name: '.n', variants: ['.v', { label: '.l' }] }],
  }, doc)
  assert.equal(form.products[1].variants[0], '[data-hcms-path$=".variants"] > .hcms-array-items > [data-hcms-card]')
})

test('deriveFormRules: scalar-array emits [selector, @value] form', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ tags: 'li.tag[]' }, doc)
  assert.deepEqual(form.tags, ['[data-hcms-path="tags"] > .hcms-array-items > [data-hcms-array-item]', '[data-hcms-field]@value'])
})

test('deriveFormRules: inline template overrides default selector', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="products.*">
      <div class="my">
        <input data-hcms-field="name"/>
        <input type="checkbox" data-hcms-field="published"/>
      </div>
    </template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const form = deriveFormRules({ products: ['.product', { name: '.n', published: '.p@data-pub' }] }, doc)
  eq(form.products[1], {
    name: '[data-hcms-field="name"]@value',
    published: '[data-hcms-field="published"]@checked',
  })
})
