import { expect, fixture, html } from '@open-wc/testing'
import { open, close } from '../src/hypercms.js'
import { makeMutationShim, waitFor } from './_helpers.js'
// Load the vendored mirk runtime so these specs prove our data-hcms-* hooks stay
// inert against the kit's own .mirk-* handlers, mirroring upload-field.test.js.
import '../src/vendor/mirk.vendor.js'

// Named built-in controls (toggle / select / radio / textarea / number / chips)
// selected purely from rules + data-hcms-* attributes on the PAGE element — the
// fixture carries ZERO <template data-hcms-tpl> elements, proving on-demand
// component injection drives the whole form.

const RULES = {
  pub: '.pub@data-pub',
  pri: '.pri@data-pri',
  col: '.col@data-col',
  bio: '.bio',
  qty: '.qty',
  tags: 'ul.tags li[]',
}

const PAGE = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">${JSON.stringify(RULES)}</script>
  <div class="content">
    <span class="pub" data-hcms-component="toggle" data-pub="true"></span>
    <span class="pri" data-hcms-component="select" data-hcms-options="low medium high" data-pri="medium"></span>
    <span class="col" data-hcms-component="radio" data-hcms-options="red green blue" data-col="red"></span>
    <p class="bio" data-hcms-component="textarea">hello</p>
    <p class="qty" data-hcms-component="number">7</p>
    <ul class="tags" data-hcms-component="chips">
      <li>alpha</li>
      <li>beta</li>
    </ul>
  </div>`

let page
let changes

async function setup() {
  page = await fixture(html`<div id="nc-page"></div>`)
  page.innerHTML = PAGE
  window.hyperclay = window.hyperclay || {}
  window.hyperclay.Mutation = makeMutationShim(page)
  changes = []
  open({ pageRoot: page, onChange: (data, info) => changes.push({ data, info }) })
  return document.querySelector('[data-hcms-form-root]')
}

function teardown() {
  try { close() } catch {}
  if (window.hyperclay) delete window.hyperclay.Mutation
}

const at = (formRoot, path) => formRoot.querySelector(`[data-hcms-path="${path}"]`)

describe('hypercms named built-in controls (rules + data-hcms-* only, no templates)', () => {
  let formRoot
  afterEach(() => teardown())

  it('the fixture defines NO custom templates (components are injected on demand)', async () => {
    formRoot = await setup()
    expect(page.querySelectorAll('template[data-hcms-tpl]').length).to.equal(0)
  })

  it('toggle: renders .mirk-toggle; unchecking commits data-pub="false" on the page element', async () => {
    formRoot = await setup()
    const field = at(formRoot, 'pub')
    expect(field.querySelector('.mirk-toggle'), 'toggle chrome rendered').to.exist
    const box = field.querySelector('input[type="checkbox"][data-hcms-field="pub"]')
    expect(box, 'toggle checkbox').to.exist
    expect(box.checked).to.equal(true)                       // hydrated from data-pub="true"

    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => page.querySelector('.pub').getAttribute('data-pub') === 'false')
    expect(page.querySelector('.pub').getAttribute('data-pub')).to.equal('false')
    expect(changes.at(-1).data.pub).to.equal(false)
  })

  it('select: renders 3 options from data-hcms-options; changing to "high" commits data-pri="high"', async () => {
    formRoot = await setup()
    const select = at(formRoot, 'pri').querySelector('select[data-hcms-field="pri"]')
    expect(select, 'select field').to.exist
    expect(Array.from(select.options).map((o) => o.value)).to.deep.equal(['low', 'medium', 'high'])
    expect(select.value).to.equal('medium')                 // hydrated from data-pri="medium"

    select.value = 'high'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => page.querySelector('.pri').getAttribute('data-pri') === 'high')
    expect(page.querySelector('.pri').getAttribute('data-pri')).to.equal('high')
    expect(changes.at(-1).data.pri).to.equal('high')
  })

  it('radio: clicking the "green" radio commits data-col="green" on the page element', async () => {
    formRoot = await setup()
    const field = at(formRoot, 'col')
    const radios = field.querySelectorAll('input[type="radio"][data-hcms-field="col"]')
    expect(Array.from(radios).map((r) => r.value)).to.deep.equal(['red', 'green', 'blue'])
    const red = field.querySelector('input[type="radio"][value="red"]')
    expect(red.checked).to.equal(true)                      // hydrated from data-col="red"

    const green = field.querySelector('input[type="radio"][value="green"]')
    green.click()

    await waitFor(() => page.querySelector('.col').getAttribute('data-col') === 'green')
    expect(page.querySelector('.col').getAttribute('data-col')).to.equal('green')
    expect(changes.at(-1).data.col).to.equal('green')
  })

  it('textarea: typing commits the page element textContent', async () => {
    formRoot = await setup()
    const ta = at(formRoot, 'bio').querySelector('textarea[data-hcms-field="bio"]')
    expect(ta, 'textarea field').to.exist
    expect(ta.value).to.equal('hello')                      // hydrated from page text

    ta.value = 'rewritten bio'
    ta.dispatchEvent(new Event('input', { bubbles: true }))

    await waitFor(() => page.querySelector('.bio').textContent === 'rewritten bio')
    expect(page.querySelector('.bio').textContent).to.equal('rewritten bio')
    expect(changes.at(-1).data.bio).to.equal('rewritten bio')
  })

  it('number: setting the value commits the page element text', async () => {
    formRoot = await setup()
    const num = at(formRoot, 'qty').querySelector('input[type="number"][data-hcms-field="qty"]')
    expect(num, 'number field').to.exist
    expect(num.value).to.equal('7')                         // hydrated from page text

    num.value = '42'
    num.dispatchEvent(new Event('input', { bubbles: true }))

    await waitFor(() => page.querySelector('.qty').textContent === '42')
    expect(page.querySelector('.qty').textContent).to.equal('42')
    expect(changes.at(-1).data.qty).to.equal('42')
  })

  it('chips: renders 2 chips; add appends a chip + a page li; remove drops both (instant, no confirm)', async () => {
    formRoot = await setup()
    const arrayEl = at(formRoot, 'tags')
    const chips = () => arrayEl.querySelectorAll('.mirk-tags__chip')
    expect(chips().length).to.equal(2)
    expect(Array.from(chips()).map((c) => c.querySelector('input[data-hcms-field]').value))
      .to.deep.equal(['alpha', 'beta'])
    expect(page.querySelectorAll('ul.tags li').length).to.equal(2)

    // Add: one more chip in the form AND one more li on the page.
    arrayEl.querySelector('[data-hcms-action="add"]').click()
    await waitFor(() => chips().length === 3)
    expect(chips().length).to.equal(3)
    await waitFor(() => page.querySelectorAll('ul.tags li').length === 3)
    expect(page.querySelectorAll('ul.tags li').length).to.equal(3)

    // Remove the first chip: instant (scalar-array removals don't confirm).
    chips()[0].querySelector('[data-hcms-action="remove"]').click()
    await waitFor(() => chips().length === 2)
    expect(chips().length).to.equal(2)
    await waitFor(() => page.querySelectorAll('ul.tags li').length === 2)
    expect(page.querySelectorAll('ul.tags li').length).to.equal(2)
    // The first remaining page li is now "beta" (alpha was dropped).
    expect(page.querySelectorAll('ul.tags li')[0].textContent).to.equal('beta')
  })
})
