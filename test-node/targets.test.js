import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { resolveTargets } from '../src/targets.js'

// Pure rule resolution: no session, no form, no mount. A bare JSDOM realm is the
// whole environment these need.
function makeDom(html) {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
}

function shape(targets) {
  return targets.map((t) => ({ path: t.path, kind: t.kind, icon: t.icon }))
}

const PAGE = `
  <h1 class="title">Hello</h1>
  <span class="meta-published" data-published="true" hidden></span>
  <img class="hero" src="/hero.png" alt="">
  <a class="link" href="/spec.pdf">Spec</a>
  <input class="name" value="Ada">
  <input class="bio" value="Readonly bio" readonly>
  <textarea class="notes">Notes</textarea>
  <ul>
    <li class="tag">a</li>
    <li class="tag">b</li>
  </ul>
  <div class="products">
    <div class="product">
      <span class="product-label">P1</span>
      <div class="variant"><span class="variant-label">P1 small</span></div>
    </div>
    <div class="product">
      <span class="product-label">P2</span>
      <div class="variant"><span class="variant-label">P2 small</span></div>
      <div class="variant"><span class="variant-label">P2 large</span></div>
    </div>
  </div>
`

const RULES = {
  title: 'h1.title',
  published: '.meta-published@data-published',
  hero: 'img.hero@src',
  link: 'a.link@href',
  name: 'input.name@value',
  bio: 'input.bio@value',
  notes: 'textarea.notes',
  tags: 'li.tag[]',
  products: ['.product', {
    label: '.product-label',
    variants: ['.variant', { label: '.variant-label' }],
  }],
}

test('resolveTargets: the demo shape resolves to the right paths, kinds and icons', () => {
  const dom = makeDom(PAGE)
  const { targets } = resolveTargets(dom.window.document.body, RULES)
  assert.deepEqual(shape(targets), [
    { path: ['title'], kind: 'text', icon: null },
    { path: ['published'], kind: 'handle', icon: 'pencil' },
    { path: ['hero'], kind: 'handle', icon: 'camera' },
    { path: ['link'], kind: 'handle', icon: 'paperclip' },
    { path: ['name'], kind: 'native', icon: 'pencil' },
    { path: ['bio'], kind: 'handle', icon: 'pencil' },
    { path: ['notes'], kind: 'handle', icon: 'pencil' },
    { path: ['tags', 0], kind: 'text', icon: null },
    { path: ['tags', 1], kind: 'text', icon: null },
    { path: ['products', 0, 'label'], kind: 'text', icon: null },
    { path: ['products', 0, 'variants', 0, 'label'], kind: 'text', icon: null },
    { path: ['products', 1, 'label'], kind: 'text', icon: null },
    { path: ['products', 1, 'variants', 0, 'label'], kind: 'text', icon: null },
    { path: ['products', 1, 'variants', 1, 'label'], kind: 'text', icon: null },
  ])
  dom.window.close()
})

// unresolved.js collapses every row to a single '*' because it answers a
// page-wide question once. The inline view puts a control on each row, so the
// index has to be real all the way down a nested list.
test('resolveTargets: nested array rows carry real indices, not a collapsed *', () => {
  const dom = makeDom(PAGE)
  const { targets } = resolveTargets(dom.window.document.body, RULES)
  const paths = targets.map((t) => t.path.join('.'))
  assert.ok(paths.includes('products.1.variants.0.label'), paths.join(' | '))
  assert.ok(paths.includes('products.1.variants.1.label'), paths.join(' | '))
  assert.equal(paths.some((p) => p.includes('*')), false, 'no collapsed wildcard row')

  const deep = targets.find((t) => t.path.join('.') === 'products.1.variants.0.label')
  assert.equal(deep.el.textContent, 'P2 small', 'the index points at the row it names')
  dom.window.close()
})

test('resolveTargets: a bare rule on an <img> is a camera handle, never text', () => {
  const dom = makeDom('<img class="pic" src="/a.png" alt="">')
  const { targets } = resolveTargets(dom.window.document.body, { pic: 'img.pic' })
  assert.equal(targets.length, 1)
  assert.equal(targets[0].kind, 'handle', 'a rich text editor must never bind to an <img>')
  assert.equal(targets[0].icon, 'camera')
  dom.window.close()
})

test('resolveTargets: a readonly input@value is a handle; the same input without readonly is native', () => {
  const dom = makeDom('<input class="a" value="x" readonly><input class="b" value="y">')
  const { targets } = resolveTargets(dom.window.document.body, {
    locked: 'input.a@value',
    open: 'input.b@value',
  })
  const byPath = Object.fromEntries(targets.map((t) => [t.path.join('.'), t.kind]))
  assert.equal(byPath.locked, 'handle', 'the author disabled it on purpose')
  assert.equal(byPath.open, 'native')
  dom.window.close()
})

test('resolveTargets: a list emptied to its [cms-template] seed still resolves a container', () => {
  const dom = makeDom(`
    <div class="products">
      <div class="product" cms-template hidden><span class="product-label"></span></div>
    </div>
  `)
  const { lists } = resolveTargets(dom.window.document.body, {
    products: ['.product', { label: '.product-label' }],
  })
  assert.equal(lists.length, 1)
  assert.deepEqual(lists[0].items, [], 'the seed is not a row')
  assert.equal(
    lists[0].container,
    dom.window.document.querySelector('.products'),
    'the container comes from the seed, so a row can be added back'
  )
  dom.window.close()
})

test('resolveTargets: an invalid CSS selector yields no target rather than throwing', () => {
  const dom = makeDom('<h1 class="title">Hello</h1>')
  let out
  assert.doesNotThrow(() => {
    out = resolveTargets(dom.window.document.body, { bad: 'div:::nope', title: 'h1.title' })
  })
  assert.deepEqual(out.targets.map((t) => t.path.join('.')), ['title'])
  dom.window.close()
})

// A tuple list is scalar or not by the SHAPE it projects, never by which
// spelling the author reached for. ['li.tag', '@innerHTML'] is the same one
// value per row that 'li.tag[]' is.
test('resolveTargets: a tuple list reports scalar from its shape', () => {
  const dom = makeDom(`
    <ul class="tags"><li class="tag">a</li><li class="tag">b</li></ul>
    <ul class="rows"><li class="row"><span class="label">a</span></li></ul>
  `)
  const body = dom.window.document.body
  const { lists: scalar } = resolveTargets(body, { tags: ['li.tag', '@innerHTML'] })
  assert.deepEqual(scalar.map((l) => l.scalar), [true])
  const { lists: object } = resolveTargets(body, { rows: ['li.row', { label: '.label' }] })
  assert.deepEqual(object.map((l) => l.scalar), [false])
  dom.window.close()
})

// A CTA's label is a text projection, but Chrome puts no caret in a
// contenteditable <button>, so binding rich text to one leaves it uneditable.
test('resolveTargets: a bare rule on a button resolves to a handle, not a caret', () => {
  const dom = makeDom('<button class="cta">Buy now</button>')
  const { targets } = resolveTargets(dom.window.document.body, { cta: 'button.cta' })
  assert.deepEqual(shape(targets), [{ path: ['cta'], kind: 'handle', icon: 'pencil' }])
  dom.window.close()
})
