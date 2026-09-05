import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engine } from 'hyper-html-api'
import HyperMorph from 'hyper-morph'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, refresh, api } from '../src/hypercms.js'
import { state } from '../src/session.js'
import { coerceBooleans, extractFormData, stableStringify } from '../src/events.js'
import { upgradeInlineTextRules } from '../src/enhance.js'
import { resolveTargets } from '../src/targets.js'
import { cleanRichClayFromSnapshot } from '../src/richclay-bridge.js'

// richclay is not a dependency of hypercms — the page brings it — so the editor
// below stands in for it. It reproduces the three things this phase actually
// depends on: the attribute writes the real one makes on an authored page
// element, its refusal contract (an instance that never activates), and squire
// as the change signal.
//
// Kept faithful where it matters: the marker is stamped BEFORE the refusal is
// decided (richclay's ensureMarker runs in the constructor either way), so a
// refused target proves hypercms cleans up after a bind that never happened.
const HTML_NS = 'http://www.w3.org/1999/xhtml'
const REFUSED_TAGS = new Set([
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP',
  'SCRIPT', 'STYLE', 'TEXTAREA', 'TITLE', 'IFRAME', 'NOSCRIPT', 'XMP', 'TEMPLATE',
])

function emitter() {
  const listeners = new Map()
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
    emit(type) { for (const fn of [...(listeners.get(type) || [])]) fn({ type }) },
    count(type) { return listeners.get(type)?.size || 0 },
  }
}

// richclay's provenance rule, from removeRuntimeState (hyperclay.js:355-361):
// data-richclay comes off only when data-richclay-runtime-marker says richclay
// invented it, so an author's own opt-in survives every strip.
function unmarkRichClay(el) {
  if (el.getAttribute('data-richclay-runtime-marker') === 'true') {
    el.removeAttribute('data-richclay')
  }
  el.removeAttribute('data-richclay-runtime-marker')
}

function installRichClay(win) {
  const made = []
  class FakeRichClay {
    constructor(el, options = {}) {
      this.element = el
      this.options = options
      this.squire = emitter()
      this.destroyed = false
      this.active = false
      made.push(this)
      // Both attributes together, the way ensureMarker writes them
      // (richclay.js:818-835): the marker is what says richclay invented this
      // opt-in, and every strip below removes data-richclay only when it is set.
      el.setAttribute('data-richclay-runtime-marker', 'true')
      el.setAttribute('data-richclay', '')
      this.unsupported =
        el.namespaceURI !== HTML_NS || REFUSED_TAGS.has((el.tagName || '').toUpperCase())
      if (this.unsupported) return
      el.setAttribute('contenteditable', 'true')
      el.classList.add('richclay-inline')
      // The two setupEditorAttributes writes anything outside richclay reads
      // (richclay.js:837-873): the "there is a live editor here" flag, and the
      // marker that keeps the page's undo stack out of a region Squire owns.
      el.setAttribute('data-richclay-active', 'true')
      el.setAttribute('no-undo', '')
      this.active = true
    }
    focus() {
      this.element.focus?.()
    }
    destroy() {
      this.destroyed = true
      this.active = false
      this.element.removeAttribute('contenteditable')
      this.element.removeAttribute('data-richclay-active')
      this.element.removeAttribute('no-undo')
      unmarkRichClay(this.element)
      this.element.classList.remove('richclay-inline')
      if (this.element.getAttribute('class') === '') this.element.removeAttribute('class')
    }
    static stripFromClone(docEl) {
      for (const el of docEl.querySelectorAll('[data-richclay]')) {
        el.removeAttribute('contenteditable')
        el.removeAttribute('data-richclay-active')
        el.removeAttribute('no-undo')
        el.classList.remove('richclay-inline')
        unmarkRichClay(el)
      }
    }
  }
  win.richclay = { RichClay: FakeRichClay }
  return { made, get last() { return made[made.length - 1] } }
}

// The parts of hyper-undo this path touches, with its four load-bearing rules:
// recordValue is a no-op while the recorder is paused (scope.js:190), isPaused
// reports that state (scope.js:297), a fresh record clears the redo stack
// (pushCommit, scope.js:126), and an undo replays the primitive in reverse and
// then announces itself OUTSIDE its own pause (scope.js:242-252).
function installUndo(win) {
  const records = []
  const redos = []
  const handlers = new Map()
  let depth = 0
  const undo = {
    records,
    redos,
    pause() { depth++ },
    resume() { depth = Math.max(0, depth - 1) },
    get isPaused() { return depth > 0 },
    get canRedo() { return redos.length > 0 },
    commitCaptured() {},
    discardCaptured() {},
    recordValue(target, { prop = 'value', oldValue, newValue } = {}) {
      if (depth > 0) return
      if (!target || oldValue === newValue) return
      records.push({ target, prop, oldValue, newValue })
      redos.length = 0
    },
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set())
      handlers.get(name).add(fn)
    },
    off(name, fn) { handlers.get(name)?.delete(fn) },
    undo() {
      const primitive = records.pop()
      if (!primitive) return
      depth++
      try { primitive.target[primitive.prop] = primitive.oldValue } finally { depth-- }
      redos.push(primitive)
      for (const fn of [...(handlers.get('undo') || [])]) fn()
    },
  }
  win.hyperclay.undo = undo
  return undo
}

function rulesTag(t) {
  return t.doc.querySelector('script[data-rules-name="cms"]')
}

function page(rules, body) {
  return `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">${rules}</script>
  ${body}
</body></html>`
}

// .title holds markup, .lede does not; the first product row holds markup and
// the second does not, which is the case the sidebar's narrow upgrade cannot
// answer. The <svg><text> is a text target richclay refuses.
const TEXT = page(
  `{
    "title": ".title",
    "lede": ".lede",
    "label": "text.label",
    "products": [".product", { "name": ".product-name" }]
  }`,
  `<h1 class="title">Hello <em>you</em></h1>
  <p class="lede">Plain lede</p>
  <svg><text class="label">Label</text></svg>
  <div class="grid">
    <div class="product"><span class="product-name">P1 <b>bold</b></span></div>
    <div class="product"><span class="product-name">P2</span></div>
  </div>`
)

