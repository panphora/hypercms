import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { injectDefaults } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { commit, onAdd, onRemove, extractFormData } from '../src/events.js'

function setupCtx({ pageRules, data, pageHTML }) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${pageHTML}</body></html>`)
  const doc = dom.window.document
  // Engine adapter checks instanceof CSS for cssEscape; jsdom exposes CSS.escape
  globalThis.CSS = dom.window.CSS
  injectDefaults(doc)
  const formRules = deriveFormRules(pageRules, doc)

  const formHost = doc.createElement('div')
  formHost.setAttribute('data-hcms-form-root', '')
  doc.body.appendChild(formHost)
  const fragment = buildForm({ pageRules, formRules, data, doc })
  formHost.appendChild(fragment)

  const errorEl = doc.createElement('div')
  errorEl.hidden = true

  const events = []
  const ctx = {
    doc,
    pageRoot: doc.body,
    pageRules,
    formRules,
    formRoot: formHost,
    errorEl,
    lastFingerprint: null,
    lastData: null,
    observerHandle: null,
    dispatch: (name, detail) => events.push({ name, detail }),
  }
  return { ctx, doc, events }
}

test('commit: success writes to page + sets lastFingerprint', () => {
  const { ctx, doc, events } = setupCtx({
    pageRules: { title: '.title' },
    data: { title: 'Old' },
    pageHTML: '<h1 class="title">Old</h1>',
  })
  const result = commit({ title: 'New' }, { path: 'title' }, ctx)
  assert.equal(result.ok, true)
  assert.equal(doc.body.querySelector('.title').textContent, 'New')
  assert.equal(events.find((e) => e.name === 'hcms:change').detail.data.title, 'New')
})

test('commit: idempotent on same data (lastFingerprint short-circuit)', () => {
  const { ctx } = setupCtx({
    pageRules: { title: '.title' },
    data: { title: 'A' },
    pageHTML: '<h1 class="title">A</h1>',
  })
  commit({ title: 'A' }, { path: 'title' }, ctx)
  const fp1 = ctx.lastFingerprint
  const result2 = commit({ title: 'A' }, { path: 'title' }, ctx)
  assert.equal(result2.skipped, true)
  assert.equal(ctx.lastFingerprint, fp1)
})

test('commit: failure dispatches hcms:error + sets error banner', () => {
  const { ctx, events } = setupCtx({
    pageRules: { title: '.title' },
    data: { title: 'A' },
    pageHTML: '<h1 class="title">A</h1>',
  })
  commit({ title: { bad: 'shape' } }, { path: 'title' }, ctx)
  assert.ok(events.find((e) => e.name === 'hcms:error'))
  assert.ok(ctx.errorEl.textContent.length > 0)
  assert.equal(ctx.errorEl.hidden, false)
})

test('onAdd: appends new card with next index', () => {
  const { ctx, doc } = setupCtx({
    pageRules: { products: ['.product', { name: '.n' }] },
    data: { products: [{ name: 'A' }] },
    pageHTML: '<div><div class="product"><span class="n">A</span></div></div>',
  })
  onAdd('products', ctx)
  const cards = ctx.formRoot.querySelectorAll('[data-hcms-card]')
  assert.equal(cards.length, 2)
  assert.equal(cards[1].getAttribute('data-hcms-path'), 'products.1')
})

test('onAdd: scalar-array appends item', () => {
  const { ctx } = setupCtx({
    pageRules: { tags: 'li.tag[]' },
    data: { tags: ['a'] },
    pageHTML: '<ul><li class="tag">a</li></ul>',
  })
  onAdd('tags', ctx)
  const items = ctx.formRoot.querySelectorAll('[data-hcms-array-item]')
  assert.equal(items.length, 2)
})

test('onRemove: removes the item and re-stamps sibling paths', () => {
  const { ctx } = setupCtx({
    pageRules: { products: ['.product', { name: '.n' }] },
    data: { products: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
    pageHTML: '<div>' +
      '<div class="product"><span class="n">A</span></div>' +
      '<div class="product"><span class="n">B</span></div>' +
      '<div class="product"><span class="n">C</span></div>' +
    '</div>',
  })
  const cards = ctx.formRoot.querySelectorAll('[data-hcms-card]')
  onRemove(cards[1], ctx)
  const after = ctx.formRoot.querySelectorAll('[data-hcms-card]')
  assert.equal(after.length, 2)
  assert.equal(after[0].getAttribute('data-hcms-path'), 'products.0')
  assert.equal(after[1].getAttribute('data-hcms-path'), 'products.1')
})

test('extractFormData: round-trips data through the form rules', () => {
  const { ctx } = setupCtx({
    pageRules: { title: '.title', tags: 'li.tag[]' },
    data: { title: 'Hello', tags: ['x', 'y'] },
    pageHTML: '<h1 class="title">Hello</h1><ul><li class="tag">x</li><li class="tag">y</li></ul>',
  })
  const data = extractFormData(ctx)
  assert.equal(data.title, 'Hello')
  assert.deepEqual(data.tags, ['x', 'y'])
})
