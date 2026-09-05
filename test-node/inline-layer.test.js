import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { engine } from 'hyper-html-api'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, installStyles, refresh } from '../src/hypercms.js'

// jsdom has no layout: every getBoundingClientRect() answers 0x0, so nothing on
// the page clears the 8px anchor floor and the layer would draw nothing at all.
// Each element the placement pass measures gets an explicit box below.
//
// A hidden element measuring zero is the browser behaviour the placement pass
// depends on (it un-hides a handle BEFORE measuring it), so the stub reproduces
// it rather than answering the same box either way.
const ZERO = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }

function box(left, top, width, height) {
  return { width, height, top, left, right: left + width, bottom: top + height, x: left, y: top }
}

function setBox(el, b) {
  el.__box = b
  el.getBoundingClientRect = () => (el.hidden ? ZERO : el.__box)
  return el
}

// A faithful rAF: the id is handed back before the callback runs, so the layer's
// one-frame coalescing behaves the way it does in a browser. A stub that ran the
// callback synchronously would return its id AFTER the callback had already
// cleared `frame`, leaving it permanently set and every later pass skipped.
function stubFrames(win) {
  let nextId = 1
  const pending = new Map()
  win.requestAnimationFrame = (cb) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  }
  win.cancelAnimationFrame = (id) => { pending.delete(id) }
  return {
    pending,
    flush() {
      const due = [...pending.values()]
      pending.clear()
      for (const cb of due) cb()
    },
  }
}

function stubIntersection(win) {
  const made = []
  win.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback
      this.observed = []
      this.disconnected = false
      made.push(this)
    }
    observe(el) { this.observed.push(el) }
    unobserve(el) { this.observed = this.observed.filter((x) => x !== el) }
    disconnect() { this.disconnected = true; this.observed = [] }
    takeRecords() { return [] }
  }
  return {
    get current() { return made[made.length - 1] },
    report(isIntersecting) {
      const io = made[made.length - 1]
      io.callback(io.observed.map((target) => ({ target, isIntersecting })), io)
    },
  }
}

function page(rules, body) {
  return `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">${rules}</script>
  ${body}
</body></html>`
}

const MIXED = page(
  `{
    "title": ".title",
    "hero": ".hero@src",
    "link": ".link@href",
    "sticker": ".sticker@src",
    "tags": "li.tag[]"
  }`,
  `<h1 class="title">Hello</h1>
  <div class="scroller">
    <img class="hero" src="hero.png">
    <a class="link" href="/one">One</a>
  </div>
  <img class="sticker" src="sticker.png">
  <ul><li class="tag">a</li><li class="tag">b</li></ul>`
)

const NATIVE = page(
  `{
    "hero": ".hero@src",
    "email": "input.email@value"
  }`,
  `<img class="hero" src="hero.png">
  <input class="email" value="a@b.co">`
)

const HERO = box(40, 100, 200, 120)
const LINK = box(40, 260, 100, 20)
const HANDLE = box(0, 0, 24, 24)
// A three-button strip and a one-button Add, both measured the way a handle is.
const STRIP = box(0, 0, 90, 28)
const ADD = box(0, 0, 60, 28)
// placeHandle has two modes, and this fixture exercises both. The hero is
// 200x120 against a 24x24 handle, roomy enough that the handle sits on its
// top-right corner overlapping by the 6px inset. The link is 100x20, shorter
// than the handle is tall, so the handle goes BESIDE it instead: 4px past its
// right edge, centred on it. Both are clamped to the viewport.
//
// Spelled out rather than recomputed from place.js so a placement regression
// cannot agree with itself.
const HERO_AT = 'translate(222px, 94px)'
const LINK_AT = 'translate(144px, 258px)'

// Boxes for the B2b-3a fixture below. Every element those tests reason about
// gets one, so "nothing happened here" is never really "nothing could have".
const JUMP = box(90, 10, 80, 20)
const CAPTION = box(40, 60, 160, 24)
const GRID = box(280, 380, 400, 200)
const PRODUCT = box(300, 400, 120, 90)

// Boot the mixed page with the two browser APIs the layer needs, hand every
// element the layer will measure a box, and return the handles ready to place.
function boot(html = MIXED) {
  if (isOpen()) close()
  const dom = loadPage(html)
  const win = dom.window
  const doc = win.document
  const frames = stubFrames(win)
  const io = stubIntersection(win)

  const el = (sel) => doc.querySelector(sel)
  if (el('.hero')) setBox(el('.hero'), HERO)
  if (el('.link')) setBox(el('.link'), LINK)
  // Below MIN_ANCHOR_PX in both dimensions: a real box, just too small to hang
  // a control on.
  if (el('.sticker')) setBox(el('.sticker'), box(0, 400, 4, 4))
  if (el('.title')) setBox(el('.title'), box(0, 0, 300, 40))
  // A real, comfortably anchorable box, so that 'no handle here' is a
  // statement about the target's KIND and not about it failing the size floor.
  if (el('.email')) setBox(el('.email'), box(40, 300, 220, 32))
  if (el('.jump')) setBox(el('.jump'), JUMP)
  if (el('.caption')) setBox(el('.caption'), CAPTION)
  if (el('.grid')) setBox(el('.grid'), GRID)
  if (el('.product-name')) setBox(el('.product-name'), PRODUCT)
  for (const li of doc.querySelectorAll('li.tag')) setBox(li, box(0, 500, 80, 20))
  // The list anchors: each row gets its own box so a strip that lands on the
  // wrong row is visible as a wrong transform, and the <ul> gets one so the Add
  // it carries is placed against something real.
  doc.querySelectorAll('.product').forEach((row, i) => setBox(row, box(300, 400 + i * 70, 360, 60)))
  if (el('ul.tags')) setBox(el('ul.tags'), box(0, 480, 300, 60))

  open({ view: 'inline' })

  const host = doc.querySelector('hypercms-inline')
  const layerEl = host.querySelector('.hcms-inline-layer')
  const countEl = host.querySelector('.hcms-inline-count')
  for (const handle of layerEl.querySelectorAll('.hcms-inline-handle')) setBox(handle, HANDLE)
  for (const strip of layerEl.querySelectorAll('.hcms-inline-row-controls')) setBox(strip, STRIP)
  for (const add of layerEl.querySelectorAll('.hcms-inline-list-add')) setBox(add, ADD)

  return { dom, win, doc, frames, io, host, layerEl, countEl }
}

