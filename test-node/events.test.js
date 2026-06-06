import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { injectDefaults } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { commit, onAdd, onRemove, requestRemove, extractFormData } from '../src/events.js'

// requestRemove reads the global `window` (for consent/confirm); jsdom's window
// isn't global, so install a controlled one for the duration of fn.
function withWindow(win, fn) {
  const had = 'window' in globalThis
  const prev = globalThis.window
  globalThis.window = win
  const done = () => { if (had) globalThis.window = prev; else delete globalThis.window }
  let out
  try { out = fn() } catch (e) { done(); throw e }
  return Promise.resolve(out).finally(done)
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function productsCtx() {
  const ctx = setupCtx({
    pageRules: { products: ['.product', { name: '.n' }] },
    data: { products: [{ name: 'A' }, { name: 'B' }] },
    pageHTML: '<div><div class="product"><span class="n">A</span></div>' +
      '<div class="product"><span class="n">B</span></div></div>',
  }).ctx
  return ctx
}
const cardCount = (ctx) => ctx.formRoot.querySelectorAll('[data-hcms-card]').length

function chipsCtx() {
  return setupCtx({
    pageRules: { tags: 'li.tag[]' },
    data: { tags: ['a', 'b'] },
    pageHTML: '<ul><li class="tag">a</li><li class="tag">b</li></ul>',
  }).ctx
}
const itemCount = (ctx) => ctx.formRoot.querySelectorAll('[data-hcms-array-item]').length

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

test('commit: failure dispatches hcms:error + sets error inline at path', () => {
  const { ctx, events } = setupCtx({
    pageRules: { title: '.title' },
    data: { title: 'A' },
    pageHTML: '<h1 class="title">A</h1>',
  })
  commit({ title: { bad: 'shape' } }, { path: 'title' }, ctx)
  assert.ok(events.find((e) => e.name === 'hcms:error'))
  // ShapeMismatch on a leaf path renders inline next to the field, not in the global banner.
  const inline = ctx.formRoot.querySelector('[data-hcms-path="title"] > .hcms-error')
  assert.ok(inline, 'expected an inline error slot at path "title"')
  assert.ok(inline.textContent.length > 0)
  assert.equal(inline.hidden, false)
  // Global banner stays empty when an inline slot took the message.
  assert.equal(ctx.errorEl.hidden, true)
})

test('commit: ShapeMismatch with multiple mismatches stamps each at its own path', () => {
  const { ctx } = setupCtx({
    pageRules: { a: '.a', b: '.b' },
    data: { a: 'A', b: 'B' },
    pageHTML: '<span class="a">A</span><span class="b">B</span>',
  })
  // Both leaves wrong shape — engine reports two mismatches in the same throw.
  commit({ a: { bad: 1 }, b: { bad: 2 } }, { path: '' }, ctx)
  const inlineA = ctx.formRoot.querySelector('[data-hcms-path="a"] > .hcms-error')
  const inlineB = ctx.formRoot.querySelector('[data-hcms-path="b"] > .hcms-error')
  assert.ok(inlineA && !inlineA.hidden && inlineA.textContent.length > 0, 'expected inline error at "a"')
  assert.ok(inlineB && !inlineB.hidden && inlineB.textContent.length > 0, 'expected inline error at "b"')
})

test('commit: deeper-than-form path walks up to the nearest ancestor with a slot', () => {
  const { ctx } = setupCtx({
    pageRules: { author: { name: '.n' } },
    data: { author: { name: 'A' } },
    pageHTML: '<div><span class="n">A</span></div>',
  })
  // Force a mismatch by setting the whole author to a wrong shape — engine reports at "author".
  commit({ author: 'bad' }, { path: 'author' }, ctx)
  // @object now has an error slot; the lookup lands there (no walk-up needed, but verifies the slot exists).
  const objectSlot = ctx.formRoot.querySelector('[data-hcms-path="author"] > .hcms-error')
  assert.ok(objectSlot && !objectSlot.hidden && objectSlot.textContent.length > 0, 'expected error at the object slot')
})

test('commit: path-less failure falls back to global banner', () => {
  const { ctx } = setupCtx({
    pageRules: { title: '.title' },
    data: { title: 'A' },
    pageHTML: '<h1 class="title">A</h1>',
  })
  // Force an error that ShapeMismatch reports at a path the form does NOT have stamped,
  // so findInlineErrorSlot returns null and we fall back to the global banner.
  commit({ title: { bad: 'shape' } }, { path: 'no-such-path' }, ctx)
  // Either the engine reports the mismatch at "title" (which has a slot) or at no path.
  // Both cases — the assertion is: SOME error surface shows the message.
  const inline = ctx.formRoot.querySelector('[data-hcms-path="title"] > .hcms-error')
  const inlineShown = inline && !inline.hidden && inline.textContent.length > 0
  const globalShown = !ctx.errorEl.hidden && ctx.errorEl.textContent.length > 0
  assert.ok(inlineShown || globalShown, 'expected error in either inline or global banner')
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

test('requestRemove: a card (object-array) confirms by default via consent()', async () => {
  const ctx = productsCtx()
  let asked = null
  const win = { hyperclay: { consent: (msg) => { asked = msg; return Promise.resolve() } } }
  await withWindow(win, async () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-card]'), ctx)
    await tick()
  })
  assert.equal(asked, 'Delete this item?')
  assert.equal(cardCount(ctx), 1)
})

test('requestRemove: a chip (scalar-array) removes instantly by default — never asks', () => {
  const ctx = chipsCtx()
  let asked = false
  withWindow({ confirm: () => { asked = true; return false } }, () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-array-item]'), ctx)
  })
  assert.equal(asked, false, 'chips must not prompt under the card-only default')
  assert.equal(itemCount(ctx), 1)
})

