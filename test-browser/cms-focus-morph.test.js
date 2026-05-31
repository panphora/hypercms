import { api } from '../src/hypercms.js'
import { expect, setupCms, teardownCms, field, pageName, waitFor } from './_helpers.js'

// Real-browser behaviors the node tier (which stubs the observer) can't model:
// a genuine MutationObserver driving refreshForm, and document.activeElement-aware
// morphing (morphForm ignoreActiveValue) with real focus.

describe('hypercms observer-driven refresh + focus morph (real browser)', () => {
  let page
  let formRoot

  beforeEach(async () => { ({ page, formRoot } = await setupCms()) })
  afterEach(() => teardownCms())

  it('auto-refreshes the form when the page changes externally (real MutationObserver)', async () => {
    expect(field(formRoot, 'products.0.name').value).to.equal('P1')

    // External page edit, no explicit refresh() call — the observer must drive it.
    page.querySelectorAll('.product-name')[0].textContent = 'P1-ext'
    await waitFor(() => field(formRoot, 'products.0.name').value === 'P1-ext')

    expect(field(formRoot, 'products.0.name').value).to.equal('P1-ext')
  })

  it('keeps in-progress typing in a focused field when an observer refresh runs', async () => {
    const f0 = field(formRoot, 'products.0.name')
    f0.focus()
    f0.value = 'TYPING' // uncommitted local edit; the page still says P1
    expect(document.activeElement).to.equal(f0)

    // Edit a DIFFERENT field on the page to trigger a refresh.
    page.querySelectorAll('.product-name')[1].textContent = 'P2-ext'
    await waitFor(() => field(formRoot, 'products.1.name').value === 'P2-ext')

    // ignoreActiveValue protects the focused field; the other field still updates.
    expect(field(formRoot, 'products.0.name').value).to.equal('TYPING')
    expect(document.activeElement).to.equal(field(formRoot, 'products.0.name'))
    expect(field(formRoot, 'products.1.name').value).to.equal('P2-ext')
  })

  it('commits a focused field edit to the page live via a real input event', async () => {
    const f0 = field(formRoot, 'products.0.name')
    f0.focus()
    f0.value = 'RENAMED'
    f0.dispatchEvent(new Event('input', { bubbles: true }))

    await waitFor(() => pageName(page, 0) === 'RENAMED')
    expect(pageName(page, 0)).to.equal('RENAMED')
    // The focused field survives the post-commit refresh.
    expect(field(formRoot, 'products.0.name').value).to.equal('RENAMED')
    expect(document.activeElement).to.equal(field(formRoot, 'products.0.name'))
  })
})
