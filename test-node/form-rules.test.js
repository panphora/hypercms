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
  // Selectors are tag-qualified (`input[...]@value`) so the wrapping container
  // (which also carries data-hcms-field="title") doesn't shadow the leaf input.
  eq(form, { title: 'input[data-hcms-field="title"]@value' })
})

test('deriveFormRules: object', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ author: { name: '.n', bio: '.b' } }, doc)
  eq(form, {
    author: {
      name: 'input[data-hcms-field="name"]@value',
      bio: 'input[data-hcms-field="bio"]@value',
    },
  })
})

test('deriveFormRules: object-array', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ products: ['.product', { name: '.n', price: '.p' }] }, doc)
  // Top-level array: scoped by data-hcms-path. Nested would use data-hcms-field.
  eq(form, {
    products: ['[data-hcms-path="products"] > .hcms-array-items > [data-hcms-card]', {
      name: 'input[data-hcms-field="name"]@value',
      price: 'input[data-hcms-field="price"]@value',
    }],
  })
})

test('deriveFormRules: object-array nested uses data-hcms-field key match', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({
    products: ['.p', { name: '.n', variants: ['.v', { label: '.l' }] }],
  }, doc)
  // Nested arrays scope by data-hcms-field (the rule key) — uniquely
  // distinguishes sibling branches sharing a terminal name.
  assert.equal(form.products[1].variants[0], '[data-hcms-field="variants"] > .hcms-array-items > [data-hcms-card]')
})

// v0.3 fix #3 (Critical): nested arrays that share a terminal key (e.g.
// products.*.primary.variants + products.*.secondary.variants) used to
// collide because the selector relied on path suffix. v0.3 stamps
// data-hcms-field on every keyed node so the selector can scope by the
// stable key — the parent `primary` vs `secondary` is itself disambiguated
// by data-hcms-field.
test('deriveFormRules: sibling nested arrays w/ same terminal key get distinct scopes', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({
    products: ['.p', {
      primary: { variants: ['.v', { label: '.l' }] },
      secondary: { variants: ['.v', { label: '.l' }] },
    }],
  }, doc)
  // Both sibling variants resolve to the same data-hcms-field="variants"
  // selector — disambiguation happens at runtime via the parent's
  // data-hcms-field="primary"/"secondary" scope.
  const primarySel = form.products[1].primary.variants[0]
  const secondarySel = form.products[1].secondary.variants[0]
  assert.equal(primarySel, '[data-hcms-field="variants"] > .hcms-array-items > [data-hcms-card]')
  assert.equal(secondarySel, '[data-hcms-field="variants"] > .hcms-array-items > [data-hcms-card]')
})

test('deriveFormRules: scalar-array emits [selector, @value] form', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ tags: 'li.tag[]' }, doc)
  assert.deepEqual(form.tags, ['[data-hcms-path="tags"] > .hcms-array-items > [data-hcms-array-item]', 'input[data-hcms-field]@value'])
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
  // `name` input has no explicit type → emits bare `input` selector. Only
  // inputs with an explicit type attr get tag-qualified by [type="…"].
  eq(form.products[1], {
    name: 'input[data-hcms-field="name"]@value',
    published: 'input[type="checkbox"][data-hcms-field="published"]@checked',
  })
})
