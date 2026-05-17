import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { humanize, injectDefaults, findTemplate, buildTemplateMap, isInlineTemplate } from '../src/templates.js'

function setupDoc(html = '<!DOCTYPE html><html><head></head><body></body></html>') {
  return new JSDOM(html).window.document
}

test('humanize: camelCase', () => {
  assert.equal(humanize('productName'), 'Product Name')
})

test('humanize: snake_case', () => {
  assert.equal(humanize('user_email'), 'User email')
})

test('humanize: kebab-case', () => {
  assert.equal(humanize('is-active'), 'Is active')
})

test('humanize: consecutive caps (productID)', () => {
  assert.equal(humanize('productID'), 'Product ID')
})

test('humanize: abbreviations (myAPIKey)', () => {
  assert.equal(humanize('myAPIKey'), 'My API Key')
})

test('humanize: all caps (URL)', () => {
  assert.equal(humanize('URL'), 'URL')
})

test('injectDefaults: adds six templates to head', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const tpls = doc.querySelectorAll('template[data-hcms-tpl]')
  assert.equal(tpls.length, 6)
  for (const key of ['@scalar', '@object', '@scalar-array', '@scalar-array-item', '@object-array', '@object-array-item']) {
    assert.ok(findTemplate(doc, key), `missing default template ${key}`)
  }
})

test('injectDefaults: idempotent', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  injectDefaults(doc)
  assert.equal(doc.querySelectorAll('template[data-hcms-tpl]').length, 6)
})

test('findTemplate: returns path-bound match', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="products.*"><div class="my"></div></template>
  </head><body></body></html>`)
  const tpl = findTemplate(doc, 'products.*')
  assert.ok(tpl)
  assert.equal(tpl.content.querySelector('.my').tagName, 'DIV')
})

test('buildTemplateMap: scalar path uses @scalar default', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const map = buildTemplateMap({ title: '.title' }, doc)
  const tpl = map.get('title')
  assert.ok(tpl)
  assert.equal(tpl.getAttribute('data-hcms-tpl'), '@scalar')
})

test('buildTemplateMap: object-array uses @object-array + per-item template', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  const map = buildTemplateMap({ products: ['.product', { name: '.n', price: '.p' }] }, doc)
  assert.equal(map.get('products').getAttribute('data-hcms-tpl'), '@object-array')
  assert.equal(map.get('products.*').getAttribute('data-hcms-tpl'), '@object-array-item')
  assert.equal(map.get('products.*.name').getAttribute('data-hcms-tpl'), '@scalar')
})

test('buildTemplateMap: path-bound override beats shape default', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="products.*"><div class="custom"><input data-hcms-field="name"/></div></template>
  </head><body></body></html>`)
  injectDefaults(doc)
  const map = buildTemplateMap({ products: ['.product', { name: '.n' }] }, doc)
  const tpl = map.get('products.*')
  assert.equal(tpl.getAttribute('data-hcms-tpl'), 'products.*')
})

test('isInlineTemplate: detects field elements', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template id="a"><div><input data-hcms-field="x"/></div></template>
    <template id="b"><div class="hcms-card-fields"></div></template>
  </head><body></body></html>`)
  assert.equal(isInlineTemplate(doc.getElementById('a')), true)
  assert.equal(isInlineTemplate(doc.getElementById('b')), false)
})
