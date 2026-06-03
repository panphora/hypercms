import { fixture, html } from '@open-wc/testing'
import { open, close } from '../src/hypercms.js'
import { undo } from '../../hyper-undo/src/index.js'
import { expect, field, pageName, waitFor, PAGE_HTML } from './_helpers.js'

// The headline multi-user lost-update (A1-1): a CMS shell is open in tab B when a
// remote live-sync morph from tab A lands. The morph runs inside
// window.hyperclay.Mutation.pause()/resume(), which the source-blind refresh
// observer is deaf to, so B's form goes STALE. The next local edit then re-applies
// the full (stale) form data and clobbers A's change. The fix subscribes hypercms
// to the `hyperclay:livesync-applied` signal and re-extracts the form.
//
// _helpers' default Mutation shim has a no-op pause(), so a plain page edit always
// reaches the observer and the form never goes stale — it CANNOT reproduce this.
// This pausable double mirrors the platform's real Mutation: while paused it
// delivers nothing, and on the outer resume it DROPS the records queued during the
// pause (takeRecords, exactly as resume() does at depth 0). That blind window is
// the precondition for the lost-update.
function makePausableShim(target) {
  let depth = 0
  let mo = null
  const subs = new Set()
  const ensure = () => {
    if (mo) return
    mo = new MutationObserver(() => { if (depth === 0) subs.forEach((cb) => cb()) })
    mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true })
  }
  return {
    onAnyChange(_opts, cb) { ensure(); subs.add(cb); return () => subs.delete(cb) },
    pause() { depth++ },
    resume() { depth = Math.max(0, depth - 1); if (depth === 0 && mo) mo.takeRecords() },
  }
}

async function setupWithPausableShim() {
  const page = await fixture(html`<div id="page"></div>`)
  page.innerHTML = PAGE_HTML
  window.hyperclay = window.hyperclay || {}
  const shim = makePausableShim(page)
  window.hyperclay.Mutation = shim
  window.hyperclay.undo = undo
  open({ pageRoot: page })
  const formRoot = document.querySelector('[data-hcms-form-root]')
  undo.start({ scope: page, bindKeys: false, idleWindowMs: 50 })
  undo.clear()
  return { page, formRoot, shim }
}

function teardown() {
  try { undo.stop() } catch {}
  try { close() } catch {}
  if (window.hyperclay) {
    delete window.hyperclay.undo
    delete window.hyperclay.Mutation
  }
}

// live-sync dispatches this on the global document after applying a remote morph.
const fireLivesync = (seq) =>
  document.dispatchEvent(new CustomEvent('hyperclay:livesync-applied', { detail: { seq } }))

// Apply a remote morph the observer is blind to: pause, mutate the page, resume
// (records dropped), then announce it the way live-sync does.
function remoteMorph(shim, mutate, seq) {
  shim.pause()
  mutate()
  shim.resume()
  fireLivesync(seq)
}

describe('hypercms × live-sync lost-update regression (A1-1, real browser)', () => {
  afterEach(() => teardown())

  it('a blind remote morph leaves the form stale until live-sync announces it (reproduces the precondition)', async () => {
    const { page, formRoot, shim } = await setupWithPausableShim()
    expect(field(formRoot, 'products.0.name').value).to.equal('P1')

    shim.pause()
    page.querySelectorAll('.product-name')[0].textContent = 'REMOTE-A'
    shim.resume()

    // The pause window blinded the observer: page changed, form did NOT catch up.
    await new Promise((r) => setTimeout(r, 30))
    expect(pageName(page, 0)).to.equal('REMOTE-A')
    expect(field(formRoot, 'products.0.name').value).to.equal('P1')

    // The live-sync signal is what closes the gap.
    fireLivesync(1)
    await waitFor(() => field(formRoot, 'products.0.name').value === 'REMOTE-A')
    expect(field(formRoot, 'products.0.name').value).to.equal('REMOTE-A')
  })

  it('a later local edit does NOT clobber the remote change (the headline lost-update is gone)', async () => {
    const { page, formRoot, shim } = await setupWithPausableShim()

    // Tab A's edit lands as a blind morph + announcement.
    remoteMorph(shim, () => { page.querySelectorAll('.product-name')[0].textContent = 'REMOTE-A' }, 1)
    await waitFor(() => field(formRoot, 'products.0.name').value === 'REMOTE-A')

    // Tab B now edits a DIFFERENT field. The per-edit full-data apply must write
    // the freshly re-synced 'REMOTE-A' for product 0, not the pre-morph 'P1'.
    const f1 = field(formRoot, 'products.1.name')
    f1.value = 'P2-local'
    f1.dispatchEvent(new Event('input', { bubbles: true }))

    await waitFor(() => pageName(page, 1) === 'P2-local')
    expect(pageName(page, 1)).to.equal('P2-local')
    expect(pageName(page, 0)).to.equal('REMOTE-A') // would be 'P1' without the fix
  })

  it('re-syncs the rest of the form while preserving the field the user is typing in', async () => {
    const { page, formRoot, shim } = await setupWithPausableShim()

    const f0 = field(formRoot, 'products.0.name')
    f0.focus()
    f0.value = 'TYPING' // uncommitted local edit; the page still says P1
    expect(document.activeElement).to.equal(f0)

    remoteMorph(shim, () => { page.querySelectorAll('.product-name')[1].textContent = 'P2-remote' }, 2)
    await waitFor(() => field(formRoot, 'products.1.name').value === 'P2-remote')

    // ignoreActiveValue:true on the livesync path protects the focused field;
    // every other field re-syncs to the page.
    expect(field(formRoot, 'products.0.name').value).to.equal('TYPING')
    expect(document.activeElement).to.equal(field(formRoot, 'products.0.name'))
    expect(field(formRoot, 'products.1.name').value).to.equal('P2-remote')
  })
})
