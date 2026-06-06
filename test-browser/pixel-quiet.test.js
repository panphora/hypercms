import { expect, fixture, html } from '@open-wc/testing'
import { open, close } from '../src/hypercms.js'
import { makeMutationShim, waitFor } from './_helpers.js'
// Load the vendored mirk runtime for fidelity (idempotent, document-delegated).
import '../src/vendor/mirk.vendor.js'

// The canonical Pixel Quiet "Page settings" field set, plus the per-field mirk
// templates a real page supplies for toggle / select / radio / tag chips.
// Title, Tagline, Bio and Products ride the mirk defaults baked into hypercms.
const RULES = {
  title: 'h1.page-title',
  tagline: '.tagline',
  bio: '.bio',
  published: '.meta@data-published',
  priority: '.meta@data-priority',
  color: '.meta@data-color',
  tags: 'ul.tags li[]',
  products: ['.product', { name: '.product-name', price: '.product-price' }],
}

const TEMPLATES = `
<template data-hcms-tpl="published">
  <div class="hcms-field hcms-field--row" data-hcms-shape="scalar">
    <span class="hcms-label" data-hcms-label></span>
    <label class="mirk-toggle">
      <input type="checkbox" role="switch" class="mirk-sr-only" data-hcms-field="published">
      <span class="mirk-toggle__track"><span class="mirk-toggle__thumb"></span></span>
    </label>
  </div>
</template>
<template data-hcms-tpl="priority">
  <label class="hcms-field" data-hcms-shape="scalar">
    <span class="hcms-label" data-hcms-label></span>
    <div class="mirk-select">
      <select class="mirk-select__field" data-hcms-field="priority">
        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
      </select>
      <span aria-hidden="true" class="mirk-select__chevron">›</span>
    </div>
  </label>
</template>
<template data-hcms-tpl="color">
  <div class="hcms-field" data-hcms-shape="scalar">
    <span class="hcms-label" data-hcms-label></span>
    <div class="hcms-radio-row">
      <label class="mirk-radio"><input type="radio" name="pqt-color" value="red" class="mirk-sr-only" data-hcms-field="color"><span class="mirk-radio__ring"><span class="mirk-radio__fill"></span><span class="mirk-radio__dot"></span></span><span class="mirk-radio__label">Red</span></label>
      <label class="mirk-radio"><input type="radio" name="pqt-color" value="green" class="mirk-sr-only" data-hcms-field="color"><span class="mirk-radio__ring"><span class="mirk-radio__fill"></span><span class="mirk-radio__dot"></span></span><span class="mirk-radio__label">Green</span></label>
    </div>
  </div>
</template>
<template data-hcms-tpl="tags">
  <div class="hcms-field" data-hcms-shape="scalar-array">
    <span class="hcms-label" data-hcms-label></span>
    <div class="mirk-tags hcms-array-items"></div>
    <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ tag</span></button>
  </div>
</template>
<template data-hcms-tpl="tags.*">
  <span class="mirk-tags__chip" data-hcms-array-item>
    <input class="pq-chip-field" data-hcms-field value="">
    <button type="button" class="hcms-remove" data-hcms-action="remove" aria-label="Remove tag">×</button>
  </span>
</template>
`

