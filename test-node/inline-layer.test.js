import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

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
// placeHandle sits the handle on the anchor's top-right corner, overlapping by
// its 6px inset, clamped to the viewport. Spelled out rather than recomputed
// from place.js so a placement regression cannot agree with itself.
const HERO_AT = 'translate(222px, 94px)'
const LINK_AT = 'translate(122px, 254px)'

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
  for (const li of doc.querySelectorAll('li.tag')) setBox(li, box(0, 500, 80, 20))

  open({ view: 'inline' })

  const host = doc.querySelector('hypercms-inline')
  const layerEl = host.querySelector('.hcms-inline-layer')
  const countEl = host.querySelector('.hcms-inline-count')
  for (const handle of layerEl.querySelectorAll('.hcms-inline-handle')) setBox(handle, HANDLE)

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

    assert.deepEqual(
      t.io.current.observed,
      [t.doc.querySelector('.hero'), t.doc.querySelector('.link')],
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
    assert.equal(none.layerEl.children.length, 0)
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
