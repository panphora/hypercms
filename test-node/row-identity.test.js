import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'
import { applyWithRollback } from '../src/apply-loop.js'

// Two rows reading the same text are the same row as far as the data is
// concerned, so removing or reordering one of them is ambiguous to the engine's
// content matcher. The form is not ambiguous: it holds one element per row and
// mutates that element in place, so it can name the page node each item came
// from. commit() hands ctx.formRoot down for exactly that.

const RULES = '{ "title": ".title", "products": [".product", { "name": ".n" }] }'

function page(rows) {
  return loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    ${RULES}
    </script>
    <h1 class="title">T</h1>
    <div id="list">${rows}</div>
  </body></html>`)
}

function row(orig, name) {
  return `<div class="product" data-orig="${orig}"><span class="n">${name}</span></div>`
}

function pageOrder() {
  return Array.from(document.querySelectorAll('.product')).map((p) => p.getAttribute('data-orig'))
}

function pageNames() {
  return Array.from(document.querySelectorAll('.product .n')).map((el) => el.textContent)
}

function formSlot() {
  return document.querySelector('[data-hcms-form-root] .hcms-array-items')
}

function formCards() {
  return Array.from(formSlot().querySelectorAll(':scope > [data-hcms-card]'))
}

// open() seeds the pairing from the extract it builds the form from, so identity
// works from the first operation. These still commit once first, so the tests
// cover the post-apply path as well as the seeded one.
function primeRowIdentity() {
  api.setValue('title', 'primed')
}

test('row identity: removing the first of two identical rows keeps the second page node', () => {
  if (isOpen()) close()
  const dom = page(row(0, 'Same') + row(1, 'Same'))
  open()
  try {
    primeRowIdentity()
    api.removeItem('products.0')
    assert.deepEqual(pageOrder(), ['1'], 'the node the form kept is the node that survived')
    assert.deepEqual(pageNames(), ['Same'])
  } finally {
    close()
    dom.window.close()
  }
})

test('row identity: reordering across a duplicate moves the page nodes the form moved', () => {
  if (isOpen()) close()
  const dom = page(row(0, 'Same') + row(1, 'Same') + row(2, 'Other'))
  open()
  try {
    primeRowIdentity()
    const slot = formSlot()
    const cards = formCards()
    // Reversing the list.
    slot.appendChild(cards[1])
    slot.appendChild(cards[0])
    api._commit()
    assert.deepEqual(pageOrder(), ['2', '1', '0'])
    assert.deepEqual(pageNames(), ['Other', 'Same', 'Same'])
  } finally {
    close()
    dom.window.close()
  }
})

test('row identity: a plain edit keeps every page node', () => {
  if (isOpen()) close()
  const dom = page(row(0, 'Ann') + row(1, 'Bob') + row(2, 'Cal'))
  open()
  try {
    primeRowIdentity()
    const before = Array.from(document.querySelectorAll('.product'))
    api.setValue('products.1.name', 'Bo')
    const after = Array.from(document.querySelectorAll('.product'))
    assert.deepEqual(after.map((el) => before.indexOf(el)), [0, 1, 2])
    assert.deepEqual(pageNames(), ['Ann', 'Bo', 'Cal'])
  } finally {
    close()
    dom.window.close()
  }
})

test('row identity: adding a row builds exactly one node', () => {
  if (isOpen()) close()
  const dom = page(row(0, 'Ann') + row(1, 'Bob'))
  open()
  try {
    primeRowIdentity()
    const before = Array.from(document.querySelectorAll('.product'))
    api.addItem('products')
    const after = Array.from(document.querySelectorAll('.product'))
    assert.equal(after.length, 3)
    assert.deepEqual(after.map((el) => before.indexOf(el)), [0, 1, -1], 'both existing nodes kept')
  } finally {
    close()
    dom.window.close()
  }
})

// applyWithRollback is called without a form by refresh paths and by any host
// driving it directly, so the hooks have to be absent rather than empty there.
function bareList(rows) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="list">${rows}</div>
  </body></html>`)
  return dom.window.document.body
}

const BARE_RULES = { products: ['.product', { name: '.n' }] }

