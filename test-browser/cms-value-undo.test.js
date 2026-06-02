import { open, close } from '../src/hypercms.js'
import { undo } from '../../hyper-undo/src/index.js'
import { expect, fixture, html } from '@open-wc/testing'
import { makeMutationShim, waitFor, setupCms, teardownCms, field } from './_helpers.js'

// D3-1 regression: a CMS field that projects to an input @value (or checkbox
// @checked) is a PROPERTY write, which fires no MutationRecord — hyper-undo's
// observer can't see it. hypercms records it explicitly (recordValue), so the
// edit becomes one undo step and Cmd+Z reverts the page projection AND re-fires
// onChange so a consumer persisting via onChange (e.g. the collection dashboard
// PUT) follows the revert. Mirrors the dashboard's documented @value opt-in.

const VALUE_PAGE_HTML = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "name": ".f-name@value" }</script>
  <div id="record-panel" hidden>
    <input class="f-name" value="Alice" />
  </div>`

function inputFor(formRoot, fieldName) {
  const wrap = formRoot.querySelector(`[data-hcms-field="${fieldName}"]`)
  if (!wrap) return null
  return wrap.matches('input, textarea, select') ? wrap : wrap.querySelector('input, textarea, select')
}

function type(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('hypercms @value field edits + undo (real browser)', () => {
  let page, formRoot, panelInput, changes

  beforeEach(async () => {
    page = await fixture(html`<div id="page"></div>`)
    page.innerHTML = VALUE_PAGE_HTML
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.Mutation = makeMutationShim(page)
    window.hyperclay.undo = undo
    changes = []
    // Start undo BEFORE open() so hypercms can subscribe its undo/redo handler
    // (matches the smooth-sailing preset, which starts undo at page load before
    // any hypercms.open()).
    undo.start({ scope: page, bindKeys: false, idleWindowMs: 50 })
    open({ pageRoot: page, onChange: (d) => changes.push(d) })
    undo.clear()
    formRoot = document.querySelector('[data-hcms-form-root]')
    panelInput = page.querySelector('.f-name')
  })

  afterEach(() => {
    try { undo.stop() } catch {}
    try { close() } catch {}
    if (window.hyperclay) { delete window.hyperclay.undo; delete window.hyperclay.Mutation }
  })

  it('records ONE undo step for an @value edit; undo reverts the page value + re-fires onChange', async () => {
    const formInput = inputFor(formRoot, 'name')
    expect(formInput, 'form has a name field').to.exist
    expect(panelInput.value).to.equal('Alice')

    type(formInput, 'AliceX')
    expect(panelInput.value).to.equal('AliceX')                 // projected to the page @value
    await waitFor(() => undo.history.length === 1)
    expect(undo.history.map((c) => c.label)).to.deep.equal(['Edit'])
    expect(changes.at(-1)).to.deep.equal({ name: 'AliceX' })    // onChange fired on edit

    const changeCountBeforeUndo = changes.length
    undo.undo()
    await waitFor(() => panelInput.value === 'Alice')
    expect(panelInput.value).to.equal('Alice')                  // page value reverted
    await waitFor(() => changes.length > changeCountBeforeUndo)
    expect(changes.at(-1)).to.deep.equal({ name: 'Alice' })     // PUT-on-undo: onChange re-fired with reverted data

    undo.redo()
    await waitFor(() => panelInput.value === 'AliceX')
    expect(panelInput.value).to.equal('AliceX')
  })

  it('coalesces rapid @value keystrokes into ONE undo step', async () => {
    const formInput = inputFor(formRoot, 'name')
    type(formInput, 'Al')
    type(formInput, 'Alb')
    type(formInput, 'Albert')
    await waitFor(() => undo.history.length === 1)
    expect(undo.history.length).to.equal(1)
    undo.undo()
    await waitFor(() => panelInput.value === 'Alice')
    expect(panelInput.value).to.equal('Alice')                  // one undo walks the whole batch back
  })
})

// Control: a TEXT-projected field must still produce exactly one step via the
// observer and must NOT be double-recorded by the new recordValue path.
describe('hypercms text field edits stay single-step (no double-record)', () => {
  let page, formRoot
  beforeEach(async () => { ({ page, formRoot } = await setupCms()) })
  afterEach(() => teardownCms())

  it('a text projection records exactly one undo step', async () => {
    const formInput = field(formRoot, 'products.0')
    expect(formInput, 'product 0 name field').to.exist
    formInput.value = 'P1-edited'
    formInput.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => undo.history.length >= 1)
    await new Promise((r) => setTimeout(r, 80))                 // let any stray second batch settle
    expect(undo.history.length).to.equal(1)
  })
})
