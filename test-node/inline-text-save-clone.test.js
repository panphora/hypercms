import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

// The snapshot hook installs once per module lifetime, so this lives in its own
// file, like inline-text-snapshot-hook.test.js: the first open() here is the one
// that registers, and every test below runs the clone through that same hook.

const FIXTURE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello <em>you</em></h1>
</body></html>`

const AUTHORED = 'Hello <em>you</em>'
const NORMALISED = '<div>Hello <i>you</i></div>'

function emitter() {
  const listeners = new Map()
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
    emit(type) { for (const fn of [...(listeners.get(type) || [])]) fn({ type }) },
  }
}

function unmarkRichClay(el) {
  if (el.getAttribute('data-richclay-runtime-marker') === 'true') {
    el.removeAttribute('data-richclay')
  }
  el.removeAttribute('data-richclay-runtime-marker')
}

// Squire's normalisation, the measured one: binding a heading wraps its content
// in a <div> and rewrites <em> as <i>. That rewriting is what must not reach the
// saved file.
const made = []

class Normalizing {
  constructor(el) {
    this.element = el
    this.squire = emitter()
    made.push(this)
    this.unsupported = false
    this.active = true
    el.setAttribute('data-richclay-runtime-marker', 'true')
    el.setAttribute('data-richclay', '')
    el.setAttribute('contenteditable', 'true')
    el.innerHTML = `<div>${el.innerHTML.replace(/<(\/?)em>/g, '<$1i>')}</div>`
  }
  focus() {}
  destroy() {
    this.element.removeAttribute('contenteditable')
    unmarkRichClay(this.element)
  }
  static stripFromClone(docEl) {
    for (const el of docEl.querySelectorAll('[data-richclay]')) {
      el.removeAttribute('contenteditable')
      unmarkRichClay(el)
    }
  }
}

let snapshotHook = null

function boot() {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  const win = dom.window
  win.richclay = { RichClay: Normalizing }
  win.hyperclay.onSnapshot = (fn) => { snapshotHook = fn }
  open({ view: 'inline' })
  return { dom, win, doc: win.document }
}

function bind(t, el) {
  el.dispatchEvent(new t.win.MouseEvent('click', { bubbles: true, cancelable: true }))
  return made.findLast((e) => e.element === el)
}

// What the host client hands the hook: a clone of the document, taken while the
// session is open.
function snapshot(t) {
  assert.ok(snapshotHook, 'the hook is installed')
  const clone = t.doc.documentElement.cloneNode(true)
  snapshotHook(clone)
  return clone
}

test("D2: a save clone taken while a heading is bound and untouched carries the author's markup, not the editor's rewriting", () => {
  const t = boot()
  try {
    const title = t.doc.querySelector('.title')
    bind(t, title)
    assert.equal(title.innerHTML, NORMALISED, 'the editor really did rewrite it on bind')

    const clone = snapshot(t)

    assert.equal(clone.querySelector('.title').innerHTML, AUTHORED, 'the file gets the author\'s markup')
    // The live session is deliberately untouched: nobody's caret moves for a save.
    assert.equal(title.innerHTML, NORMALISED, 'and the person editing keeps their editor')
    assert.equal(title.getAttribute('contenteditable'), 'true')
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

test('D2b: the same clone carries no data-hcms-bound-id', () => {
  const t = boot()
  try {
    const title = t.doc.querySelector('.title')
    bind(t, title)
    assert.equal(title.hasAttribute('data-hcms-bound-id'), true, 'the live element carries it')

    const clone = snapshot(t)

    assert.equal(clone.querySelector('.title').hasAttribute('data-hcms-bound-id'), false)
    assert.equal(title.hasAttribute('data-hcms-bound-id'), true, 'and the live element still does')
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})

test('D2c: a save clone taken after the person typed carries what they typed', () => {
  const t = boot()
  try {
    const title = t.doc.querySelector('.title')
    const editor = bind(t, title)

    // Type through the editor: richclay writes the page element, then squire
    // announces it, which is the signal the commit path listens on.
    title.innerHTML = '<div>Hello <i>world</i></div>'
    editor.squire.emit('input')

    const clone = snapshot(t)

    assert.equal(clone.querySelector('.title').innerHTML, '<div>Hello <i>world</i></div>')
  } finally {
    if (isOpen()) close()
  }
  reset(t.dom)
})
