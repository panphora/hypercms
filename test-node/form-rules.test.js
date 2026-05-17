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

test('deriveFormRules: scalar', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ title: '.title' }, doc)
  assert.deepEqual(form, { title: '[data-hcms-field="title"]@value' })
})

test('deriveFormRules: object', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ author: { name: '.n', bio: '.b' } }, doc)
  assert.deepEqual(form, {
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
  assert.deepEqual(form, {
    products: ['[data-hcms-card]', {
      name: '[data-hcms-field="name"]@value',
      price: '[data-hcms-field="price"]@value',
    }],
  })
})

test('deriveFormRules: scalar-array emits [selector, @value] form', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ tags: 'li.tag[]' }, doc)
  assert.deepEqual(form.tags, ['[data-hcms-array-item]', '[data-hcms-field]@value'])
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
  assert.deepEqual(form.products[1], {
    name: '[data-hcms-field="name"]@value',
    published: '[data-hcms-field="published"]@checked',
  })
})
