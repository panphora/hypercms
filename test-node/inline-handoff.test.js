import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, currentView, refresh, api } from '../src/hypercms.js'
import { injectToggle } from '../src/toggle.js'

// There is no drawer (§3.1.1). A ruled field with no visual representation is
// counted in the session bar and reached through one tap out to the sidebar,
// and the count comes off the same anchorability floor the handles clear rather
// than a second rule that could disagree with it.
//
// jsdom has no layout, so every getBoundingClientRect() answers 0x0 and nothing
// would be anchorable. Each element that is supposed to have a place on the page
// is given the box a browser would report.

const HIDDEN_FIELDS = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  {
    "title": ".title",
    "published": ".meta-published@data-published",
    "color": ".meta-color@data-color"
  }
  </script>
  <h1 class="title">Hello</h1>
  <span class="meta-published" data-published="true" hidden></span>
  <span class="meta-color" data-color="red" hidden></span>
</body></html>`

const VISIBLE_ONLY = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello</h1>
</body></html>`

function setBox(el, width, height) {
  el.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
  })
  return el
}

const handoff = (doc) => doc.querySelector('.hcms-inline-handoff')
const handoffText = (doc) => doc.querySelector('.hcms-inline-handoff-count').textContent

test('handoff: the bar counts the ruled fields with no place on the page', () => {
  if (isOpen()) close()
  const dom = loadPage(HIDDEN_FIELDS)
  const doc = dom.window.document
  setBox(doc.querySelector('.title'), 300, 40)
  open({ view: 'inline' })
  try {
    assert.equal(handoff(doc).hidden, false)
    assert.equal(handoffText(doc), "2 fields aren't visible right now.")
    assert.equal(
      handoff(doc).querySelector('[data-hcms-open-view]').getAttribute('data-hcms-open-view'),
      'sidebar'
    )
  } finally {
    close()
  }
  reset(dom)
})

// Live, not computed once: the observer cannot tell a permanently hidden
// metadata span from a closed tab panel, so opening one has to drop the count.
test('handoff: revealing a field drops the count on the next refresh', () => {
  if (isOpen()) close()
  const dom = loadPage(HIDDEN_FIELDS)
  const doc = dom.window.document
  setBox(doc.querySelector('.title'), 300, 40)
  open({ view: 'inline' })
  try {
    assert.equal(handoffText(doc), "2 fields aren't visible right now.")
    setBox(doc.querySelector('.meta-published'), 120, 20)
    refresh()
    assert.equal(handoffText(doc), "1 field isn't visible right now.")
    assert.equal(handoff(doc).hidden, false)
  } finally {
    close()
  }
  reset(dom)
})

test('handoff: at zero the bar says nothing at all, not "0 fields"', () => {
  if (isOpen()) close()
  const dom = loadPage(VISIBLE_ONLY)
  const doc = dom.window.document
  setBox(doc.querySelector('.title'), 300, 40)
  open({ view: 'inline' })
  try {
    assert.equal(handoff(doc).hidden, true)
    assert.equal(handoffText(doc), '')
  } finally {
    close()
  }
  reset(dom)
})

// The switch runs through open({ view }), which carries the session's options
// across it, so the sidebar comes up on the same page root — not on
// document.body with the default rules tag. The decoy heading is what makes
// that assertion able to fail: it sits earlier in the document, so a session
// retargeted at <body> reads it instead.
const SCOPED = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title", "published": ".meta-published@data-published" }
  </script>
  <h1 class="title">Decoy</h1>
  <div id="scope">
    <h1 class="title">Hello</h1>
    <span class="meta-published" data-published="true" hidden></span>
  </div>
</body></html>`

test('handoff: the button hands the same session to the sidebar', () => {
  if (isOpen()) close()
  const dom = loadPage(SCOPED)
  const doc = dom.window.document
  const pageRoot = doc.getElementById('scope')
  setBox(pageRoot.querySelector('.title'), 300, 40)
  open({ view: 'inline', pageRoot })
  try {
    assert.equal(handoff(doc).hidden, false, 'the hidden field is what raises the offer')
    handoff(doc).querySelector('[data-hcms-open-view]').click()
    assert.equal(currentView(), 'sidebar')
    assert.equal(isOpen(), true)
    assert.equal(doc.querySelector('hypercms-inline'), null, 'the inline host is gone')
    assert.equal(api.getData().title, 'Hello', 'the sidebar reads the page root the session opened with')
  } finally {
    close()
  }
  reset(dom)
})

// hcms-session-open means "a session of either kind is open". body.hcms-open is
// the sidebar's page shift and says nothing about an inline session, which is
// why nothing may read open state off it.
test('session class: hcms-session-open is set for both views and dropped on close', () => {
  if (isOpen()) close()
  const dom = loadPage(VISIBLE_ONLY)
  const doc = dom.window.document
  for (const view of ['sidebar', 'inline']) {
    open({ view })
    assert.equal(doc.body.classList.contains('hcms-session-open'), true, `missing for ${view}`)
    close()
    assert.equal(doc.body.classList.contains('hcms-session-open'), false, `left behind by ${view}`)
  }
  // And it is additive: the sidebar's own page shift keeps its meaning.
  open({ view: 'inline' })
  assert.equal(doc.body.classList.contains('hcms-open'), false, 'an inline session shifts nothing')
  close()
  reset(dom)
})

test('toggle: the main button closes an inline session', async () => {
  if (isOpen()) close()
  const dom = loadPage(VISIBLE_ONLY)
  const doc = dom.window.document
  setBox(doc.querySelector('.title'), 300, 40)
  const host = injectToggle({ open, close, isOpen, views: ['sidebar', 'inline'] }, doc)

  open({ view: 'inline' })
  assert.equal(
    host.getAttribute('data-hcms-session'),
    'open',
    'the label follows the session, and an inline session sets no body class to read'
  )
  assert.equal(doc.body.classList.contains('hcms-open'), false)

  host.querySelector('.hcms-toggle__main').click()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(currentView(), null, 'the button closed whichever view was up')
  assert.equal(isOpen(), false)
  assert.equal(host.hasAttribute('data-hcms-session'), false)
  reset(dom)
})