// Written across three lines on purpose (plan §3.2.1): @innerHTML keeps the
// indentation the text adapter trims, so the page and the form only agree if
// both read the same projection.
const PRETTY = page(
  `{ "title": ".title" }`,
  `<h1 class="title">
    Hello <em>you</em>
  </h1>`
)

const ENGINE_OPTS = { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }

// The one invariant everything else assumes: what the form extracts and what
// the page extracts are the same bytes. Drift here becomes a write onto the
// element the person is typing in, and it is invisible until it does.
function assertCoherent(when) {
  const ctx = state.ctx
  const pageData = coerceBooleans(engine.extract(ctx.pageRoot, ctx.pageRules, ENGINE_OPTS), ctx.pageRules)
  assert.equal(
    stableStringify(extractFormData(ctx)),
    stableStringify(pageData),
    `the form and the page disagree ${when}`
  )
}

function boot(html = TEXT, opts = {}) {
  if (isOpen()) close()
  const dom = loadPage(html)
  const richclay = installRichClay(dom.window)
  open({ view: 'inline', ...opts })
  return { dom, win: dom.window, doc: dom.window.document, richclay }
}

function click(t, el) {
  el.dispatchEvent(new t.win.MouseEvent('click', { bubbles: true, cancelable: true }))
}

function blur(t, el) {
  el.dispatchEvent(new t.win.Event('blur'))
}

// The instance currently driving this element. Always the LAST one made for it:
// a rebind leaves the destroyed editor in `made`, ahead of the live one.
function editorFor(t, el) {
  return t.richclay.made.findLast((e) => e.element === el)
}

// Type through the editor: richclay writes the page element, then squire
// announces it. Both halves matter — a commit driven by anything but squire's
// signal would miss every toolbar command.
function type(t, el, html) {
  const editor = editorFor(t, el)
  assert.ok(editor, 'nothing is bound to this element')
  el.innerHTML = html
  editor.squire.emit('input')
}

