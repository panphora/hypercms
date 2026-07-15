import { expect, fixture, html } from '@open-wc/testing'
import { engine } from 'hyper-html-api'
import { open, close, isOpen } from '../src/hypercms.js'
import { maybeInjectToggle } from '../src/toggle.js'
import { makeMutationShim, waitFor } from './_helpers.js'

// Floating edit-mode toggle, end to end in a real browser: injection gating,
// then a real open/close round-trip through the actual shell.
const PAGE = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "title": "h1.page-title" }</script>
  <h1 class="page-title">Hyperclay</h1>`

function realApi() {
  return { open, close, isOpen, hasRules: (doc) => !!engine.findRules(doc, 'cms') }
}

function cleanupToggle() {
  document.getElementById('hcms-toggle')?.remove()
  document.getElementById('hcms-toggle-style')?.remove()
}

describe('hypercms floating toggle', () => {
  let page

  async function mountPage() {
    page = await fixture(html`<div id="toggle-page"></div>`)
    page.innerHTML = PAGE
    document.body.appendChild(page)
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.Mutation = makeMutationShim(page)
  }

  afterEach(() => {
    try { close() } catch {}
    cleanupToggle()
    delete window.__hyperclayEditMode
    if (window.hyperclay) delete window.hyperclay.Mutation
  })

  it('injects in edit mode on a rules page, with the strip attributes', async () => {
    await mountPage()
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const btn = document.getElementById('hcms-toggle')
    expect(btn).to.exist
    expect(btn.hasAttribute('no-save')).to.equal(true)
    expect(btn.hasAttribute('snapshot-remove')).to.equal(true)
    expect(btn.hasAttribute('save-ignore')).to.equal(true)
    expect(document.getElementById('hcms-toggle-style')).to.exist
  })

  it('does not inject when not in edit mode', async () => {
    await mountPage()
    maybeInjectToggle(realApi())
    expect(document.getElementById('hcms-toggle')).to.equal(null)
  })

  it('does not inject on a page without cms rules', async () => {
    page = await fixture(html`<div id="toggle-page-norules"><h1>Hi</h1></div>`)
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    expect(document.getElementById('hcms-toggle')).to.equal(null)
  })

  it('click opens the real shell, click again closes it', async () => {
    await mountPage()
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const btn = document.getElementById('hcms-toggle')

    btn.click()
    await waitFor(() => isOpen())
    expect(isOpen()).to.equal(true)
    expect(document.body.classList.contains('hcms-open')).to.equal(true)
    expect(document.querySelector('[data-hcms-shell]')).to.exist

    btn.click()
    await waitFor(() => !isOpen())
    expect(isOpen()).to.equal(false)
    expect(document.querySelector('[data-hcms-shell]')).to.equal(null)
    expect(document.getElementById('hcms-toggle'), 'toggle survives close').to.exist
  })
})
