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

  it('REDO re-fires onChange with the REDONE data (data follows undo on redo too)', async () => {
    const formInput = inputFor(formRoot, 'name')
    type(formInput, 'AliceX')
    await waitFor(() => undo.history.length === 1)
    expect(changes.at(-1)).to.deep.equal({ name: 'AliceX' })

    undo.undo()
    await waitFor(() => panelInput.value === 'Alice')
    await waitFor(() => changes.at(-1) && changes.at(-1).name === 'Alice')
    expect(changes.at(-1)).to.deep.equal({ name: 'Alice' })   // undo re-fired with reverted data

    const beforeRedo = changes.length
    undo.redo()
    await waitFor(() => panelInput.value === 'AliceX')
    expect(panelInput.value).to.equal('AliceX')               // page value re-applied
    await waitFor(() => changes.length > beforeRedo)
    // The data-follows-undo contract must hold on REDO too: onChange re-fires
    // (re-extracted from the page in onRevert) with the redone record.
    expect(changes.at(-1)).to.deep.equal({ name: 'AliceX' })
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

  it('does NOT re-fire onChange on undo of a page change that leaves form data unchanged (fingerprint guard)', async () => {
    // Establish a known last-sent record: edit the @value field once so
    // ctx.lastData = { name: 'AliceX' } and onChange has fired for it.
    const formInput = inputFor(formRoot, 'name')
    type(formInput, 'AliceX')
    await waitFor(() => undo.history.length === 1)
    expect(changes.at(-1)).to.deep.equal({ name: 'AliceX' })

    // Now mutate a NON-ruled element on the page (the panel wrapper, not the
    // rule's .f-name input). The undo observer records this as its own step,
    // but it doesn't touch the only ruled field, so re-extracting after undo
    // yields the SAME { name: 'AliceX' } that was last sent.
    const panel = page.querySelector('#record-panel')
    panel.setAttribute('data-noise', '1')
    await waitFor(() => undo.history.length === 2)
    expect(undo.history.length).to.equal(2)

    const changeCountBeforeUndo = changes.length
    undo.undo()
    await waitFor(() => !panel.hasAttribute('data-noise'))
    expect(panel.hasAttribute('data-noise')).to.equal(false)    // the noise attr reverted
    // Give onRevert + the debounced observer refresh time to run, then assert
    // the stableStringify guard suppressed a duplicate onChange: the extracted
    // form data equals ctx.lastData, so no spurious PUT fires.
    await new Promise((r) => setTimeout(r, 120))
    expect(changes.length).to.equal(changeCountBeforeUndo)      // NO spurious onChange
    expect(panelInput.value).to.equal('AliceX')                 // ruled field untouched
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

// @checked is in events.js's UNOBSERVED_FIELD_PROPS, so a checkbox edit is a
// PROPERTY write (no MutationRecord) that hypercms records explicitly through
// recordValue — exactly like @value. Toggling the form checkbox must record ONE
// undo step, project `checked` onto the PAGE checkbox, and undo must revert the
// page checkbox AND re-fire onChange with the reverted boolean.
const CHECKED_PAGE_HTML = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "done": ".f-done@checked" }</script>
  <template data-hcms-tpl="done" save-remove>
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <input type="checkbox" class="hcms-input" data-hcms-field="done" />
      <div class="hcms-error" hidden></div>
    </label>
  </template>
  <div id="record-panel" hidden>
    <input class="f-done" type="checkbox" />
  </div>`

describe('hypercms @checked field edits + undo (real browser)', () => {
  let page, formRoot, pageBox, changes

  beforeEach(async () => {
    page = await fixture(html`<div id="page"></div>`)
    page.innerHTML = CHECKED_PAGE_HTML
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.Mutation = makeMutationShim(page)
    window.hyperclay.undo = undo
    changes = []
    undo.start({ scope: page, bindKeys: false, idleWindowMs: 50 })
    open({ pageRoot: page, onChange: (d) => changes.push(d) })
    undo.clear()
    formRoot = document.querySelector('[data-hcms-form-root]')
    pageBox = page.querySelector('.f-done')
  })

  afterEach(() => {
    try { undo.stop() } catch {}
    try { close() } catch {}
    if (window.hyperclay) { delete window.hyperclay.undo; delete window.hyperclay.Mutation }
  })

  it('records ONE undo step for a @checked toggle; undo reverts the page checked + re-fires onChange', async () => {
    const formBox = inputFor(formRoot, 'done')
    expect(formBox, 'form has a done checkbox field').to.exist
    expect(formBox.type).to.equal('checkbox')
    expect(pageBox.checked).to.equal(false)                     // starts unchecked

    formBox.checked = true
    formBox.dispatchEvent(new Event('change', { bubbles: true }))
    expect(pageBox.checked).to.equal(true)                      // projected to the page @checked PROPERTY
    await waitFor(() => undo.history.length === 1)
    expect(undo.history.map((c) => c.label)).to.deep.equal(['Edit'])
    expect(changes.at(-1)).to.deep.equal({ done: true })        // onChange fired on toggle (coerced boolean)

    const changeCountBeforeUndo = changes.length
    undo.undo()
    await waitFor(() => pageBox.checked === false)
    expect(pageBox.checked).to.equal(false)                     // page checkbox reverted
    await waitFor(() => changes.length > changeCountBeforeUndo)
    expect(changes.at(-1)).to.deep.equal({ done: false })       // PUT-on-undo: re-fired with reverted boolean

    undo.redo()
    await waitFor(() => pageBox.checked === true)
    expect(pageBox.checked).to.equal(true)                      // redo re-applies checked
    await waitFor(() => changes.at(-1) && changes.at(-1).done === true)
    expect(changes.at(-1)).to.deep.equal({ done: true })        // redo re-fires onChange with redone boolean
  })
})

// Array-item @value: events.js's resolveUnobservedProjection returns null when
// the field path has a numeric segment (the engine's per-item ctx isn't pageRoot,
// so a pageRoot.querySelector would target the wrong row), so hypercms records NO
// explicit recordValue step. The value STILL projects to the page via commit ->
// engine.apply.
//
// FINDING (code does not meet the stated "ZERO undo steps" contract for the
// single-field fixture): whether an undo step is recorded does NOT depend solely
// on the numeric-segment guard — it depends on the engine's listDiff similarity
// matching. listDiff (hyper-html-api engine/diff.js) reuses an existing DOM node
// only when the incoming item scores >= 0.5 similarity to it; otherwise it CLONES
// a fresh node to replace the item. For a SINGLE-field item shape, editing the
// one field drops similarity to 0, so listDiff replaces the node — and that
// childList replacement IS observed by hyper-undo's MutationObserver, recording
// ONE 'Edit' step. So the suggested fixture { "name": ".pname@value" } records
// ONE undo step, not zero. The two specs below assert the ACTUAL behavior of both
// cases (single-field -> 1 step via node clone; multi-field one-field edit -> 0
// steps via in-place match, which is where the recordValue skip is observable).
const ARRAY_VALUE_PAGE_HTML = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "products": [".product", { "name": ".pname@value" }] }</script>
  <div id="products">
    <div class="product"><input class="pname" value="P1" /></div>
    <div class="product"><input class="pname" value="P2" /></div>
  </div>`

// Two-field item: editing one field keeps similarity at 0.5 (>= the engine's
// SIMILARITY_THRESHOLD), so listDiff matches the row in place (no node clone) and
// no childList mutation reaches the observer. This isolates the numeric-segment
// guard: recordValue is skipped (numeric path) AND there is no observed mutation,
// so the array-item @value edit truly records ZERO undo steps here.
const ARRAY_VALUE_MULTI_PAGE_HTML = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "products": [".product", { "name": ".pname@value", "sku": ".sku@value" }] }</script>
  <div id="products">
    <div class="product"><input class="pname" value="P1" /><input class="sku" value="S1" /></div>
    <div class="product"><input class="pname" value="P2" /><input class="sku" value="S2" /></div>
  </div>`

function mountArrayPage(pageHtml) {
  return async () => {
    const page = await fixture(html`<div id="page"></div>`)
    page.innerHTML = pageHtml
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.Mutation = makeMutationShim(page)
    window.hyperclay.undo = undo
    const changes = []
    undo.start({ scope: page, bindKeys: false, idleWindowMs: 50 })
    open({ pageRoot: page, onChange: (d) => changes.push(d) })
    undo.clear()
    const formRoot = document.querySelector('[data-hcms-form-root]')
    return { page, formRoot, changes }
  }
}

const teardownArray = () => {
  try { undo.stop() } catch {}
  try { close() } catch {}
  if (window.hyperclay) { delete window.hyperclay.undo; delete window.hyperclay.Mutation }
}

const pname = (page, i) => page.querySelectorAll('#products .product .pname')[i]

describe('hypercms array-item @value edits skip the recordValue path (documented limitation)', () => {
  afterEach(teardownArray)

  it('single-field item: value APPLIES to the page, other row untouched, ONE step from engine node-clone (FINDING: not zero)', async () => {
    const { page, formRoot, changes } = await mountArrayPage(ARRAY_VALUE_PAGE_HTML)()
    expect(pname(page, 0).value).to.equal('P1')
    expect(pname(page, 1).value).to.equal('P2')

    const formInput = field(formRoot, 'products.0.name')
    expect(formInput, 'product 0 name field').to.exist

    type(formInput, 'P1-edited')
    // Re-query the page node: listDiff replaces the low-similarity row, so the
    // original input is detached. The VALUE still applies (the contract's
    // "value applies" half holds).
    await waitFor(() => pname(page, 0).value === 'P1-edited')
    expect(pname(page, 0).value).to.equal('P1-edited')          // the value APPLIES to the page @value
    expect(pname(page, 1).value).to.equal('P2')                 // the OTHER row is untouched

    await new Promise((r) => setTimeout(r, 120))
    // INTENDED contract is undo.history.length === 0. ACTUAL is 1 because the
    // single-field edit drops listDiff similarity below threshold, so the engine
    // clones a replacement node and the observer records that childList mutation.
    // Asserting ACTUAL with this note (per ground rules) rather than the intended
    // zero, since the divergence is real and surfaced as a finding.
    expect(undo.history.length).to.equal(1)                     // DIVERGES from intended (0); engine node-clone is observed
    expect(undo.history.map((c) => c.label)).to.deep.equal(['Edit'])
    expect(changes.at(-1)).to.deep.equal({ products: [{ name: 'P1-edited' }, { name: 'P2' }] })
  })

  it('single-field item: UNDO of the clone reverts cleanly (page + form restored, no orphan row, history empty)', async () => {
    const { page, formRoot, changes } = await mountArrayPage(ARRAY_VALUE_PAGE_HTML)()
    type(field(formRoot, 'products.0.name'), 'P1-edited')
    await waitFor(() => pname(page, 0).value === 'P1-edited')
    await waitFor(() => undo.history.length === 1)

    undo.undo()
    // page value restored on the re-attached original row
    await waitFor(() => pname(page, 0).value === 'P1')
    expect(pname(page, 0).value).to.equal('P1')
    expect(pname(page, 1).value).to.equal('P2')                  // the other row is intact
    // the cloned replacement is gone: exactly two rows, no orphan/duplicate
    expect(page.querySelectorAll('#products .product').length).to.equal(2)
    // the focused form field re-syncs to the reverted value (ignoreActiveValue:false on undo)
    await waitFor(() => field(formRoot, 'products.0.name').value === 'P1')
    expect(field(formRoot, 'products.0.name').value).to.equal('P1')
    // history is back to baseline and the re-fired onChange carries the reverted data
    expect(undo.history.length).to.equal(0)
    await waitFor(() => {
      const last = changes.at(-1)
      return !!last && JSON.stringify(last) === JSON.stringify({ products: [{ name: 'P1' }, { name: 'P2' }] })
    })
  })

  it('multi-field item, one-field edit: value APPLIES in place, other row untouched, ZERO undo steps (recordValue skip isolated)', async () => {
    const { page, formRoot, changes } = await mountArrayPage(ARRAY_VALUE_MULTI_PAGE_HTML)()
    expect(pname(page, 0).value).to.equal('P1')
    expect(pname(page, 1).value).to.equal('P2')

    const formInput = field(formRoot, 'products.0.name')
    expect(formInput, 'product 0 name field').to.exist

    type(formInput, 'P1-edited')
    await waitFor(() => pname(page, 0).value === 'P1-edited')
    expect(pname(page, 0).value).to.equal('P1-edited')          // the value APPLIES (in-place match)
    expect(pname(page, 1).value).to.equal('P2')                 // the OTHER row is untouched

    await new Promise((r) => setTimeout(r, 120))
    // Here listDiff matches the row in place (similarity 0.5 >= threshold), so
    // there is no node-replacement mutation. With recordValue also skipped for
    // the numeric path, the array-item @value edit records ZERO undo steps —
    // this is the case where the numeric-segment guard's intended skip is the
    // ONLY thing that could have recorded a step, and it correctly does not.
    expect(undo.history.length).to.equal(0)                     // intentional skip — no undo step
    expect(changes.at(-1)).to.deep.equal({
      products: [{ name: 'P1-edited', sku: 'S1' }, { name: 'P2', sku: 'S2' }],
    })
  })
})