test('inline text: the form and the page agree at mount, and again after a text commit', () => {
  const t = boot()
  try {
    assertCoherent('at mount')

    const title = t.doc.querySelector('.title')
    click(t, title)
    type(t, title, 'Hello <em>world</em>')

    assertCoherent('after an inline text change')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: a pretty-printed heading extracts the same bytes into both trees', () => {
  const t = boot(PRETTY)
  try {
    // The whole point: @innerHTML does not trim, so this is where a form that
    // read the value differently would show up as a fingerprint that never
    // matches and an idle commit on every unrelated change.
    assert.match(api.getData().title, /^\n\s+Hello <em>you<\/em>\n\s+$/)
    assertCoherent('on a pretty-printed heading')
    assert.equal(state.ctx.lastFingerprint, stableStringify(api.getData()))
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: nothing is bound at mount; the first click on a text target binds it', () => {
  const t = boot()
  try {
    const title = t.doc.querySelector('.title')
    assert.equal(title.hasAttribute('contenteditable'), false, 'the page is untouched at mount')
    assert.equal(title.hasAttribute('data-hcms-bound'), false)

    click(t, title)

    assert.equal(t.richclay.made.length, 1, 'one editor, built by the click')
    assert.equal(t.richclay.last.element, title)
    assert.equal(t.richclay.last.active, true)
    assert.equal(title.getAttribute('contenteditable'), 'true')
    assert.equal(t.richclay.last.options.inline, true)
    assert.equal(t.richclay.last.options.hyperclay, false)
    // A heading is one line by definition.
    assert.equal(t.richclay.last.options.singleLine, true)

    // A paragraph is not, so it does not get the single-line guard.
    click(t, t.doc.querySelector('.lede'))
    assert.equal(t.richclay.last.options.singleLine, undefined)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: clicking a bound target again reuses its editor', () => {
  const t = boot()
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    click(t, title)
    click(t, title)

    assert.equal(t.richclay.made.length, 1, 'one editor for the whole session')
    assert.equal(t.richclay.last.destroyed, false)
    assert.equal(t.richclay.last.squire.count('input'), 1, 'and one commit subscription')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: a target richclay refuses falls back to the popover', () => {
  const t = boot()
  try {
    const label = t.doc.querySelector('text.label')
    const pop = t.doc.querySelector('.hcms-inline-pop')
    const formRoot = t.doc.querySelector('[data-hcms-form-root]')
    assert.equal(pop.hidden, true)

    click(t, label)

    assert.equal(t.richclay.last.unsupported, true, 'richclay refused this root')
    assert.equal(t.richclay.last.destroyed, true, 'and the refused instance was thrown away')
    assert.equal(label.hasAttribute('data-hcms-bound'), false, 'nothing was marked as bound')
    assert.equal(label.hasAttribute('data-richclay'), false, 'and no marker was left behind')

    assert.equal(pop.hidden, false, 'the popover opened instead')
    const leaf = formRoot.querySelector('[data-hcms-path="label"]')
    assert.equal(leaf.classList.contains('is-hcms-inline-active'), true)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: data-hcms-bound marks the live element while bound, and comes off with the session', () => {
  const t = boot()
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    assert.equal(title.hasAttribute('data-hcms-bound'), true)

    close()

    // The bridge only unmarks the snapshot CLONE. A marker left on the page
    // would make the next snapshot strip an element hypercms no longer owns —
    // an authored contenteditable, say.
    assert.equal(title.hasAttribute('data-hcms-bound'), false)
    assert.equal(title.hasAttribute('contenteditable'), false, 'and the editor is gone with it')
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

test('inline text: every change commits and notifies, once each', () => {
  const changes = []
  const t = boot(TEXT, { onChange: (data, info) => changes.push({ data, info }) })
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    assert.deepEqual(changes, [], 'binding on its own changes nothing')

    type(t, title, 'Hello <em>world</em>')
    assert.equal(changes.length, 1, 'one change, one notification')
    assert.equal(changes[0].data.title, 'Hello <em>world</em>')
    assert.equal(changes[0].info.path, 'title')
    assert.equal(changes[0].info.structural, false)
    // The form is where every later commit reads from, so it has to hold the
    // new value; a stale leaf puts the old heading back on the next edit.
    assert.equal(api.getData().title, 'Hello <em>world</em>')

    // The two halves of a change, split apart: the editor writes the page, and
    // only then does squire announce it. The <em> captured in between is the
    // node the caret would be sitting in.
    const editor = t.richclay.made.find((e) => e.element === title)
    title.innerHTML = 'Hello <em>again</em>'
    const em = title.querySelector('em')
    editor.squire.emit('input')

    assert.equal(changes.length, 2, 'the second change notifies too, not just the first')
    assert.equal(changes[1].data.title, 'Hello <em>again</em>')
    assert.equal(title.querySelector('em'), em, 'the commit did not rebuild the element under the caret')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: an array row commits through the row rule, not the whole list', () => {
  const changes = []
  const t = boot(TEXT, { onChange: (data) => changes.push(data) })
  try {
    const first = t.doc.querySelector('.product .product-name')
    click(t, first)
    type(t, first, 'P1 <b>bolder</b>')

    assert.equal(changes.length, 1)
    assert.deepEqual(changes[0].products, [{ name: 'P1 <b>bolder</b>' }, { name: 'P2' }])
    assertCoherent('after an array-row text change')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: the edit session records one undo primitive, and undoing it restores page and form', () => {
  const t = boot()
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    const original = title.innerHTML
    click(t, title)
    type(t, title, 'Hello <em>world</em>')
    assert.deepEqual(undo.records, [], 'nothing is recorded mid-session')

    blur(t, title)
    assert.equal(undo.records.length, 1, 'one primitive for the whole session')
    assert.equal(undo.records[0].target, title)
    assert.equal(undo.records[0].prop, 'innerHTML')
    assert.equal(undo.records[0].oldValue, original)
    assert.equal(undo.records[0].newValue, 'Hello <em>world</em>')

    undo.undo()

    assert.equal(title.innerHTML, original, 'the page is back')
    assert.equal(api.getData().title, original, 'and so is the form')
    assertCoherent('after undoing an inline text edit')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: the inline view builds no richclay instances for its form fields; the sidebar does', () => {
  const t = boot()
  try {
    const formRoot = t.doc.querySelector('[data-hcms-form-root]')
    const fields = formRoot.querySelectorAll('[contenteditable][data-hcms-field]')
    assert.ok(fields.length >= 2, 'the form really does carry rich-text fields to bind')
    assert.equal(t.richclay.made.length, 0, 'and not one of them was bound')
    // Each instance installs five document-level capture listeners that run
    // element.contains(event.target) on every keydown, beforeinput, cut, paste
    // and drop, for fields this view never focuses.

    close()
    open()
    assert.ok(t.richclay.made.length > 0, 'the sidebar still binds them: its form IS the editor')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: a text target with no richclay on the page falls back to the popover', () => {
  if (isOpen()) close()
  const dom = loadPage(TEXT)
  open({ view: 'inline' })
  try {
    const title = dom.window.document.querySelector('.title')
    const pop = dom.window.document.querySelector('.hcms-inline-pop')
    title.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

    assert.equal(title.hasAttribute('contenteditable'), false, 'nothing to bind with')
    assert.equal(pop.hidden, false, 'so the field is still editable, through the popover')
  } finally {
    close()
  }
  reset(dom)
})

// ---- the wider upgrade -------------------------------------------------------

test('upgradeInlineTextRules: one row holding markup upgrades the rule for every row', () => {
  const dom = loadPage(TEXT)
  try {
    const rules = upgradeInlineTextRules(
      { products: ['.product', { name: '.product-name' }] },
      dom.window.document.body
    )
    assert.equal(rules.products[0], '.product')
    assert.equal(rules.products[1].name, '.product-name@innerHTML')
  } finally {
    reset(dom)
  }
})

test('upgradeInlineTextRules: a row rule no row holds markup for is left alone', () => {
  const dom = loadPage(page(
    '{}',
    `<div class="product"><span class="product-name">P1</span></div>
     <div class="product"><span class="product-name">P2</span></div>`
  ))
  try {
    const rules = upgradeInlineTextRules(
      { products: ['.product', { name: '.product-name' }] },
      dom.window.document.body
    )
    assert.equal(rules.products[0], '.product')
    assert.equal(rules.products[1].name, '.product-name')
  } finally {
    reset(dom)
  }
})

// The child in each fixture below is the wrapper squire puts around the content
// of a block it binds. A plain paragraph grows one the instant it is clicked, so
// the live DOM stops being evidence of what the author wrote and the marker's
// value is read instead.
test('upgradeInlineTextRules: a bound plain element holding squire\'s wrapper does not upgrade its rule', () => {
  const dom = loadPage(page(
    '{}',
    '<div class="tagline" data-hcms-bound="plain"><div>One rules tag, two views.</div></div>'
  ))
  try {
    const rules = upgradeInlineTextRules({ tagline: '.tagline' }, dom.window.document.body)
    assert.equal(rules.tagline, '.tagline')
  } finally {
    reset(dom)
  }
})

test('upgradeInlineTextRules: the same element unbound does upgrade, so it is the marker that decides', () => {
  const dom = loadPage(page(
    '{}',
    '<div class="tagline"><div>One rules tag, two views.</div></div>'
  ))
  try {
    const rules = upgradeInlineTextRules({ tagline: '.tagline' }, dom.window.document.body)
    assert.equal(rules.tagline, '.tagline@innerHTML')
  } finally {
    reset(dom)
  }
})

// The other half: a marker reading 'rich' keeps upgrading on every later
// refresh, so author markup is never flattened back to textContent mid-session.
test('upgradeInlineTextRules: a bound rich element keeps its upgrade', () => {
  const dom = loadPage(page(
    '{}',
    '<div class="tagline" data-hcms-bound="rich"><div>One rules tag, <b>two</b> views.</div></div>'
  ))
  try {
    const rules = upgradeInlineTextRules({ tagline: '.tagline' }, dom.window.document.body)
    assert.equal(rules.tagline, '.tagline@innerHTML')
  } finally {
    reset(dom)
  }
})

test('upgradeInlineTextRules: a bound plain row is ignored, an unbound row holding markup still upgrades', () => {
  const dom = loadPage(page(
    '{}',
    `<div class="product"><span class="product-name" data-hcms-bound="plain"><div>P1</div></span></div>
     <div class="product"><span class="product-name">P2 <b>bold</b></span></div>`
  ))
  try {
    const rules = upgradeInlineTextRules(
      { products: ['.product', { name: '.product-name' }] },
      dom.window.document.body
    )
    assert.equal(rules.products[0], '.product')
    assert.equal(rules.products[1].name, '.product-name@innerHTML')
  } finally {
    reset(dom)
  }
})

test('inline: the session binds array rows through @innerHTML, which the sidebar does not', () => {
  const t = boot()
  try {
    assert.equal(api.getData().products[0].name, 'P1 <b>bold</b>', 'the row kept its markup')
    assert.equal(api.getData().title, 'Hello <em>you</em>')
    assert.equal(api.getData().lede, 'Plain lede', 'a row-free plain rule stays plain')

    close()
    open()
    assert.equal(
      api.getData().products[0].name,
      'P1 bold',
      'the sidebar keeps the narrow upgrade: it never looks inside an array'
    )
  } finally {
    close()
  }
  reset(t.dom)
})

// Squire normalises whatever markup it is handed, and hypercms does not get to
// opt out. Measured in Chrome against the real richclay: binding
//   <h1 class="page-title">A page that edits <em>itself</em></h1>
// left the live element, and the saved file, holding
//   <h1 class="page-title"><div>A page that edits <i>itself</i></div></h1>
// after a click that typed nothing. The stub above deliberately does not do
// this, or every other test in this file would be asserting Squire's behaviour
// instead of hypercms's. These two are the ones about it.
function bootNormalizing() {
  if (isOpen()) close()
  const dom = loadPage(TEXT)
  const richclay = installRichClay(dom.window)
  const Base = dom.window.richclay.RichClay
  class Normalizing extends Base {
    constructor(el, options) {
      super(el, options)
      if (this.unsupported) return
      el.innerHTML = `<div>${el.innerHTML.replace(/<(\/?)em>/g, '<$1i>')}</div>`
    }
  }
  dom.window.richclay = { RichClay: Normalizing }
  open({ view: 'inline' })
  return { dom, win: dom.window, doc: dom.window.document, richclay }
}

test('inline text: a session that edits nothing leaves the markup as the author wrote it', () => {
  const t = bootNormalizing()
  try {
    const title = t.doc.querySelector('.title')
    const authored = title.innerHTML
    assert.equal(authored, 'Hello <em>you</em>', 'the fixture is the author\'s markup')

    click(t, title)
    assert.equal(
      title.innerHTML,
      '<div>Hello <i>you</i></div>',
      'the editor really did rewrite it on bind'
    )

    close()

    assert.equal(
      title.innerHTML,
      authored,
      'reading a heading and leaving must not rewrite the document'
    )
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

test('inline text: a session that did edit keeps the edit, normalisation and all', () => {
  const t = bootNormalizing()
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    type(t, title, '<div>Hello <i>world</i></div>')

    close()

    assert.equal(
      title.innerHTML,
      '<div>Hello <i>world</i></div>',
      'someone who edited keeps what they typed'
    )
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

// ---- surviving a live-sync morph ---------------------------------------------

// Live sync keys on data-id / id (clayjs/src/sync/live-sync.js:1276), so both
// text targets here carry one: with a key the bound element is re-synced in
// place, and changing that key is how a peer's copy replaces it outright.
const SYNCED = page(
  `{ "title": ".title", "lede": ".lede" }`,
  `<h1 class="title" id="hero">Hello <em>you</em></h1>
  <p class="lede" id="sub">Plain lede</p>`
)

// The morph half of a live sync, with the options clayjs applies
// (live-sync.js:1276). The incoming copy is this document's own snapshot — clean
// because cleanRichClayFromSnapshot strips the editor out of it, which is
// exactly the hook hypercms installs at bind time — morphed back over the live
// tree. The CMS host is left in the copy on purpose: this is a test about the
// binding, not about the chrome a real snapshot removes.
function morphFromPeer(t, mutate, { clean = true } = {}) {
  const incoming = t.doc.documentElement.cloneNode(true)
  if (clean) cleanRichClayFromSnapshot(incoming, t.win)
  mutate?.(incoming)
  HyperMorph.morph(t.doc.documentElement, incoming, {
    morphStyle: 'outerHTML',
    ignoreActiveValue: true,
    head: { style: 'merge' },
    key: (el) => (el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('id'))) || null,
  })
}

// The signal the framework emits once the bytes have landed, which is what
// hypercms subscribes to.
function livesyncApplied(t) {
  t.doc.dispatchEvent(
    new t.win.CustomEvent('hyperclay:livesync-applied', { detail: { seq: 1 } })
  )
}

test('inline text: a live-sync morph strips the binding off the page element, and the refresh puts it back', () => {
  const changes = []
  const t = boot(SYNCED, { onChange: (data) => changes.push(data) })
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    type(t, title, 'Hello <em>world</em>')
    assert.equal(changes.length, 1)

    morphFromPeer(t)

    // The premise, measured rather than assumed: the incoming copy is clean
    // because our own snapshot hook made it clean, so the morph re-syncs every
    // attribute richclay wrote straight back off the live element.
    assert.ok(t.doc.contains(title), 'the node itself survived the morph')
    assert.equal(title.hasAttribute('data-hcms-bound'), false, 'and lost the marker')
    assert.equal(title.hasAttribute('contenteditable'), false, 'and stopped being editable')
    assert.equal(title.hasAttribute('data-richclay'), false)

    livesyncApplied(t)

    assert.equal(title.getAttribute('data-hcms-bound'), 'rich', 'the refresh bound it again')
    assert.equal(title.getAttribute('contenteditable'), 'true')
    assert.equal(title.getAttribute('data-richclay'), '')

    type(t, title, 'Hello <em>again</em>')
    assert.equal(changes.length, 2, 'and typing into it still commits')
    assert.equal(changes[1].title, 'Hello <em>again</em>')
    assert.equal(api.getData().title, 'Hello <em>again</em>')
    assertCoherent('after a live-sync morph rebound the heading')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: a morph that replaces the node drops the binding instead of leaving a live editor on it', () => {
  const changes = []
  const t = boot(SYNCED, { onChange: (data) => changes.push(data) })
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    type(t, title, 'Mine')
    const editor = editorFor(t, title)

    // No key match, so the peer's heading is not morphed onto ours — it takes
    // its place, and the editor's root is detached.
    morphFromPeer(t, (incoming) => {
      const heading = incoming.querySelector('.title')
      heading.setAttribute('id', 'hero-2')
      heading.innerHTML = 'Theirs'
    })
    assert.equal(t.doc.contains(title), false, 'the node was replaced outright')

    livesyncApplied(t)

    assert.equal(editor.destroyed, true, 'no live editor is left on the detached node')
    assert.equal(t.richclay.made.filter((e) => e.element === title).length, 1, 'and nothing was rebuilt on it')

    // The detached editor still has a squire to announce with. Nothing may
    // reach the page through it: the peer's heading is the one on the page now.
    const before = changes.length
    editor.squire.emit('input')
    assert.equal(changes.length, before, 'a signal from the dropped editor commits nothing')
    assert.equal(t.doc.querySelector('.title').innerHTML, 'Theirs', "the peer's copy stands")
    assert.equal(api.getData().title, 'Theirs')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: what was typed before the sync lands as one undo primitive', async () => {
  const t = boot(SYNCED)
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    const original = title.innerHTML
    click(t, title)
    type(t, title, 'Hello <em>world</em>')
    assert.deepEqual(undo.records, [], 'nothing is recorded mid-session')

    // Inside the pause, because that is where the real event arrives: clayjs
    // dispatches clay:sync-applied from inside its mutation pause, which pauses
    // undo too (live-sync.js:1357, mutation.js:132). Fired outside it, this
    // test passed against a recordUndo that dropped the record on the floor.
    undo.pause()
    morphFromPeer(t)
    livesyncApplied(t)
    undo.resume()
    await Promise.resolve()

    assert.equal(undo.records.length, 1, 'the sync closed the session that was open')
    assert.equal(undo.records[0].target, title)
    assert.equal(undo.records[0].prop, 'innerHTML')
    assert.equal(undo.records[0].oldValue, original)
    assert.equal(undo.records[0].newValue, 'Hello <em>world</em>')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: a rebind does not move the caret into an element that did not have it', () => {
  const t = boot(SYNCED)
  try {
    const title = t.doc.querySelector('.title')
    const lede = t.doc.querySelector('.lede')
    // Both bound, the caret in the heading. The heading is bound FIRST, so a
    // rebind that focuses every element it touches would leave the caret in the
    // paragraph instead.
    click(t, title)
    click(t, lede)
    click(t, title)
    assert.equal(t.doc.activeElement, title, 'the caret is in the heading')
    const ledeEditor = editorFor(t, lede)

    morphFromPeer(t)
    livesyncApplied(t)

    assert.notEqual(editorFor(t, lede), ledeEditor, 'the paragraph really was rebound too')
    assert.equal(t.doc.activeElement, title, 'and the sync left the caret where it was')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: an element that came through the morph with its binding intact is not rebuilt', () => {
  const t = boot(SYNCED)
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    const editor = t.richclay.last

    // A copy that still carries the editor's own attributes: the morph reaches
    // the element and leaves the binding whole. A whole binding is not
    // something to tear down and build again.
    morphFromPeer(t, null, { clean: false })
    assert.equal(title.getAttribute('data-hcms-bound'), 'rich', 'the morph left the marker alone')

    livesyncApplied(t)

    assert.equal(t.richclay.made.length, 1, 'no second editor was built')
    assert.equal(t.richclay.last, editor, 'the same instance is still driving the element')
    assert.equal(editor.destroyed, false)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: an undo that reverts the binding attributes rebinds too', () => {
  const t = boot(SYNCED)
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    click(t, title)
    type(t, title, 'Hello <em>world</em>')
    blur(t, title)
    const editor = editorFor(t, title)

    // What replaying richclay's own attribute writes in reverse leaves behind:
    // the element is still on the page, the editor is still pointing at it, and
    // the page no longer calls it editable.
    title.removeAttribute('contenteditable')
    title.removeAttribute('data-richclay')
    title.removeAttribute('data-hcms-bound')
    undo.undo()

    assert.equal(title.getAttribute('data-hcms-bound'), 'rich', 'the undo refresh bound it again')
    assert.equal(title.getAttribute('contenteditable'), 'true')
    assert.equal(editor.destroyed, true, 'and the editor that was pointing at it is gone')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline text: an undo does not record a primitive describing its own revert', () => {
  const t = boot(SYNCED)
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    click(t, title)
    type(t, title, 'Hello <em>world</em>')
    blur(t, title)
    assert.equal(undo.records.length, 1, 'the edit session recorded one primitive')

    title.removeAttribute('contenteditable')
    title.removeAttribute('data-richclay')
    title.removeAttribute('data-hcms-bound')
    undo.undo()

    // The value changed because the undo reverted it, not because anyone typed.
    // Recording that would push a primitive for the undo's own effect, and a
    // fresh record clears the redo stack, so the person who just pressed undo
    // could not press redo.
    assert.equal(undo.records.length, 0, 'the rebind recorded nothing on top of the undo')
  } finally {
    close()
  }
  reset(t.dom)
})

// ---- review round 2 ----------------------------------------------------------

// Written across three lines with no element children, so the rule stays a bare
// textContent projection and the whitespace the DOM adapter trims is real.
const PADDED = page(
  `{ "title": ".title" }`,
  `<h1 class="title">
  Hello
</h1>`
)

const PLAIN_TITLE = page(`{ "title": ".title" }`, '<h1 class="title">Hello</h1>')

const ROWS = page(
  `{ "products": [".product", { "name": ".name@innerHTML" }] }`,
  `<div class="list">
    <div class="product"><span class="name">One</span></div>
    <div class="product"><span class="name">Two</span></div>
    <div class="product"><span class="name">Three</span></div>
  </div>`
)

// sku projects an attribute, so it is a handle target and opens the popover —
// the other half of the path a move renumbers.
const ROWS_SKU = page(
  `{ "products": [".product", { "name": ".name@innerHTML", "sku": ".sku@data-sku" }] }`,
  `<div class="list">
    <div class="product"><span class="name">One</span><span class="sku" data-sku="A1">A1</span></div>
    <div class="product"><span class="name">Two</span><span class="sku" data-sku="B2">B2</span></div>
    <div class="product"><span class="name">Three</span><span class="sku" data-sku="C3">C3</span></div>
  </div>`
)

const TAGS = page(
  `{ "title": ".title", "tags": "ul.tags li[]" }`,
  `<h1 class="title">Hello <em>you</em></h1>
  <ul class="tags"><li>alpha</li><li>beta</li></ul>`
)

// A list with no rows and no [cms-template] seed: the engine has nothing to
// clone, so an add raises EmptyListInsert and the apply rolls back.
const EMPTY_LIST = page(
  `{ "title": ".title", "products": [".product", { "name": ".name" }] }`,
  `<h1 class="title">Hello <em>you</em></h1>
  <div class="list"></div>`
)

function listNamed(ctx, path) {
  const { lists } = resolveTargets(ctx.pageRoot, ctx.pageRules)
  return lists.find((candidate) => candidate.path.join('.') === path)
}

function targetNamed(ctx, path) {
  const { targets } = resolveTargets(ctx.pageRoot, ctx.pageRules)
  return targets.find((candidate) => candidate.path.join('.') === path)
}

function activePath(t) {
  return t.doc.querySelector('.is-hcms-inline-active')?.getAttribute('data-hcms-path')
}

function names() {
  return api.getData().products.map((product) => product.name)
}

// --- F1: the commit reads the projection the way the engine does -------------

test('F1: a textContent commit reads the trimmed value, so the caret node survives', () => {
  const t = boot(PADDED)
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    const editor = editorFor(t, title)

    title.textContent = '\n  Hello there\n'
    // Captured after the editor wrote and before the commit: this is the node
    // the caret is sitting in.
    const caretNode = title.firstChild
    editor.squire.emit('input')

    assertCoherent('after a whitespace-padded textContent commit')
    assert.equal(api.getData().title, 'Hello there')
    assert.equal(title.firstChild, caretNode, 'the commit did not rewrite the node under the caret')
  } finally {
    close()
  }
  reset(t.dom)
})

// --- F2: a binding follows the page, not the path it was born with -----------

test('F2: a binding follows its row through a move instead of writing into the row that took its index', () => {
  const t = boot(ROWS)
  try {
    const ctx = state.ctx
    const second = t.doc.querySelectorAll('.product .name')[1]
    assert.equal(second.textContent, 'Two', 'the fixture puts Two in the middle')

    click(t, second)
    type(t, second, 'Two edited')

    ctx.view.listAction({ action: 'move-up', list: listNamed(ctx, 'products'), index: 1 })
    refresh()

    type(t, second, 'Two edited again')

    assert.deepEqual(names(), ['Two edited again', 'One', 'Three'])
    assert.equal(t.doc.querySelectorAll('.product .name')[1].innerHTML, 'One', 'the row it moved past is untouched')
  } finally {
    close()
  }
  reset(t.dom)
})

test('F2: a rule that upgrades to @innerHTML mid-session rebuilds the editor under it', () => {
  const t = boot(PLAIN_TITLE)
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    const first = editorFor(t, title)
    assert.equal(first.options.toolbar, false, 'bound on a textContent projection')

    // The projection changes at its source: the author's rule itself becomes an
    // @innerHTML one. refreshForm re-reads the rules tag every refresh, so this
    // is the supported way a rule changes under a live binding. Markup merely
    // APPEARING in a bound element is not, and must not be — a bound element's
    // projection is frozen for the life of the binding, which is the same rule
    // F10 keeps when it denies a plain-text target a formatting toolbar.
    rulesTag(t).textContent = '{ "title": ".title@innerHTML" }'
    refresh()

    const rebuilt = editorFor(t, title)
    assert.notEqual(rebuilt, first, 'the editor was rebuilt')
    assert.equal(first.destroyed, true, 'and the textContent one was torn down')
    // construct() derives the toolbar from the projection, so this is
    // binding.prop === 'innerHTML' read from outside the closure that holds it.
    assert.deepEqual(rebuilt.options.toolbar, ['bold', 'italic', 'link', 'undo', 'redo'])

    type(t, title, 'Hello <em>world</em>')
    assert.equal(api.getData().title, 'Hello <em>world</em>', 'the markup commits instead of being flattened')
  } finally {
    close()
  }
  reset(t.dom)
})

// The defect this marker exists for, driven end to end. The fake editor does not
// wrap its content, so squire's <div> is written by hand — measured in Chrome it
// lands at t+0 and the upgrade followed on the next observer batch.
test('F2b: clicking a plain paragraph does not turn its rule into a rich-text one', () => {
  const t = boot(PLAIN_TITLE)
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    const first = editorFor(t, title)
    assert.equal(first.options.toolbar, false, 'bound on a textContent projection')

    title.innerHTML = '<div>Hello</div>'
    refresh()

    assert.equal(state.ctx.pageRules.title, '.title', 'the rule is still the plain one')
    assert.equal(editorFor(t, title), first, 'and the editor was left alone')
    assert.equal(first.destroyed, false)
  } finally {
    close()
  }
  reset(t.dom)
})

test('F2: an open popover follows its row through a move', () => {
  const t = boot(ROWS_SKU)
  try {
    const ctx = state.ctx
    const rowTwo = t.doc.querySelectorAll('.product')[1]
    ctx.view.activate(targetNamed(ctx, 'products.1.sku'))
    assert.equal(activePath(t), 'products.1.sku', 'the popover opened over the middle row')

    ctx.view.listAction({ action: 'move-up', list: listNamed(ctx, 'products'), index: 1, row: rowTwo })
    refresh()

    assert.equal(activePath(t), 'products.0.sku', 'and it is still editing the row it was anchored over')
  } finally {
    close()
  }
  reset(t.dom)
})

// --- F3: row controls act on the row they are drawn on -----------------------

test('F3: a second click on a stale row strip acts on its row, not on its old index', () => {
  const t = boot(ROWS)
  try {
    const ctx = state.ctx
    const rowTwo = t.doc.querySelectorAll('.product')[1]
    // One list object, captured once, the way a strip built by the layer holds
    // the numbering it was drawn with. No refresh runs between the two clicks.
    const list = listNamed(ctx, 'products')

    ctx.view.listAction({ action: 'move-up', list, index: 1, row: rowTwo })
    ctx.view.listAction({ action: 'move-up', list, index: 1, row: rowTwo })

    assert.deepEqual(names(), ['Two', 'One', 'Three'], 'the second click was a no-op on an already-first row')
  } finally {
    close()
  }
  reset(t.dom)
})

// --- F5: never destroy an editor hypercms did not create ---------------------

test('F5: an editor the author mounted is adopted for the session and never torn down', () => {
  if (isOpen()) close()
  const dom = loadPage(TEXT)
  const richclay = installRichClay(dom.window)
  const Base = dom.window.richclay.RichClay
  const byElement = new Map()
  // richclay's own constructor contract (richclay.js:85-86): a second
  // construction on an element that already has an instance returns that one.
  class Adopting extends Base {
    constructor(el, options) {
      const existing = byElement.get(el)
      if (existing) return existing
      super(el, options)
      byElement.set(el, this)
    }
  }
  dom.window.richclay = { RichClay: Adopting }
  const t = { dom, win: dom.window, doc: dom.window.document, richclay }

  const title = t.doc.querySelector('.title')
  const authors = new Adopting(title, { inline: true })
  assert.equal(title.getAttribute('data-richclay-active'), 'true', "the author's editor is live before hypercms looks")

  open({ view: 'inline' })
  try {
    click(t, title)
    assert.equal(editorFor(t, title), authors, "hypercms's 'new' editor is the author's")

    close()

    assert.equal(authors.destroyed, false, "the author's editor was not destroyed")
    assert.equal(title.getAttribute('data-richclay-active'), 'true', 'and it is still driving the element')
    assert.equal(title.hasAttribute('data-hcms-bound'), false, 'only the CMS marker came off')
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

// --- F6: the undo baseline is the author's markup, not Squire's --------------

test("F6: undo returns the author's markup, not Squire's normalisation", () => {
  const t = bootNormalizing()
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    const authored = title.innerHTML
    assert.equal(authored, 'Hello <em>you</em>')

    click(t, title)
    assert.equal(title.innerHTML, '<div>Hello <i>you</i></div>', 'the editor rewrote it on bind')
    type(t, title, '<div>Hello <i>world</i></div>')
    blur(t, title)

    assert.equal(undo.records.length, 1)
    undo.undo()
    assert.equal(title.innerHTML, authored, "undoing must not write Squire's <div> and <i> into the file")
  } finally {
    close()
  }
  reset(t.dom)
})

// --- F7: the undo record survives somebody else's pause ----------------------

test("F7: a close inside teardown's own undo pause still records the edit", async () => {
  const t = boot(TEXT)
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    const original = title.innerHTML
    click(t, title)
    type(t, title, 'Hello <em>world</em>')

    // teardownSession wraps view.destroy() in suppressUndo (session.js:225), so
    // the recorder is paused at the exact moment the binding closes.
    close()

    await Promise.resolve()

    assert.equal(undo.records.length, 1, 'the edit kept its place on the stack')
    assert.equal(undo.records[0].oldValue, original)
    assert.equal(undo.records[0].newValue, 'Hello <em>world</em>')
    undo.undo()
    assert.equal(title.innerHTML, original, 'and replaying it returns the heading')
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

test("F7: a live-sync applied inside clayjs's own pause still records the edit", async () => {
  const t = boot(SYNCED)
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    const original = title.innerHTML
    click(t, title)
    type(t, title, 'Hello <em>world</em>')

    // clayjs dispatches clay:sync-applied from inside its mutation pause, which
    // pauses undo too (live-sync.js:1357, mutation.js:132).
    undo.pause()
    morphFromPeer(t)
    livesyncApplied(t)
    assert.deepEqual(undo.records, [], 'nothing can land while somebody else holds the pause')
    undo.resume()
    await Promise.resolve()

    assert.equal(undo.records.length, 1, 'and the edit arrives once the pause is over')
    assert.equal(undo.records[0].oldValue, original)
    assert.equal(undo.records[0].newValue, 'Hello <em>world</em>')
  } finally {
    close()
  }
  reset(t.dom)
})

// --- F8: undo refreshes the baseline of a binding that survived it -----------

test('F8: a binding that survived an undo takes the reverted value as its baseline', () => {
  const t = boot(TEXT)
  try {
    const undo = installUndo(t.win)
    close()
    open({ view: 'inline' })

    const title = t.doc.querySelector('.title')
    const original = title.innerHTML
    click(t, title)
    type(t, title, 'Hello <em>world</em>')
    blur(t, title)
    assert.equal(undo.records.length, 1)

    undo.undo()
    assert.equal(title.innerHTML, original, 'the undo reverted the page')
    assert.equal(undo.canRedo, true, 'and it is redoable')
    assert.equal(title.getAttribute('data-hcms-bound'), 'rich', 'the binding came through with its marker intact')

    blur(t, title)

    assert.equal(undo.records.length, 0, 'a blur with no typing records nothing')
    assert.equal(undo.canRedo, true, 'so the redo they just earned is still there')
  } finally {
    close()
  }
  reset(t.dom)
})

// --- F9: close restores only what construct produced -------------------------

test('F9: an API write in the same task as close is not reverted by the restore', () => {
  const t = bootNormalizing()
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    assert.equal(title.innerHTML, '<div>Hello <i>you</i></div>', 'bound and normalised, nothing typed')

    api.setValue('title', 'Replacement <em>from API</em>')
    close()

    assert.equal(title.innerHTML, 'Replacement <em>from API</em>', "the API's write stands")
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

// --- F10: no formatting toolbar on a plain-text projection -------------------

test('F10: a plain-text projection gets no toolbar; an @innerHTML one gets the full set', () => {
  const t = boot(TAGS)
  try {
    const tag = t.doc.querySelectorAll('ul.tags li')[0]
    click(t, tag)
    assert.equal(
      editorFor(t, tag).options.toolbar,
      false,
      'a scalar row commits textContent, so a bold from this toolbar would be flattened'
    )

    const title = t.doc.querySelector('.title')
    click(t, title)
    assert.deepEqual(editorFor(t, title).options.toolbar, ['bold', 'italic', 'link', 'undo', 'redo'])
  } finally {
    close()
  }
  reset(t.dom)
})

// --- F11: orphan clones lose their editor state ------------------------------

test('F11: a row the engine cloned off a bound one does not stay editable', () => {
  const t = boot(ROWS)
  try {
    const first = t.doc.querySelector('.product .name')
    click(t, first)
    assert.equal(first.getAttribute('data-hcms-bound'), 'plain')

    // listDiff clones oldNodes[0] to grow a list (diff.js:67), which is the row
    // the editor is bound inside.
    api.addItem('products')
    refresh()
    close()

    const rows = [...t.doc.querySelectorAll('.product .name')]
    const clone = rows[rows.length - 1]
    assert.notEqual(clone, first, 'the added row is a new node')
    assert.equal(clone.hasAttribute('contenteditable'), false, 'and it is not editable')
    assert.equal(clone.hasAttribute('no-undo'), false, 'and page undo is not switched off for it')
    assert.equal(clone.hasAttribute('data-hcms-bound'), false)
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

test('F11: the clone a rolled-back apply put on the page does not stay editable', () => {
  const t = boot(EMPTY_LIST)
  try {
    const title = t.doc.querySelector('.title')
    click(t, title)
    assert.equal(title.getAttribute('data-hcms-bound'), 'rich')

    // Nothing to clone, so the apply raises EmptyListInsert and the rollback
    // restores clones of every non-shell child (apply-loop.js:145).
    api.addItem('products')
    const replacement = t.doc.querySelector('.title')
    assert.notEqual(replacement, title, 'the rollback replaced the heading with a clone')
    assert.equal(replacement.getAttribute('data-hcms-bound'), 'rich', 'and the clone carries the marker')

    refresh()

    assert.equal(replacement.hasAttribute('contenteditable'), false)
    assert.equal(replacement.hasAttribute('no-undo'), false)
    assert.equal(replacement.hasAttribute('data-hcms-bound'), false)
  } finally {
    close()
  }
  reset(t.dom)
})

test('F11: a richclay that offers stripElement is the one that does the cleanup', () => {
  if (isOpen()) close()
  const dom = loadPage(ROWS)
  const richclay = installRichClay(dom.window)
  const Base = dom.window.richclay.RichClay
  const stripped = []
  class WithStrip extends Base {
    static stripElement(el) {
      stripped.push(el)
      el.removeAttribute('contenteditable')
      el.removeAttribute('data-richclay-active')
      el.removeAttribute('no-undo')
      unmarkRichClay(el)
    }
  }
  dom.window.richclay = { RichClay: WithStrip }
  const t = { dom, win: dom.window, doc: dom.window.document, richclay }

  open({ view: 'inline' })
  try {
    const first = t.doc.querySelector('.product .name')
    click(t, first)
    api.addItem('products')
    refresh()

    const rows = [...t.doc.querySelectorAll('.product .name')]
    const clone = rows[rows.length - 1]
    assert.deepEqual(stripped, [clone], 'the per-element strip was handed the orphan, and only it')
    // The fallback branch cannot do this one: it removes the two attributes that
    // harm the live page and leaves richclay's own flag behind.
    assert.equal(clone.hasAttribute('data-richclay-active'), false)
    assert.equal(clone.hasAttribute('data-hcms-bound'), false)
  } finally {
    close()
  }
  reset(t.dom)
})