test('row identity: without formRoot an edit still keeps every node', () => {
  const root = bareList(row(0, 'Ann') + row(1, 'Bob') + row(2, 'Cal'))
  const before = Array.from(root.querySelectorAll('.product'))

  const result = applyWithRollback(root, BARE_RULES, {
    products: [{ name: 'Ann' }, { name: 'Bo' }, { name: 'Cal' }],
  })

  assert.equal(result.ok, true)
  const after = Array.from(root.querySelectorAll('.product'))
  assert.deepEqual(after.map((el) => before.indexOf(el)), [0, 1, 2])
})

test('row identity: without formRoot a remove still destroys exactly one node', () => {
  const root = bareList(row(0, 'Ann') + row(1, 'Bob') + row(2, 'Cal'))
  const before = Array.from(root.querySelectorAll('.product'))

  const result = applyWithRollback(
    root,
    BARE_RULES,
    { products: [{ name: 'Ann' }, { name: 'Cal' }] },
    { structural: true, structuralPath: 'products' },
  )

  assert.equal(result.ok, true)
  const after = Array.from(root.querySelectorAll('.product'))
  assert.deepEqual(after.map((el) => before.indexOf(el)), [0, 2])
})

test('row identity: without formRoot a duplicate row falls back to content matching', () => {
  const root = bareList(row(0, 'Same') + row(1, 'Same'))
  const before = Array.from(root.querySelectorAll('.product'))

  const result = applyWithRollback(
    root,
    BARE_RULES,
    { products: [{ name: 'Same' }] },
    { structural: true, structuralPath: 'products' },
  )

  assert.equal(result.ok, true)
  const after = Array.from(root.querySelectorAll('.product'))
  assert.equal(after.length, 1)
  // Which of the two it keeps is the matcher's call and not ours to fix here.
  // What must hold is that it kept one of them rather than building a clone.
  assert.ok(before.includes(after[0]), 'an existing node survived, nothing was cloned')
})

// The seeding path specifically: no commit has happened, so the WeakMap holds
// only what open() put there. Before open() seeded, this kept page node 0, the
// wrong one, because the content matcher cannot separate two identical rows.
test('row identity: works on the FIRST operation, with no prior commit', () => {
  if (isOpen()) close()
  const dom = page(row(0, 'Same') + row(1, 'Same'))
  open()
  try {
    api.removeItem('products.0')
    assert.deepEqual(pageOrder(), ['1'], 'the surviving node is the one the form kept')
  } finally {
    close()
    dom.window.close()
  }
})

// refreshForm rebuilds the form through hyper-morph when the page changes
// underneath the session, which can replace a form row and drop its binding.
// The refresh re-seeds from its own extract, so the next operation is not left
// guessing either.
test('row identity: survives a form refresh with no commit in between', () => {
  if (isOpen()) close()
  const dom = page(row(0, 'Same') + row(1, 'Same'))
  open()
  try {
    api.refresh()
    api.removeItem('products.0')
    assert.deepEqual(pageOrder(), ['1'], 'the refresh re-established the pairing')
  } finally {
    close()
    dom.window.close()
  }
})

// Nested lists are where the path key could silently mismatch: the form stamps
// data-hcms-path with pathArr.join('.'), so product 1's variants live under
// "products.1.variants". If that key did not line up with the engine's trace
// path, identifyRows would find no rows, return null, and quietly fall back to
// content matching without failing anything.
const NESTED_RULES =
  '{ "products": [".product", { "name": ".n", "variants": [".variant", { "sku": ".s" }] }] }'

