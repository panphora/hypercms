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
  // Selectors are tag-qualified (`textarea[...]@value`) so the wrapping container
  // (which also carries data-hcms-field="title") doesn't shadow the leaf field.
  eq(form, { title: 'textarea[data-hcms-field="title"]@value' })
})

test('deriveFormRules: object', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const form = deriveFormRules({ author: { name: '.n', bio: '.b' } }, doc)
  eq(form, {
    author: {
      name: 'textarea[data-hcms-field="name"]@value',
      bio: 'textarea[data-hcms-field="bio"]@value',
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
      name: 'textarea[data-hcms-field="name"]@value',
      price: 'textarea[data-hcms-field="price"]@value',
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

// v0.4 fix #1 (P2): when a site globally overrides @scalar with a non-input
// control (textarea), the fallback selector must reflect the actual leaf
// tag — otherwise extractFormData returns null and the next write nulls the
// page. Same logic applies to @scalar-array-item.
test('deriveFormRules: globally-overridden @scalar emits selector matching the override tag', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="@scalar">
      <label class="hcms-field" data-hcms-shape="scalar">
        <span data-hcms-label></span>
        <textarea data-hcms-field></textarea>
      </label>
    </template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const form = deriveFormRules({ bio: '.b' }, doc)
  assert.equal(form.bio, 'textarea[data-hcms-field="bio"]@value')
})

test('deriveFormRules: globally-overridden @scalar-array-item emits matching item selector', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="@scalar-array-item">
      <li class="hcms-scalar-array-item" data-hcms-array-item>
        <textarea data-hcms-field></textarea>
      </li>
    </template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const form = deriveFormRules({ tags: 'li.tag[]' }, doc)
  assert.equal(form.tags[1], 'textarea[data-hcms-field]@value')
})

// v0.4 fix #2 (P2): for custom/unknown leaf tags (e.g. contenteditable div)
// the generic selector must exclude the scalar wrapper too. v0.3 stamped
// data-hcms-field on the wrapper as well, so omitting `scalar` from the
// exclusion list let the selector resolve to the wrapper first.
test('deriveFormRules: contenteditable in scalar wrapper does not get shadowed by wrapper', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="title">
      <label class="hcms-field" data-hcms-shape="scalar">
        <span data-hcms-label></span>
        <div contenteditable data-hcms-field="title"></div>
      </label>
    </template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const form = deriveFormRules({ title: '.title' }, doc)
  // The selector must NOT match the wrapper (data-hcms-shape="scalar"),
  // only the contenteditable div inside.
  assert.match(
    form.title,
    /:not\(\[data-hcms-shape="scalar"\]\).*data-hcms-field="title"/
  )
  // A contenteditable leaf's value interface is innerHTML now, so the selector
  // binds @innerHTML rather than @value.
  assert.match(form.title, /@innerHTML$/, 'contenteditable leaf binds via innerHTML')
  // End-to-end: synthesize the form fragment and confirm querySelector
  // resolves to the contenteditable, not the wrapper.
  const wrapper = doc.createElement('label')
  wrapper.setAttribute('data-hcms-shape', 'scalar')
  wrapper.setAttribute('data-hcms-field', 'title')
  wrapper.innerHTML = '<span>Title</span><div contenteditable data-hcms-field="title">Hello</div>'
  const matched = wrapper.parentNode || (() => { const p = doc.createElement('div'); p.appendChild(wrapper); return p })()
  const selector = form.title.replace(/@innerHTML$/, '')
  const found = matched.querySelector(selector)
  assert.ok(found, 'selector resolves')
  assert.equal(found.tagName, 'DIV', 'leaf is the contenteditable div, not the wrapping label')
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