function handles(layerEl) {
  return [...layerEl.querySelectorAll('.hcms-inline-handle')]
}

test('inline layer: one handle per non-text target, and none for a text target', () => {
  const t = boot()
  try {
    const paths = handles(t.layerEl).map((h) => h.getAttribute('data-hcms-target'))
    assert.deepEqual(paths, ['hero', 'link'], 'only the two non-text, anchorable targets')

    const [hero, link] = handles(t.layerEl)
    assert.equal(hero.getAttribute('data-hcms-icon'), 'camera')
    assert.equal(link.getAttribute('data-hcms-icon'), 'paperclip')
    assert.equal(hero.getAttribute('aria-label'), 'Edit hero')
    assert.equal(hero.type, 'button')

    // The h1 and the two <li> rows are text targets: richclay binds them in
    // place, so a handle over them would be a second way to edit the same thing.
    for (const path of ['title', 'tags.0', 'tags.1']) {
      assert.equal(
        t.layerEl.querySelector(`[data-hcms-target="${path}"]`),
        null,
        `${path} is a text target and must have no handle`
      )
    }
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline layer: a target below the anchor floor gets no handle', () => {
  const t = boot()
  try {
    assert.equal(
      t.layerEl.querySelector('[data-hcms-target="sticker"]'),
      null,
      'a 4px image is a resolved target but not an anchorable one'
    )
    assert.equal(handles(t.layerEl).length, 2)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline layer: a handle is hidden until its intersection record says it is showing', () => {
  const t = boot()
  try {
    t.frames.flush()
    for (const h of handles(t.layerEl)) {
      assert.equal(h.hidden, true, 'nothing is drawn before the observer has reported')
    }

    // The anchors, never the handles — and since B2b-4 that includes the anchors
    // the list controls ride: each row of the tags list, then the <ul> the Add
    // sits on. One observer covers every kind of control the layer draws.
    assert.deepEqual(
      t.io.current.observed,
      [
        t.doc.querySelector('.hero'),
        t.doc.querySelector('.link'),
        ...t.doc.querySelectorAll('li.tag'),
        t.doc.querySelector('ul'),
      ],
      'the observer watches the anchors, not the handles'
    )

    t.io.report(true)
    t.frames.flush()
    for (const h of handles(t.layerEl)) assert.equal(h.hidden, false)

    // Scrolled away, or clipped by an overflow:hidden ancestor: the handle goes
    // with it rather than floating over whatever is visible in its place.
    t.io.report(false)
    t.frames.flush()
    for (const h of handles(t.layerEl)) assert.equal(h.hidden, true)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline layer: a scroll inside an overflow container re-places the handles', () => {
  const t = boot()
  try {
    assert.equal(t.win.innerWidth, 1024, 'placement below is spelled out for this viewport')
    assert.equal(t.win.innerHeight, 768)

    // The pass the mount scheduled, so the handles go through the real
    // hidden-then-shown sequence rather than being measured while still hidden.
    t.frames.flush()
    t.io.report(true)
    t.frames.flush()
    const [hero, link] = handles(t.layerEl)
    assert.equal(hero.style.transform, HERO_AT)
    assert.equal(link.style.transform, LINK_AT)

    // The page scrolls the panel, not the window: the hero moves 80px up and
    // the scroll event fires on the div, which does not bubble to the window.
    setBox(t.doc.querySelector('.hero'), box(40, 20, 200, 120))
    t.doc.querySelector('.scroller').dispatchEvent(new t.win.Event('scroll'))
    assert.equal(t.frames.pending.size, 1, 'the capture-phase listener heard it')

    t.frames.flush()
    assert.equal(hero.style.transform, 'translate(222px, 14px)')
    assert.equal(link.style.transform, LINK_AT, 'the anchor that did not move did not move')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline layer: a resize re-places the handles too', () => {
  const t = boot()
  try {
    t.frames.flush()
    t.io.report(true)
    t.frames.flush()
    const [hero] = handles(t.layerEl)
    assert.equal(hero.style.transform, HERO_AT)

    setBox(t.doc.querySelector('.hero'), box(900, 100, 200, 120))
    t.win.dispatchEvent(new t.win.Event('resize'))
    t.frames.flush()
    // Clamped to the viewport: a card flush against the right edge keeps its
    // handle on screen. 1024 - 24 - 8.
    assert.equal(hero.style.transform, 'translate(992px, 94px)')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline layer: the count names how many editable areas there are', () => {
  const t = boot()
  try {
    assert.equal(t.countEl.textContent, '2 editable areas')
    assert.equal(t.countEl.hidden, false)
  } finally {
    close()
  }
  reset(t.dom)

  const one = boot(page(`{ "hero": ".hero@src" }`, '<img class="hero" src="hero.png">'))
  try {
    assert.equal(one.countEl.textContent, '1 editable area')
    assert.equal(one.countEl.hidden, false)
  } finally {
    close()
  }
  reset(one.dom)

  const none = boot(page(`{ "title": ".title" }`, '<h1 class="title">Hello</h1>'))
  try {
    // Handles, not raw children: the layer also owns the reusable hover
    // highlight, which is chrome and must never read as an editable area.
    assert.equal(handles(none.layerEl).length, 0)
    assert.equal(none.countEl.textContent, '0 editable areas')
    assert.equal(none.countEl.hidden, true, 'a page of pure text says nothing rather than "0"')
  } finally {
    close()
  }
  reset(none.dom)
})

test('inline layer: destroy disconnects the observer, drops the handles and stops listening', () => {
  const t = boot()
  try {
    t.io.report(true)
    t.frames.flush()
    assert.equal(handles(t.layerEl).length, 2)
  } finally {
    close()
  }

  assert.equal(t.io.current.disconnected, true, 'the observer is disconnected')
  assert.equal(t.layerEl.children.length, 0, 'every handle is removed from the layer')

  t.frames.pending.clear()
  t.doc.querySelector('.scroller').dispatchEvent(new t.win.Event('scroll'))
  t.win.dispatchEvent(new t.win.Event('resize'))
  assert.equal(t.frames.pending.size, 0, 'a closed session schedules no more placement passes')

  reset(t.dom)
})

test('inline layer: a native control gets no handle, because it is already the control', () => {
  const t = boot(NATIVE)
  try {
    const paths = handles(t.layerEl).map((h) => h.getAttribute('data-hcms-target'))
    assert.deepEqual(paths, ['hero'], 'only the handle-kind target')
    // targets.js is explicit that a native gets "nothing at all": the page
    // already carries an editable control, and a handle drawn on its top-right
    // corner would sit on top of the thing it was pointing at.
    assert.equal(
      t.layerEl.querySelector('[data-hcms-target="email"]'),
      null,
      'a live input must not be covered by a handle'
    )
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline layer: a window without requestAnimationFrame places synchronously instead of throwing', () => {
  if (isOpen()) close()
  const dom = loadPage(MIXED)
  const win = dom.window
  const doc = win.document
  stubIntersection(win)
  // The degradation toggle.js already applies in scheduleSurface. A non-visual
  // jsdom has no rAF, and an unguarded schedule() threw out of mount().
  delete win.requestAnimationFrame
  delete win.cancelAnimationFrame

  const el = (sel) => doc.querySelector(sel)
  setBox(el('.hero'), HERO)
  setBox(el('.link'), LINK)
  setBox(el('.sticker'), box(0, 400, 4, 4))
  setBox(el('.title'), box(0, 0, 300, 40))
  for (const li of doc.querySelectorAll('li.tag')) setBox(li, box(0, 500, 80, 20))

  assert.doesNotThrow(() => open({ view: 'inline' }), 'mount must not need requestAnimationFrame')

  const layerEl = doc.querySelector('hypercms-inline .hcms-inline-layer')
  assert.equal(handles(layerEl).length, 2, 'the handles are still drawn')
  close()
  reset(dom)
})

// ---- B2b-3a: hover discovery and the popover --------------------------------

// One text target with a link inside it, one plain-scalar handle target whose
// form leaf is a textarea, one upload target, and one nested inside a card so
// the ancestor chain has something to say.
const POP = page(
  `{
    "title": ".title",
    "caption": ".caption@title",
    "hero": ".hero@src",
    "products": [".product", { "name": ".product-name@src" }]
  }`,
  `<h1 class="title">Hello <a class="jump" href="/elsewhere">elsewhere</a></h1>
  <span class="caption" title="A caption">Cap</span>
  <img class="hero" src="hero.png">
  <div class="grid"><div class="product"><img class="product-name" src="p1.png"></div></div>`
)

const POP_BOX = box(0, 0, 260, 140)
// place() ladder against HERO (40,100 200x120) in a 1024x768 viewport: 'above'
// needs y >= 8 and would be -56, so it lands 'below' at anchor.bottom + GAP.
// Spelled out rather than recomputed from place.js so a regression there cannot
// agree with itself.
const POP_BELOW_HERO = 'translate(40px, 236px)'

function parts(t) {
  const host = t.host
  return {
    host,
    pop: host.querySelector('.hcms-inline-pop'),
    formRoot: host.querySelector('[data-hcms-form-root]'),
    highlight: host.querySelector('.hcms-inline-highlight'),
  }
}

function fire(t, el, type, init = {}) {
  const event = new t.win.MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

function hover(t, el) {
  el.dispatchEvent(new t.win.Event('pointerover', { bubbles: true }))
}

function clickHandle(t, path) {
  const handle = t.layerEl.querySelector(`[data-hcms-target="${path}"]`)
  assert.ok(handle, `no handle for ${path}`)
  fire(t, handle, 'click')
  return handle
}

function pathsShowing(formRoot, cls) {
  return [...formRoot.querySelectorAll('[data-hcms-path]')]
    .filter((el) => el.classList.contains(cls))
    .map((el) => el.getAttribute('data-hcms-path'))
}

test('inline popover: activating reveals exactly one leaf, through its whole ancestor chain', () => {
  const t = boot(POP)
  try {
    const { pop, formRoot } = parts(t)
    setBox(pop, POP_BOX)
    assert.equal(pop.hidden, true, 'nothing is revealed before anything is activated')

    clickHandle(t, 'products.0.name')

    assert.equal(pop.hidden, false)
    assert.deepEqual(
      pathsShowing(formRoot, 'is-hcms-inline-active'),
      ['products.0.name'],
      'exactly one leaf is the active one'
    )

    // Every wrapper between the leaf and the form root is hidden by the same
    // one-field-at-a-time rule, so the leaf is only reachable if the whole
    // chain is marked. The empty-path root <section> is part of that chain.
    const leaf = formRoot.querySelector('[data-hcms-path="products.0.name"]')
    for (let el = leaf.parentElement; ; el = el.parentElement) {
      assert.equal(
        el.classList.contains('is-hcms-inline-onpath'),
        true,
        `ancestor ${el.tagName}.${el.className} is not on the path`
      )
      if (el === formRoot) break
    }
    assert.deepEqual(
      pathsShowing(formRoot, 'is-hcms-inline-onpath').sort(),
      ['', 'products', 'products.0'],
      'and no path-carrying wrapper outside that chain was marked'
    )

    // A second activation replaces the first rather than adding to it.
    clickHandle(t, 'hero')
    assert.deepEqual(pathsShowing(formRoot, 'is-hcms-inline-active'), ['hero'])
    assert.deepEqual(pathsShowing(formRoot, 'is-hcms-inline-onpath'), [''])
    assert.equal(pop.style.transform, POP_BELOW_HERO)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: the popover is unhidden BEFORE it is measured', () => {
  const t = boot(POP)
  try {
    const { pop } = parts(t)
    // Record what `hidden` was at the moment of measurement, not afterwards: a
    // measurement taken while hidden reads 0x0 and places the popover at the
    // clamp, and the final position alone would happily agree with itself.
    const measuredWhileHidden = []
    pop.getBoundingClientRect = function () {
      measuredWhileHidden.push(this.hidden)
      return POP_BOX
    }

    clickHandle(t, 'hero')

    assert.deepEqual(measuredWhileHidden, [false], 'measured once, and only after being revealed')
    assert.equal(pop.style.transform, POP_BELOW_HERO)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: a textarea revealed with the popover is re-sized, not left at 0px', () => {
  const t = boot(POP)
  try {
    const { pop, formRoot } = parts(t)
    setBox(pop, POP_BOX)
    const textarea = formRoot.querySelector('[data-hcms-path="caption"] textarea')
    assert.ok(textarea)
    // enhanceFields already autosized it at mount, while the popover was hidden
    // and everything in it measured zero.
    assert.equal(textarea.style.height, '0px')
    Object.defineProperty(textarea, 'scrollHeight', { value: 88, configurable: true })

    clickHandle(t, 'caption')

    assert.equal(textarea.style.height, '88px', 'sized again now that it has a height to read')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: hovering a target outlines it, hovering off it puts the outline away', () => {
  const t = boot(POP)
  try {
    const { highlight } = parts(t)
    assert.ok(highlight, 'the layer owns one reusable highlight')
    assert.equal(highlight.hidden, true)

    // Nothing is written to the page for discovery: marking each target with an
    // attribute would put editor state into an authored element.
    const pageHtml = () => [...t.doc.body.children]
      .filter((child) => child.tagName !== 'HYPERCMS-INLINE')
      .map((child) => child.outerHTML)
      .join('')
    const untouched = pageHtml()

    hover(t, t.doc.querySelector('.hero'))
    assert.equal(highlight.hidden, false)
    assert.equal(highlight.style.transform, 'translate(40px, 100px)')
    assert.equal(highlight.style.width, '200px')
    assert.equal(highlight.style.height, '120px')

    // Inside a text target: it has no handle, so this outline is the only thing
    // that says it can be edited at all.
    hover(t, t.doc.querySelector('.jump'))
    assert.equal(highlight.hidden, false)
    assert.equal(highlight.style.transform, 'translate(0px, 0px)', 'moved to the h1, not the link')
    assert.equal(highlight.style.width, '300px')

    // .grid contains a target but is not one itself.
    hover(t, t.doc.querySelector('.grid'))
    assert.equal(highlight.hidden, true, 'hovering off every target puts it away')

    assert.equal(pageHtml(), untouched, 'three hovers changed not one byte of the page')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: the outline follows its target when the page scrolls under it', () => {
  const t = boot(POP)
  try {
    const { highlight } = parts(t)
    t.frames.flush()
    t.io.report(true)
    t.frames.flush()

    hover(t, t.doc.querySelector('.hero'))
    assert.equal(highlight.style.transform, 'translate(40px, 100px)')

    setBox(t.doc.querySelector('.hero'), box(40, 20, 200, 120))
    t.win.dispatchEvent(new t.win.Event('resize'))
    t.frames.flush()
    assert.equal(highlight.style.transform, 'translate(40px, 20px)')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: an open popover re-places itself in the layer frame pass', () => {
  const t = boot(POP)
  try {
    const { pop } = parts(t)
    setBox(pop, POP_BOX)
    t.frames.flush()
    t.io.report(true)
    t.frames.flush()

    clickHandle(t, 'hero')
    assert.equal(pop.style.transform, POP_BELOW_HERO)

    // The hero scrolls 80px up. Same ladder rung, new anchor: 140 + 16.
    setBox(t.doc.querySelector('.hero'), box(40, 20, 200, 120))
    t.win.dispatchEvent(new t.win.Event('resize'))
    t.frames.flush()
    assert.equal(pop.style.transform, 'translate(40px, 156px)')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: Escape closes it, clears both classes and hands focus back to the handle', () => {
  const t = boot(POP)
  try {
    const { host, pop, formRoot } = parts(t)
    setBox(pop, POP_BOX)
    const handle = clickHandle(t, 'hero')
    assert.equal(pop.hidden, false)
    assert.notEqual(t.doc.activeElement, handle, 'focus went into the revealed field')

    const focused = t.doc.activeElement
    focused.dispatchEvent(new t.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    assert.equal(pop.hidden, true)
    assert.equal(host.querySelectorAll('.is-hcms-inline-active, .is-hcms-inline-onpath').length, 0)
    assert.equal(formRoot.classList.contains('is-hcms-inline-onpath'), false)
    assert.equal(t.doc.activeElement, handle, 'focus returns to the handle that opened it')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: a click outside every target closes it', () => {
  const t = boot(POP)
  try {
    const { pop } = parts(t)
    setBox(pop, POP_BOX)
    clickHandle(t, 'hero')
    assert.equal(pop.hidden, false)

    // Inside the popover: the editor's own chrome, which must not close it.
    fire(t, pop, 'click')
    assert.equal(pop.hidden, false)

    fire(t, t.doc.querySelector('.grid'), 'click')
    assert.equal(pop.hidden, true)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: a link inside a target does not navigate while the session is open', () => {
  const t = boot(POP)
  try {
    // .jump sits inside the .title text target, whose click is otherwise left
    // alone so the caret can land where the person pressed. The link is the one
    // exception: following it would navigate away mid-edit.
    const linkClick = fire(t, t.doc.querySelector('.jump'), 'click')
    assert.equal(linkClick.defaultPrevented, true, 'the link must not navigate')

    // The rest of the same text target keeps its default click.
    const textClick = fire(t, t.doc.querySelector('.title'), 'click')
    assert.equal(textClick.defaultPrevented, false, 'a text target still gets its caret')

    // A non-text target is prevented: its click opens the popover instead.
    const heroClick = fire(t, t.doc.querySelector('.hero'), 'click')
    assert.equal(heroClick.defaultPrevented, true)
    assert.equal(parts(t).pop.hidden, false, 'and clicking the page element opens the same popover')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: destroy unbinds every page-level listener and leaves the page inert', () => {
  if (isOpen()) close()
  const dom = loadPage(POP)
  const win = dom.window
  const doc = win.document
  const frames = stubFrames(win)
  stubIntersection(win)

  const el = (sel) => doc.querySelector(sel)
  setBox(el('.title'), box(0, 0, 300, 40))
  setBox(el('.jump'), JUMP)
  setBox(el('.caption'), CAPTION)
  setBox(el('.hero'), HERO)
  setBox(el('.grid'), GRID)
  setBox(el('.product-name'), PRODUCT)

  // Identity-matched add/remove pairs. Asserting behaviour instead would pass
  // for the wrong reason: a leaked listener closes over a nulled layer and
  // no-ops anyway, so only the removal itself is observable.
  const added = []
  const removed = []
  const origAdd = doc.body.addEventListener.bind(doc.body)
  const origRemove = doc.body.removeEventListener.bind(doc.body)
  doc.body.addEventListener = (type, fn, opts) => { added.push([type, fn]); origAdd(type, fn, opts) }
  doc.body.removeEventListener = (type, fn, opts) => { removed.push([type, fn]); origRemove(type, fn, opts) }

  open({ view: 'inline' })
  const host = doc.querySelector('hypercms-inline')
  const highlight = host.querySelector('.hcms-inline-highlight')
  el('.hero').dispatchEvent(new win.Event('pointerover', { bubbles: true }))
  assert.equal(highlight.hidden, false, 'the listeners were live before the close')

  close()

  const PAGE_EVENTS = ['pointerover', 'pointerleave', 'click']
  const mine = added.filter(([type]) => PAGE_EVENTS.includes(type))
  assert.deepEqual(mine.map(([type]) => type).sort(), [...PAGE_EVENTS].sort(), 'all three were bound')
  for (const [type, fn] of mine) {
    assert.ok(
      removed.some(([t2, f2]) => t2 === type && f2 === fn),
      `the ${type} listener was never removed`
    )
  }

  assert.equal(doc.querySelector('hypercms-inline'), null)
  el('.hero').dispatchEvent(new win.Event('pointerover', { bubbles: true }))
  assert.equal(frames.pending.size, 0, 'a closed session schedules nothing')

  doc.body.addEventListener = origAdd
  doc.body.removeEventListener = origRemove
  reset(dom)
})

// The shipped display rules, lifted out of the generated stylesheet rather than
// retyped: a test carrying its own copy of the CSS cannot catch the CSS being
// wrong. jsdom's parser gives up partway through the full mirk sheet and drops
// every rule after it, so only these two are installed.
function displayRules() {
  const css = fs.readFileSync(new URL('../src/theme.generated.css', import.meta.url), 'utf8')
  const rules = css.match(/[^{}]*\[data-hcms-path\][^{}]*\{[^{}]*\}/g) || []
  assert.equal(rules.length, 2, 'run npm run build:theme — the one-field rules are not in the theme')
  return rules.join('\n')
}

test('inline popover: the shipped CSS displays the revealed leaf and nothing else', () => {
  installStyles(displayRules())
  const t = boot(POP)
  try {
    const { pop, formRoot } = parts(t)
    setBox(pop, POP_BOX)
    const display = (el) => t.win.getComputedStyle(el).display
    const wrappers = () => [...formRoot.querySelectorAll('[data-hcms-path]')]
    assert.ok(wrappers().length >= 6, 'the inline form is a real form, not an empty one')

    for (const el of wrappers()) {
      assert.equal(display(el), 'none', `${el.getAttribute('data-hcms-path')} shows before activation`)
    }

    clickHandle(t, 'products.0.name')

    assert.deepEqual(
      wrappers().filter((el) => display(el) !== 'none').map((el) => el.getAttribute('data-hcms-path')),
      ['', 'products', 'products.0', 'products.0.name'],
      'the leaf and its chain, and nothing else'
    )
  } finally {
    close()
    installStyles('')
  }
  reset(t.dom)
})

// [data-hcms-shell] is on BOTH hosts, so scoping the hide rule to it instead of
// to .hcms-inline would take the sidebar's entire form down with it.
test('inline popover: the hide rule leaves the sidebar form alone', () => {
  installStyles(displayRules())
  if (isOpen()) close()
  const dom = loadPage(POP)
  open()
  try {
    const formRoot = dom.window.document.querySelector('.hcms-panel [data-hcms-form-root]')
    assert.ok(formRoot, 'the sidebar mounted')
    const wrappers = [...formRoot.querySelectorAll('[data-hcms-path]')]
    assert.ok(wrappers.length >= 6, 'the sidebar built a real form')
    for (const el of wrappers) {
      assert.notEqual(
        dom.window.getComputedStyle(el).display,
        'none',
        `the sidebar's "${el.getAttribute('data-hcms-path')}" field was hidden by an inline rule`
      )
    }
  } finally {
    close()
    installStyles('')
  }
  reset(dom)
})

test('inline popover: each open starts its own placement, not the last one\'s', () => {
  const t = boot(POP)
  try {
    const { pop } = parts(t)
    setBox(pop, POP_BOX)

    clickHandle(t, 'hero')
    assert.equal(pop.style.transform, POP_BELOW_HERO, 'the first open lands below its anchor')

    // A tall anchor whose 'below' rung misses by 2px: 606 + 16 + 140 = 762,
    // against a 760 floor. place()'s 4px of hysteresis would let it through,
    // but only for a popover that is ALREADY below something — and this one
    // has just opened. Carrying the previous open's mode in would place it
    // off the bottom of the viewport.
    setBox(t.doc.querySelector('.caption'), box(40, 100, 200, 506))
    clickHandle(t, 'caption')
    assert.equal(pop.style.transform, 'translate(256px, 100px)', 'beside the anchor, not below it')
  } finally {
    close()
  }
  reset(t.dom)
})

// Same trick as displayRules(): the shipped rules, not a copy of them.
function pointerEventRules() {
  const css = fs.readFileSync(new URL('../src/theme.generated.css', import.meta.url), 'utf8')
  const rules = css.match(/[^{}]*\{[^{}]*pointer-events[^{}]*\}/g) || []
  assert.ok(rules.length >= 4, 'run npm run build:theme')
  return rules.join('\n')
}

// `.hcms-inline-layer > *` turns pointer events back on for every direct child,
// and the highlight is one. Both selectors weigh the same, so only source order
// keeps the outline from swallowing the click it is drawn over.
test('inline popover: the highlight does not eat the click it is drawn over', () => {
  installStyles(pointerEventRules())
  const t = boot(POP)
  try {
    const { highlight } = parts(t)
    hover(t, t.doc.querySelector('.hero'))
    const style = (el) => t.win.getComputedStyle(el).pointerEvents
    assert.equal(style(highlight), 'none')
    assert.equal(style(handles(t.layerEl)[0]), 'auto', 'a handle is still clickable')
  } finally {
    close()
    installStyles('')
  }
  reset(t.dom)
})

test('inline popover: the on-path walk stops at the form root and never reaches the page', () => {
  const t = boot(POP)
  try {
    const { host, pop, formRoot } = parts(t)
    setBox(pop, POP_BOX)
    clickHandle(t, 'products.0.name')
    assert.equal(pop.hidden, false, 'the popover really did open')

    // The walk climbs from the leaf until it hits the form root. Nothing above
    // that is the CMS's to mark: <body> and <html> are the author's elements and
    // they reach the saved file, while clearPathClasses only ever queries
    // DOWNWARD from the host, so a class left up here would never come off.
    for (const el of [formRoot.parentElement, pop, host, t.doc.body, t.doc.documentElement]) {
      assert.equal(
        el.classList.contains('is-hcms-inline-onpath'),
        false,
        `${el.tagName} above the form root was marked and can never be unmarked`
      )
    }
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: an open popover survives a refresh instead of going blank', () => {
  const t = boot(POP)
  try {
    const { pop, formRoot } = parts(t)
    setBox(pop, POP_BOX)
    clickHandle(t, 'hero')
    assert.deepEqual(pathsShowing(formRoot, 'is-hcms-inline-active'), ['hero'])

    // morphForm re-syncs every field from a form built without these classes.
    // The leaf keeps its identity and loses only its class, so the popover
    // stays open over nothing at all unless the reveal is re-applied.
    const leafBefore = formRoot.querySelector('[data-hcms-path="hero"]')
    refresh()

    assert.equal(pop.hidden, false, 'the popover is still open')
    assert.deepEqual(
      pathsShowing(formRoot, 'is-hcms-inline-active'),
      ['hero'],
      'and still showing the field it was opened for'
    )
    assert.equal(
      formRoot.querySelector('[data-hcms-path="hero"]'),
      leafBefore,
      'the same element throughout: this is a re-sync, not a rebuild'
    )
    for (let el = leafBefore.parentElement; ; el = el.parentElement) {
      assert.equal(el.classList.contains('is-hcms-inline-onpath'), true, 'chain intact')
      if (el === formRoot) break
    }
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: a refresh that removes the edited element closes the popover', () => {
  const t = boot(POP)
  try {
    const { pop, formRoot } = parts(t)
    setBox(pop, POP_BOX)
    clickHandle(t, 'hero')
    assert.equal(pop.hidden, false)

    // A live-sync can delete the row being edited. Its rect then measures zero
    // and the popover would place itself against the viewport clamp, floating
    // over unrelated content with no way back to what it was editing.
    t.doc.querySelector('.hero').remove()
    refresh()

    assert.equal(pop.hidden, true, 'the popover closed with its element')
    assert.deepEqual(pathsShowing(formRoot, 'is-hcms-inline-active'), [])
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline popover: a refresh does not pull focus back into the popover', () => {
  const t = boot(POP)
  try {
    const { pop } = parts(t)
    setBox(pop, POP_BOX)
    clickHandle(t, 'hero')
    assert.equal(pop.hidden, false)

    // A refresh fires on any page mutation, so it can land while someone is
    // typing. Re-focusing the field on every one would jump the caret back to
    // the top of it mid-sentence, which is worse than the blank popover the
    // reveal was restored to fix.
    t.doc.activeElement?.blur()
    const before = t.doc.activeElement
    refresh()

    assert.equal(t.doc.activeElement, before, 'focus stayed where the person left it')
  } finally {
    close()
  }
  reset(t.dom)
})

// The popover and the handles are both positioned children of the same host, so
// which one paints on top is decided by z-index alone. Lifted from the shipped
// stylesheet rather than retyped, for the same reason displayRules is.
function stackingRules() {
  const css = fs.readFileSync(new URL('../src/theme.generated.css', import.meta.url), 'utf8')
  const rules = ['.hcms-inline-pop', '.hcms-inline-handle'].map((sel) => {
    const re = new RegExp(`\\${sel}\\s*\\{[^{}]*\\}`, 'g')
    const found = (css.match(re) || []).filter((r) => r.includes('z-index'))
    assert.equal(found.length, 1, `run npm run build:theme — no z-index rule for ${sel}`)
    return found[0]
  })
  return rules.join('\n')
}

test('inline popover: the popover paints above the handles, not under them', () => {
  installStyles(stackingRules())
  const t = boot(POP)
  try {
    const { pop } = parts(t)
    setBox(pop, POP_BOX)
    clickHandle(t, 'hero')

    const z = (el) => Number(t.win.getComputedStyle(el).zIndex)
    const handle = t.layerEl.querySelector('.hcms-inline-handle')
    assert.ok(Number.isFinite(z(handle)), 'the handle really does carry a z-index')
    assert.ok(
      z(pop) > z(handle),
      `the popover (${z(pop)}) must paint above the handle (${z(handle)}), or a handle ` +
      'sits over the field it just opened and covers the text in it'
    )
  } finally {
    close()
    installStyles('')
  }
  reset(t.dom)
})

// ---- B2b-4: lists inline -----------------------------------------------------

// One object array of three rows and one scalar array, so the same controls can
// be shown to work on a card list and on a run of <li>s.
const LISTS = page(
  `{
    "products": [".product", { "name": ".product-name" }],
    "tags": "li.tag[]"
  }`,
  `<div class="grid">
    <article class="product"><h3 class="product-name">One</h3></article>
    <article class="product"><h3 class="product-name">Two</h3></article>
    <article class="product"><h3 class="product-name">Three</h3></article>
  </div>
  <ul class="tags"><li class="tag">a</li><li class="tag">b</li></ul>`
)

// A list emptied down to the hidden seed the engine grows new rows from. It has
// no rows at all, so nothing but the seed says where a row would go.
const SEEDED = page(
  `{ "tags": "li.tag[]" }`,
  // Deliberately not `ul.tags`, which boot hands a box: an emptied list's
  // container really does measure zero, and that is the whole reason the Add is
  // not gated on the anchor floor the rows are.
  `<ul class="taglist"><li class="tag" cms-template>seed</li></ul>`
)

function showControls(t) {
  t.frames.flush()
  t.io.report(true)
  t.frames.flush()
}

function strip(t, path, row) {
  return t.layerEl.querySelector(
    `.hcms-inline-row-controls[data-hcms-list="${path}"][data-hcms-row="${row}"]`
  )
}

function rowButton(t, path, row, action) {
  const el = strip(t, path, row)
  assert.ok(el, `no strip for ${path}.${row}`)
  const button = el.querySelector(`[data-hcms-list-action="${action}"]`)
  assert.ok(button, `no ${action} button on ${path}.${row}`)
  return button
}

function clickRow(t, path, row, action) {
  const button = rowButton(t, path, row, action)
  fire(t, button, 'click')
  return button
}

function addButton(t, path) {
  return t.layerEl.querySelector(`.hcms-inline-list-add[data-hcms-list="${path}"]`)
}

function pageNames(t) {
  return [...t.doc.querySelectorAll('.product-name')].map((el) => el.textContent)
}

function formRows(t, path) {
  const arrayEl = t.host.querySelector(`[data-hcms-path="${path}"]`)
  assert.ok(arrayEl, `the form has no array at "${path}"`)
  const slot = arrayEl.querySelector('.hcms-array-items')
  assert.ok(slot, `the form array at "${path}" has no items slot`)
  return [...slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]')]
}

test('inline lists: ↑ and ↓ move the FORM row, and the page rows follow on the commit', () => {
  const t = boot(LISTS)
  try {
    showControls(t)
    assert.deepEqual(pageNames(t), ['One', 'Two', 'Three'])

    const before = formRows(t, 'products')
    assert.deepEqual(
      before.map((row) => row.getAttribute('data-hcms-path')),
      ['products.0', 'products.1', 'products.2']
    )

    clickRow(t, 'products', 1, 'move-up')

    // -1 on the SECOND row: the form row that was at index 1 is now at index 0,
    // which is both "the form row moved" and "the direction was up".
    const after = formRows(t, 'products')
    assert.equal(after[0], before[1], 'the second form row is the one that moved')
    assert.equal(after[1], before[0], 'and the first row took its place')
    assert.deepEqual(
      after.map((row) => row.getAttribute('data-hcms-path')),
      ['products.0', 'products.1', 'products.2'],
      'the paths were restamped behind the move'
    )
    assert.deepEqual(pageNames(t), ['Two', 'One', 'Three'], 'the commit moved the page rows')

    // The strips are stamped with a row index at build time, so the +1 half of
    // this runs against a freshly built set rather than a stale one.
    refresh()
    clickRow(t, 'products', 0, 'move-down')
    assert.deepEqual(pageNames(t), ['One', 'Two', 'Three'], '+1 puts it back')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: ✕ routes through requestRemove, so an object array still asks first', async () => {
  const t = boot(LISTS)
  try {
    showControls(t)
    const asked = []
    t.win.hyperclay.consent = (message) => {
      asked.push(message)
      return Promise.resolve()
    }

    clickRow(t, 'products', 0, 'remove')

    assert.deepEqual(asked, ['Delete this item?'], 'the consent modal an object array raises')
    assert.equal(t.doc.querySelectorAll('.product').length, 3, 'nothing goes before they agree')

    await Promise.resolve()
    await Promise.resolve()

    assert.equal(t.doc.querySelectorAll('.product').length, 2)
    assert.deepEqual(pageNames(t), ['Two', 'Three'], 'and it was the row they pressed')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: Add appends through onAdd, and the new row gets its own controls on the next refresh', () => {
  const t = boot(LISTS)
  try {
    showControls(t)
    assert.equal(strip(t, 'products', 3), null, 'nothing is drawn for a row that does not exist yet')

    fire(t, addButton(t, 'products'), 'click')

    assert.equal(t.doc.querySelectorAll('.product').length, 4, 'the page grew a row')
    assert.deepEqual(pageNames(t), ['One', 'Two', 'Three', ''], 'appended, at the end')

    // The engine cloned the last row, and a clone does not carry the stubbed
    // rect its original was given, so the new row would fail the anchor floor
    // for a reason that exists only in jsdom.
    setBox(t.doc.querySelectorAll('.product')[3], box(300, 610, 360, 60))
    refresh()

    assert.ok(strip(t, 'products', 3), 'the new row carries its own strip')
    assert.equal(
      rowButton(t, 'products', 3, 'move-down').hidden,
      true,
      'the new row is the last one now'
    )
    assert.equal(
      rowButton(t, 'products', 2, 'move-down').hidden,
      false,
      'and the row that used to be last can move down'
    )
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: a list emptied down to its [cms-template] seed still offers Add', () => {
  const t = boot(SEEDED)
  try {
    showControls(t)
    const rows = () => t.doc.querySelectorAll('li.tag:not([cms-template])')
    assert.equal(rows().length, 0, 'nothing but the seed')
    assert.equal(strip(t, 'tags', 0), null, 'and so no row strips')

    // The container came from the seed, which is the only thing on an emptied
    // list that says where a row goes. Without it this list could never be grown
    // back from the page at all.
    const add = addButton(t, 'tags')
    assert.ok(add, 'the list most in need of an Add is the one with no rows')

    fire(t, add, 'click')

    assert.equal(formRows(t, 'tags').length, 1, 'the form grew a row')
    assert.equal(rows().length, 1, 'and the commit grew the page from the seed')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: the first row has no ↑ and the last has no ↓', () => {
  const t = boot(LISTS)
  try {
    showControls(t)

    assert.equal(rowButton(t, 'products', 0, 'move-up').hidden, true, 'the first cannot move up')
    assert.equal(rowButton(t, 'products', 0, 'move-down').hidden, false)
    assert.equal(rowButton(t, 'products', 1, 'move-up').hidden, false, 'a middle row does both')
    assert.equal(rowButton(t, 'products', 1, 'move-down').hidden, false)
    assert.equal(rowButton(t, 'products', 2, 'move-up').hidden, false)
    assert.equal(rowButton(t, 'products', 2, 'move-down').hidden, true, 'the last cannot move down')

    // Remove is on every row, so "hidden" above is about the move rule and not
    // about the strip being drawn wrong.
    for (const row of [0, 1, 2]) {
      assert.equal(rowButton(t, 'products', row, 'remove').hidden, false)
    }

    // The same rule on a scalar list of two, where first and last are the only
    // rows there are.
    assert.equal(rowButton(t, 'tags', 0, 'move-up').hidden, true)
    assert.equal(rowButton(t, 'tags', 0, 'move-down').hidden, false)
    assert.equal(rowButton(t, 'tags', 1, 'move-up').hidden, false)
    assert.equal(rowButton(t, 'tags', 1, 'move-down').hidden, true)
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: Hide controls puts the strips and the Adds away and leaves the handles alone', () => {
  const t = boot(MIXED)
  try {
    showControls(t)
    const controls = () => [...t.layerEl.querySelectorAll('.hcms-inline-row-controls, .hcms-inline-list-add')]
    assert.ok(controls().length >= 3, 'the tags list drew two strips and an Add')
    for (const el of controls()) assert.equal(el.hidden, false)
    for (const handle of handles(t.layerEl)) assert.equal(handle.hidden, false)

    const toggle = t.host.querySelector('[data-hcms-controls-toggle]')
    assert.ok(toggle, 'the session bar carries the toggle')
    fire(t, toggle, 'click')

    for (const el of controls()) assert.equal(el.hidden, true, 'every list control is away')
    for (const handle of handles(t.layerEl)) {
      assert.equal(handle.hidden, false, 'a handle is not a list control and must stay')
    }
    assert.equal(toggle.getAttribute('aria-pressed'), 'true')
    assert.equal(toggle.querySelector('.mirk-button__label').textContent, 'Show controls')

    // A toggle, not a mode: pressing it again brings them back where they were.
    fire(t, toggle, 'click')
    t.frames.flush()
    for (const el of controls()) assert.equal(el.hidden, false)
    assert.equal(toggle.getAttribute('aria-pressed'), 'false')
    assert.equal(toggle.querySelector('.mirk-button__label').textContent, 'Hide controls')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: the controls survive a refresh, rebuilt against the page as it now is', () => {
  const t = boot(LISTS)
  try {
    showControls(t)
    assert.ok(strip(t, 'products', 2), 'three rows, three strips')
    assert.equal(strip(t, 'products', 3), null)

    // A page-side change the session did not make — a live-sync, or another
    // script. refreshForm re-syncs the form; the controls have to be rebuilt
    // with it or the fourth row has no way to be moved or removed at all.
    const grid = t.doc.querySelector('.grid')
    const fourth = t.doc.createElement('article')
    fourth.className = 'product'
    fourth.innerHTML = '<h3 class="product-name">Four</h3>'
    grid.appendChild(fourth)
    setBox(fourth, box(300, 610, 360, 60))

    refresh()

    assert.ok(strip(t, 'products', 3), 'the row that appeared has controls')
    assert.equal(
      rowButton(t, 'products', 2, 'move-down').hidden,
      false,
      'and the row that was last is no longer the last'
    )

    // Still wired, not just still drawn.
    for (const el of t.layerEl.querySelectorAll('.hcms-inline-row-controls')) setBox(el, STRIP)
    clickRow(t, 'products', 3, 'move-up')
    assert.deepEqual(pageNames(t), ['One', 'Two', 'Four', 'Three'])
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: the control moves no page node itself — the commit does', () => {
  const t = boot(LISTS)
  try {
    showControls(t)
    assert.deepEqual(pageNames(t), ['One', 'Two', 'Three'])

    // What the page looked like at the moment the apply began. captureChildren
    // runs INSIDE applyWithRollback (apply-loop.js:39), after the caller has
    // already mutated, so a control that moved the page row first would have its
    // reorder snapshotted as the state to roll back TO.
    const real = engine.apply
    const atApply = []
    engine.apply = (...args) => {
      atApply.push(pageNames(t))
      return real(...args)
    }
    try {
      clickRow(t, 'products', 1, 'move-up')
    } finally {
      engine.apply = real
    }

    assert.deepEqual(atApply, [['One', 'Two', 'Three']], 'the page was untouched when the commit began')
    assert.deepEqual(pageNames(t), ['Two', 'One', 'Three'], 'and the commit is what moved it')
  } finally {
    close()
  }
  reset(t.dom)
})

test('inline lists: a failed apply rolls back to the pre-move page, not to a half-moved one', () => {
  const t = boot(LISTS)
  try {
    showControls(t)
    const failures = []
    t.doc.addEventListener('hcms:error', (event) => failures.push(event.detail.error.message))

    const real = engine.apply
    engine.apply = () => { throw new Error('apply refused') }
    try {
      clickRow(t, 'products', 1, 'move-up')
    } finally {
      engine.apply = real
    }

    // The apply really was attempted: without this the assertion below would
    // pass just as happily for a click that did nothing at all.
    assert.deepEqual(failures, ['apply refused'], 'the failure surfaced')
    assert.deepEqual(
      pageNames(t),
      ['One', 'Two', 'Three'],
      'the rollback restored the order the page had before the click'
    )
  } finally {
    close()
  }
  reset(t.dom)
})