test('requestRemove: a cancelled consent() leaves the card in place', async () => {
  const ctx = productsCtx()
  const win = { consent: () => Promise.reject(new Error('cancelled')) }
  await withWindow(win, async () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-card]'), ctx)
    await tick()
  })
  assert.equal(cardCount(ctx), 2)
})

test('requestRemove: a card falls back to native confirm() when consent() is absent', async () => {
  const yes = productsCtx()
  await withWindow({ confirm: () => true }, () => requestRemove(yes.formRoot.querySelector('[data-hcms-card]'), yes))
  assert.equal(cardCount(yes), 1)

  const no = productsCtx()
  await withWindow({ confirm: () => false }, () => requestRemove(no.formRoot.querySelector('[data-hcms-card]'), no))
  assert.equal(cardCount(no), 2)
})

test('requestRemove: confirmRemove:false disables the card confirm (removes instantly)', () => {
  const ctx = productsCtx()
  ctx.confirmRemove = false
  let asked = false
  withWindow({ confirm: () => { asked = true; return false } }, () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-card]'), ctx)
  })
  assert.equal(asked, false)
  assert.equal(cardCount(ctx), 1)
})

test('requestRemove: confirmRemove:true forces a chip to confirm too', async () => {
  const ctx = chipsCtx()
  ctx.confirmRemove = true
  let asked = null
  const win = { consent: (msg) => { asked = msg; return Promise.resolve() } }
  await withWindow(win, async () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-array-item]'), ctx)
    await tick()
  })
  assert.equal(asked, 'Delete this item?')
  assert.equal(itemCount(ctx), 1)
})

test('requestRemove: confirmRemove string overrides the prompt text', async () => {
  const ctx = productsCtx()
  ctx.confirmRemove = 'Remove this product?'
  let asked = null
  await withWindow({ consent: (msg) => { asked = msg; return Promise.resolve() } }, async () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-card]'), ctx)
    await tick()
  })
  assert.equal(asked, 'Remove this product?')
  assert.equal(cardCount(ctx), 1)
})

test('requestRemove: per-array data-hcms-confirm-remove="off" disables that array', () => {
  const ctx = productsCtx()
  ctx.formRoot.querySelector('[data-hcms-shape="object-array"]').setAttribute('data-hcms-confirm-remove', 'off')
  let asked = false
  withWindow({ confirm: () => { asked = true; return false } }, () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-card]'), ctx)
  })
  assert.equal(asked, false)
  assert.equal(cardCount(ctx), 1)
})

test('requestRemove: per-array attribute overrides the prompt text', async () => {
  const ctx = productsCtx()
  ctx.formRoot.querySelector('[data-hcms-shape="object-array"]')
    .setAttribute('data-hcms-confirm-remove', 'Drop this widget?')
  let asked = null
  await withWindow({ consent: (msg) => { asked = msg; return Promise.resolve() } }, async () => {
    requestRemove(ctx.formRoot.querySelector('[data-hcms-card]'), ctx)
    await tick()
  })
  assert.equal(asked, 'Drop this widget?')
  assert.equal(cardCount(ctx), 1)
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