const PAGE = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">${JSON.stringify(RULES)}</script>
  <h1 class="page-title">Hyperclay</h1>
  <p class="tagline">Edit the panel</p>
  <p class="bio">A short bio.</p>
  <p class="meta" data-published="true" data-color="red" data-priority="medium" hidden></p>
  <ul class="tags"><li>foo</li><li>bar</li><li>baz</li></ul>
  <div class="products-list">
    <div class="product"><h3 class="product-name">Widget</h3><p class="product-price">9.99</p></div>
    <div class="product"><h3 class="product-name">Gadget</h3><p class="product-price">19.99</p></div>
    <div class="product" cms-template hidden><h3 class="product-name"></h3><p class="product-price"></p></div>
  </div>`

let page
let injectedTemplates = []

async function setup() {
  // Templates are resolved document-scoped, so they live in <head>.
  const holder = document.createElement('div')
  holder.innerHTML = TEMPLATES
  injectedTemplates = [...holder.querySelectorAll('template')]
  injectedTemplates.forEach((t) => document.head.appendChild(t))

  page = await fixture(html`<div id="pqt-page"></div>`)
  page.innerHTML = PAGE
  window.hyperclay = window.hyperclay || {}
  window.hyperclay.Mutation = makeMutationShim(page)
  open({ pageRoot: page, showSaveButton: true })
  return document.querySelector('[data-hcms-form-root]')
}

function teardown() {
  try { close() } catch {}
  injectedTemplates.forEach((t) => t.remove())
  injectedTemplates = []
  if (window.hyperclay) delete window.hyperclay.Mutation
}

const fieldInput = (formRoot, path, sel = 'input') => formRoot.querySelector(`[data-hcms-path="${path}"] ${sel}`)
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }))

describe('hypercms × Pixel Quiet — render', () => {
  let formRoot
  beforeEach(async () => { formRoot = await setup() })
  afterEach(() => teardown())

  it('mounts a pixel-quiet shell with mirk close + save buttons', () => {
    const shell = document.querySelector('[data-hcms-shell]')
    expect(shell.classList.contains('pixel-quiet')).to.equal(true)
    expect(shell.querySelector('.hcms-shell-close.mirk-button')).to.exist
    expect(shell.querySelector('.hcms-shell-save.mirk-button')).to.exist
    expect(shell.querySelector('.hcms-shell-minibar')).to.exist
    expect(shell.querySelector('.hcms-shell-body [data-hcms-form-root]')).to.exist
  })

  it('renders the default scalars as mirk-input', () => {
    expect(fieldInput(formRoot, 'title')).to.have.class('mirk-input')
    expect(fieldInput(formRoot, 'title').value).to.equal('Hyperclay')
    expect(fieldInput(formRoot, 'tagline')).to.have.class('mirk-input')
  })

  it('renders the per-field mirk components (toggle / select / radio / chips)', () => {
    expect(formRoot.querySelector('[data-hcms-path="published"] .mirk-toggle')).to.exist
    expect(formRoot.querySelector('[data-hcms-path="priority"] .mirk-select__field')).to.exist
    expect(formRoot.querySelectorAll('[data-hcms-path="color"] .mirk-radio').length).to.equal(2)
    expect(formRoot.querySelectorAll('[data-hcms-path="tags"] .mirk-tags__chip').length).to.equal(3)
  })

  it('renders object-array items as mirk-sortable cards with a dotted grip', () => {
    const cards = formRoot.querySelectorAll('[data-hcms-card].mirk-sortable__item')
    expect(cards.length).to.equal(2)
    expect(cards[0].querySelectorAll('.mirk-sortable__grip .mirk-sortable__dot').length).to.equal(8)
    expect(fieldInput(formRoot, 'products.0.name').value).to.equal('Widget')
  })

  it('hydrates toggle / select / radio from the page', () => {
    expect(fieldInput(formRoot, 'published', 'input[type=checkbox]').checked).to.equal(true)
    expect(fieldInput(formRoot, 'priority', 'select').value).to.equal('medium')
    const checked = formRoot.querySelector('[data-hcms-path="color"] input:checked')
    expect(checked.value).to.equal('red')
  })
})

describe('hypercms × Pixel Quiet — binding + actions', () => {
  let formRoot
  beforeEach(async () => { formRoot = await setup() })
  afterEach(() => teardown())

  it('editing a scalar writes through to the page', async () => {
    const input = fieldInput(formRoot, 'title')
    input.value = 'Hyperclay CMS'
    fire(input, 'input')
    await waitFor(() => page.querySelector('h1.page-title').textContent === 'Hyperclay CMS')
    expect(page.querySelector('h1.page-title').textContent).to.equal('Hyperclay CMS')
  })

  it('the toggle flips a page attribute', async () => {
    const cb = fieldInput(formRoot, 'published', 'input[type=checkbox]')
    cb.checked = false
    fire(cb, 'change')
    await waitFor(() => page.querySelector('.meta').getAttribute('data-published') === 'false')
    expect(page.querySelector('.meta').getAttribute('data-published')).to.equal('false')
  })

  it('the select writes a page attribute', async () => {
    const sel = fieldInput(formRoot, 'priority', 'select')
    sel.value = 'high'
    fire(sel, 'change')
    await waitFor(() => page.querySelector('.meta').getAttribute('data-priority') === 'high')
    expect(page.querySelector('.meta').getAttribute('data-priority')).to.equal('high')
  })

  it('removing a tag chip drops the page list item', async () => {
    formRoot.querySelector('[data-hcms-path="tags.0"] [data-hcms-action="remove"]').click()
    await waitFor(() => page.querySelectorAll('ul.tags li').length === 2)
    expect([...page.querySelectorAll('ul.tags li')].map((l) => l.textContent)).to.deep.equal(['bar', 'baz'])
  })

  it('adding a product appends a card and a page product', async () => {
    formRoot.querySelector('[data-hcms-path="products"] [data-hcms-action="add"]').click()
    await waitFor(() => formRoot.querySelectorAll('[data-hcms-card]').length === 3)
    expect(formRoot.querySelectorAll('[data-hcms-card]').length).to.equal(3)
    expect(page.querySelectorAll('.products-list .product:not([cms-template])').length).to.equal(3)
  })

  it('reordering a product reorders the page', async () => {
    formRoot.querySelector('[data-hcms-path="products.1"] [data-hcms-action="move-up"]').click()
    await waitFor(() => page.querySelector('.products-list .product .product-name').textContent === 'Gadget')
    expect([...page.querySelectorAll('.products-list .product:not([cms-template]) .product-name')].map((n) => n.textContent))
      .to.deep.equal(['Gadget', 'Widget'])
  })

  it('Save button carries [trigger-save] for the host save system, no hypercms wiring', async () => {
    const saveButton = document.querySelector('[data-hcms-shell] .hcms-shell-save')
    expect(saveButton.hasAttribute('trigger-save')).to.equal(true)
    expect(saveButton.hasAttribute('data-hcms-action')).to.equal(false)
    // A standalone host delegates [trigger-save] itself — verify the click reaches it.
    let clicked = false
    document.addEventListener('click', (e) => { if (e.target.closest('[trigger-save]')) clicked = true }, { once: true })
    saveButton.click()
    expect(clicked).to.equal(true)
  })
})
