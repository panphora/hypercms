import { expect, fixture, html } from '@open-wc/testing'
import { open, close, api, refresh } from '../src/hypercms.js'
import { undo } from '../../hyper-undo/src/index.js'

// De-risks the browser tier: proves the runner launches a real browser AND the
// cross-package module graph (hypercms -> hyper-html-api -> hyper-morph, plus
// hyper-undo) resolves under nodeResolve + workspace rootDir. If the import line
// above throws, this whole file fails to load and that is the signal.
describe('hypercms browser harness smoke', () => {
  it('the runner and a real browser are working', async () => {
    const el = await fixture(html`<div>hi</div>`)
    expect(el).to.have.text('hi')
    expect(typeof window.MutationObserver).to.equal('function')
    expect(typeof document.activeElement).to.equal('object')
  })

  it('the cross-package module graph loads in the browser', () => {
    expect(typeof open).to.equal('function')
    expect(typeof close).to.equal('function')
    expect(typeof refresh).to.equal('function')
    expect(api && typeof api.addItem).to.equal('function')
    expect(api && typeof api._commit).to.equal('function')
    expect(undo && typeof undo.start).to.equal('function')
    expect(undo && typeof undo.undo).to.equal('function')
  })
})
