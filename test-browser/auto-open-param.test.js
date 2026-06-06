import { expect, fixture, html } from '@open-wc/testing'
import { maybeAutoOpen, open, close, isOpen } from '../src/hypercms.js'
import { makeMutationShim, waitFor } from './_helpers.js'

// ?cms=true auto-open, end to end in a real browser. The WTR page URL is fixed,
// so each spec drives location.search with history.replaceState before invoking
// maybeAutoOpen() (the same step that runs at module load on a real page), then
// restores the URL in teardown.
const PAGE = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "title": "h1.page-title" }</script>
  <h1 class="page-title">Hyperclay</h1>`

let page
let originalUrl

function setSearch(search) {
  history.replaceState(history.state, '', search + location.hash)
}

async function mountPage() {
  page = await fixture(html`<div id="auto-open-page"></div>`)
  page.innerHTML = PAGE
  window.hyperclay = window.hyperclay || {}
  window.hyperclay.Mutation = makeMutationShim(page)
}

// Mount the page WITHOUT installing Mutation — reproduces the real load ordering
// where the CMS bundle (and its module-load maybeAutoOpen) runs BEFORE the host
// installs window.hyperclay.Mutation (which often sits behind an await import()).
async function mountPageNoMutation() {
  page = await fixture(html`<div id="auto-open-page"></div>`)
  page.innerHTML = PAGE
  window.hyperclay = window.hyperclay || {}
  delete window.hyperclay.Mutation
}

function teardown() {
  try { close() } catch {}
  if (window.hyperclay) delete window.hyperclay.Mutation
  // Restore the runner URL so a leftover ?cms=false can't leak into the next spec.
  history.replaceState(history.state, '', originalUrl)
}

describe('hypercms ?cms=true auto-open', () => {
  beforeEach(() => { originalUrl = location.pathname + location.search + location.hash })
  afterEach(() => teardown())

  it('auto-opens the shell when ?cms=true is present — no open() call', async () => {
    await mountPage()
    setSearch('?cms=true')

    expect(isOpen()).to.equal(false)
    // maybeAutoOpen defaults pageRoot to document.body; mount the page content
    // onto body so the engine finds the rules tag (it lives in the fixture).
    document.body.appendChild(page)
    maybeAutoOpen()

    await waitFor(() => isOpen())
    expect(isOpen()).to.equal(true)
    expect(document.querySelector('[data-hcms-shell]')).to.exist
  })

  it('closing toggles ?cms=true → ?cms=false, param kept, shell unmounts', async () => {
    await mountPage()
    document.body.appendChild(page)
    setSearch('?a=1&cms=true&b=2')
    maybeAutoOpen()
    await waitFor(() => isOpen())

    document.querySelector('[data-hcms-shell] [data-hcms-action="close"]').click()

    expect(isOpen()).to.equal(false)
    expect(document.querySelector('[data-hcms-shell]')).to.equal(null)
    expect(location.search).to.equal('?a=1&cms=false&b=2')
  })

  it('does not auto-open when the param is cms=false (reload-equivalent)', async () => {
    await mountPage()
    document.body.appendChild(page)
    setSearch('?cms=false')

    maybeAutoOpen()
    // Give any deferred open the chance to (wrongly) fire.
    await new Promise((r) => setTimeout(r, 50))

    expect(isOpen()).to.equal(false)
    expect(document.querySelector('[data-hcms-shell]')).to.equal(null)
  })

  it('does not auto-open when there is no cms param at all', async () => {
    await mountPage()
    document.body.appendChild(page)
    setSearch('?other=1')

    maybeAutoOpen()
    await new Promise((r) => setTimeout(r, 50))

    expect(isOpen()).to.equal(false)
  })

  it('does not double-open when the host also calls maybeAutoOpen twice', async () => {
    await mountPage()
    document.body.appendChild(page)
    setSearch('?cms=true')

    maybeAutoOpen()
    maybeAutoOpen()
    await waitFor(() => isOpen())

    expect(document.querySelectorAll('[data-hcms-shell]').length).to.equal(1)
  })

  // THE ORDERING that triggered the original HIGH defect: the CMS bundle runs (and
  // calls maybeAutoOpen at module load) BEFORE the host installs Mutation. The old
  // code fired open() synchronously, installObserver threw, and the throw escaped
  // module evaluation — on the dist IIFE that aborts the window.hypercms assignment
  // and takes the host's wiring down with it. maybeAutoOpen must NOT throw, must
  // wait, then mount once Mutation lands. A host that installs Mutation by DIRECT
  // ASSIGNMENT (no 'hyperclay:mutation-ready' event) is now caught by the slow
  // 250ms self-cancelling backstop rather than the old 50ms busy poll.
  it('waits for late window.hyperclay.Mutation instead of throwing, then mounts via the backstop', async () => {
    await mountPageNoMutation()
    document.body.appendChild(page)
    setSearch('?cms=true')

    // Must not throw out of module scope (mirrors the IIFE assignment surviving).
    expect(() => maybeAutoOpen()).to.not.throw()

    // No shell yet — Mutation is absent, so auto-open is patiently waiting.
    await new Promise((r) => setTimeout(r, 120))
    expect(isOpen()).to.equal(false)
    expect(document.querySelector('[data-hcms-shell]')).to.equal(null)
    // The module exports stay usable (the throw never escaped).
    expect(typeof open).to.equal('function')
    expect(typeof close).to.equal('function')

    // Host installs Mutation later by direct assignment (no event). The backstop
    // catches it within ~250ms; waitFor polls up to 800ms.
    window.hyperclay.Mutation = makeMutationShim(page)

    await waitFor(() => isOpen())
    expect(isOpen()).to.equal(true)
    expect(document.querySelectorAll('[data-hcms-shell]').length).to.equal(1)
  })

  // THE NO-POLL FAST PATH: when Mutation arrives via hyperclayjs's mutation.js, it
  // dispatches 'hyperclay:mutation-ready'. hypercms listens for that event and
  // mounts immediately — well under one backstop tick, with no busy polling.
  it('mounts promptly via hyperclay:mutation-ready, before any backstop tick', async () => {
    await mountPageNoMutation()
    document.body.appendChild(page)
    setSearch('?cms=true')

    maybeAutoOpen()
    expect(isOpen()).to.equal(false)

    // Install Mutation and fire the event the way mutation.js does.
    window.hyperclay.Mutation = makeMutationShim(page)
    const t0 = performance.now()
    document.dispatchEvent(new CustomEvent('hyperclay:mutation-ready', { detail: {} }))

    // The listener fires synchronously, so the shell is up immediately — far
    // faster than the 250ms backstop interval.
    expect(isOpen()).to.equal(true)
    expect(performance.now() - t0).to.be.lessThan(100)
    expect(document.querySelectorAll('[data-hcms-shell]').length).to.equal(1)
  })

  it('late-Mutation auto-open still closes and toggles the param', async () => {
    await mountPageNoMutation()
    document.body.appendChild(page)
    setSearch('?x=1&cms=true')

    maybeAutoOpen()
    window.hyperclay.Mutation = makeMutationShim(page)
    await waitFor(() => isOpen())

    document.querySelector('[data-hcms-shell] [data-hcms-action="close"]').click()

    expect(isOpen()).to.equal(false)
    expect(document.querySelector('[data-hcms-shell]')).to.equal(null)
    expect(location.search).to.equal('?x=1&cms=false')
  })
})

// Exception-safe open(): if open() throws after mounting the shell (the canonical
// case is installObserver with no Mutation), it must leave NO shell behind, and a
// later open() with Mutation present must work cleanly.
describe('hypercms open() is exception-safe', () => {
  let page2
  beforeEach(async () => {
    page2 = await fixture(html`<div id="exc-open-page"></div>`)
    page2.innerHTML = PAGE
    window.hyperclay = window.hyperclay || {}
    delete window.hyperclay.Mutation
  })
  afterEach(() => {
    try { close() } catch {}
    if (window.hyperclay) delete window.hyperclay.Mutation
  })

  it('a throw between shell mount and isOpen leaves no orphan shell, and a later open works', () => {
    // Mutation absent → installObserver throws after mountShell.
    expect(() => open({ pageRoot: page2 })).to.throw(/Mutation/)
    expect(isOpen()).to.equal(false)
    expect(document.querySelector('[data-hcms-shell]')).to.equal(null)

    // Recover cleanly once Mutation is present.
    window.hyperclay.Mutation = makeMutationShim(page2)
    open({ pageRoot: page2 })
    expect(isOpen()).to.equal(true)
    expect(document.querySelectorAll('[data-hcms-shell]').length).to.equal(1)
  })
})