function nestedPage(products) {
  return loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    ${NESTED_RULES}
    </script>
    <div id="list">${products}</div>
  </body></html>`)
}

function product(orig, name, variants) {
  return `<div class="product" data-orig="${orig}"><span class="n">${name}</span>${variants}</div>`
}

function variant(id, sku) {
  return `<div class="variant" data-v="${id}"><span class="s">${sku}</span></div>`
}

function variantIds(productIndex) {
  const p = document.querySelectorAll('.product')[productIndex]
  return Array.from(p.querySelectorAll('.variant')).map((el) => el.getAttribute('data-v'))
}

test('row identity: removing a duplicate variant from the SECOND product keeps the right node', () => {
  if (isOpen()) close()
  const dom = nestedPage(
    product('p0', 'Ann', variant('a0', 'Same') + variant('a1', 'Same')) +
      product('p1', 'Bob', variant('b0', 'Same') + variant('b1', 'Same')),
  )
  open()
  try {
    api.removeItem('products.1.variants.0')
    assert.deepEqual(variantIds(1), ['b1'], 'removed b0, kept b1')
    assert.deepEqual(variantIds(0), ['a0', 'a1'], 'the other product is untouched')
  } finally {
    close()
    dom.window.close()
  }
})

test('row identity: a nested list binds under its own indexed path, not a shared one', () => {
  if (isOpen()) close()
  const dom = nestedPage(
    product('p0', 'Ann', variant('a0', 'Same') + variant('a1', 'Same')) +
      product('p1', 'Bob', variant('b0', 'Same') + variant('b1', 'Same')),
  )
  open()
  try {
    // Removing the FIRST of two identical rows is the discriminating case: the
    // content matcher pairs the surviving item with old row 0 on position cost,
    // so it keeps a0 and is wrong. Only the form's binding knows a1 survived.
    // Both products hold byte-identical rows, so a shared binding key would let
    // the second product's bind overwrite the first's and land this on the
    // wrong nodes.
    api.removeItem('products.0.variants.0')
    assert.deepEqual(variantIds(0), ['a1'], 'removed a0, kept a1')
    assert.deepEqual(variantIds(1), ['b0', 'b1'], 'the other product is untouched')
  } finally {
    close()
    dom.window.close()
  }
})

// formRowsAt interpolates the path into an attribute selector, and a rule key
// holding a quote makes querySelector throw. That throw would land inside
// listDiff, so every commit on such a page would fail. Every other
// path-into-selector site in this package escapes; this checks that one does.
const QUOTE_RULES = '{ "say\\"hi": [".product", { "name": ".n" }] }'

test('row identity: a rule key containing a quote does not break the selector', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    ${QUOTE_RULES}
    </script>
    <div id="list">${row(0, 'Same') + row(1, 'Same')}</div>
  </body></html>`)
  open()
  try {
    api.removeItem('say"hi.0')
    assert.deepEqual(pageOrder(), ['1'], 'the surviving node is the one the form kept')
  } finally {
    close()
    dom.window.close()
  }
})

// The case the whole design exists for, and the one the fingerprint guard used
// to swallow. Two rows whose ruled fields read identically extract to the same
// JSON however they are ordered, so a swap produces no data change at all. Only
// the form knows the operation happened, and only supplied identity can express
// it. commit() now skips on an unchanged fingerprint for plain edits only.
test('row identity: swapping two identical rows moves the page nodes', () => {
  if (isOpen()) close()
  const dom = page(row(0, 'Same') + row(1, 'Same'))
  open()
  try {
    const before = Array.from(document.querySelectorAll('.product'))
    const slot = formSlot()
    const cards = formCards()
    slot.insertBefore(cards[1], cards[0])
    api._commit()

    assert.deepEqual(pageOrder(), ['1', '0'], 'the page nodes swapped')
    const after = Array.from(document.querySelectorAll('.product'))
    assert.deepEqual(
      after.map((el) => before.indexOf(el)),
      [1, 0],
      'both original nodes survived, they were moved rather than rewritten',
    )
  } finally {
    close()
    dom.window.close()
  }
})

// The products-with-variants shape, on the OUTER list. This could not be tested
// before formRowsAt stopped using `:scope >`: jsdom resolves that against the
// document and returned the inner variant rows as rows of the outer list, so the
// count never matched, identity bailed, and the assertion below silently passed
// or failed on content matching rather than on the mechanism.
test('row identity: removing the first of two identical PRODUCTS keeps the second, nested lists and all', () => {
  if (isOpen()) close()
  // Byte-identical in EVERY ruled field, variants included. Give the two
  // products different variant sizes and content matching gets this right on its
  // own, which is how the first version of this test passed with the mechanism
  // disabled.
  const dom = nestedPage(
    product('p0', 'Same', variant('a0', 'S') + variant('a1', 'M')) +
      product('p1', 'Same', variant('b0', 'S') + variant('b1', 'M')),
  )
  open()
  try {
    api.removeItem('products.0')
    const left = Array.from(document.querySelectorAll('.product'))
    assert.equal(left.length, 1)
    assert.equal(left[0].getAttribute('data-orig'), 'p1', 'the surviving product is the one the form kept')
    assert.deepEqual(variantIds(0), ['b0', 'b1'], 'it kept its own variant nodes, not a rebuild')
  } finally {
    close()
    dom.window.close()
  }
})
