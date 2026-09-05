import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engine } from 'hyper-html-api'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'
import { state } from '../src/session.js'
import { coerceBooleans, extractFormData, stableStringify } from '../src/events.js'
import { upgradeInlineTextRules } from '../src/enhance.js'

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
      el.setAttribute('data-richclay', '')
      this.unsupported =
        el.namespaceURI !== HTML_NS || REFUSED_TAGS.has((el.tagName || '').toUpperCase())
      if (this.unsupported) return
      el.setAttribute('contenteditable', 'true')
      el.classList.add('richclay-inline')
      this.active = true
    }
    focus() {
      this.element.focus?.()
    }
    destroy() {
      this.destroyed = true
      this.active = false
      this.element.removeAttribute('contenteditable')
      this.element.removeAttribute('data-richclay')
      this.element.classList.remove('richclay-inline')
      if (this.element.getAttribute('class') === '') this.element.removeAttribute('class')
    }
    static stripFromClone(docEl) {
      for (const el of docEl.querySelectorAll('[data-richclay]')) {
        el.removeAttribute('contenteditable')
        el.classList.remove('richclay-inline')
      }
    }
  }
  win.richclay = { RichClay: FakeRichClay }
  return { made, get last() { return made[made.length - 1] } }
}

// The parts of hyper-undo this path touches, with its two load-bearing rules:
// recordValue is a no-op while the recorder is paused, and an undo replays the
// primitive in reverse and then announces itself.
function installUndo(win) {
  const records = []
  const handlers = new Map()
  let depth = 0
  const undo = {
    records,
    pause() { depth++ },
    resume() { depth = Math.max(0, depth - 1) },
    commitCaptured() {},
    discardCaptured() {},
    recordValue(target, { prop = 'value', oldValue, newValue } = {}) {
      if (depth > 0) return
      if (!target || oldValue === newValue) return
      records.push({ target, prop, oldValue, newValue })
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
      for (const fn of [...(handlers.get('undo') || [])]) fn()
    },
  }
  win.hyperclay.undo = undo
  return undo
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

// Type through the editor: richclay writes the page element, then squire
// announces it. Both halves matter — a commit driven by anything but squire's
// signal would miss every toolbar command.
function type(t, el, html) {
  const editor = t.richclay.made.find((e) => e.element === el)
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
