import { api } from '../src/hypercms.js'
import { undo } from '../../hyper-undo/src/index.js'
import { expect, setupCms, teardownCms, cardCount, productCount, waitFor } from './_helpers.js'

// End-to-end MutationObserver <-> undo round-trip in a real browser: a structural
// edit lands on page + form, hyper-undo captures it as one labeled step, and undo
// reverts the page so the observer re-syncs the form. The node tier stubs the
// observer, so this cross-package integration is browser-only.

describe('hypercms structural edits + undo round-trip (real browser)', () => {
  let page
  let formRoot

  beforeEach(async () => { ({ page, formRoot } = await setupCms()) })
  afterEach(() => teardownCms())

  it('addItem grows page + form, records one undo step, and undo restores both', async () => {
    expect(productCount(page)).to.equal(2)
    expect(cardCount(formRoot)).to.equal(2)

    api.addItem('products')
    expect(productCount(page)).to.equal(3)
    expect(undo.canUndo).to.equal(true)
    expect(undo.history.map((c) => c.label)).to.deep.equal(['Add products'])
    await waitFor(() => cardCount(formRoot) === 3)
    expect(cardCount(formRoot)).to.equal(3)

    undo.undo()
    await waitFor(() => productCount(page) === 2)
    await waitFor(() => cardCount(formRoot) === 2)
    expect(productCount(page)).to.equal(2)
    expect(cardCount(formRoot)).to.equal(2)
  })

  it('removeItem shrinks page + form, records one undo step, and undo restores both', async () => {
    expect(productCount(page)).to.equal(2)

    api.removeItem('products.0')
    expect(productCount(page)).to.equal(1)
    expect(undo.canUndo).to.equal(true)
    expect(undo.history.map((c) => c.label)).to.deep.equal(['Remove products.0'])
    await waitFor(() => cardCount(formRoot) === 1)
    expect(cardCount(formRoot)).to.equal(1)

    undo.undo()
    await waitFor(() => productCount(page) === 2)
    await waitFor(() => cardCount(formRoot) === 2)
    expect(productCount(page)).to.equal(2)
    expect(cardCount(formRoot)).to.equal(2)
  })
})
