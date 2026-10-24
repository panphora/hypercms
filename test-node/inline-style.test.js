import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'
import { resolveTargets, styleGroups } from '../src/targets.js'
import { COLORS } from '../src/catalogs/colors.js'

const ZERO = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }

function box(left, top, width, height) {
  return { width, height, top, left, right: left + width, bottom: top + height, x: left, y: top }
}

function setBox(el, b) {
  el.__box = b
  el.getBoundingClientRect = () => (el.hidden ? ZERO : el.__box)
  const group = el.closest('.hcms-inline-item-controls')
  if (group) group.getBoundingClientRect = () => {
    if (group.hidden) return ZERO
    const sizes = [...group.children].filter((child) => !child.hidden).map((child) => child.getBoundingClientRect())
    return box(0, 0, sizes.reduce((width, size) => width + size.width, Math.max(0, sizes.length - 1) * 2), Math.max(0, ...sizes.map((size) => size.height)))
  }
  return el
}

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

const HTML_ATTRS = `style="--color-accent: #123456; --font-body: 'Inter', sans-serif"`

const RULES = {
  theme: { accent: 'html@--color-accent', body: 'html@--font-body' },
  features: { heading: '#f h2', layout: '#f@data-layout', background: '#f@--color-section-bg' },
  cards: ['.card', { name: 'h3', tint: '@--color-tint' }],
}

const BODY = `<section id="f" data-layout="2" style="--color-section-bg: #eeeeee"
  data-hcms-component:data-layout="variant" data-hcms-options:data-layout="1:cols-1 2:cols-2">
  <h2>Features</h2>
  <div class="card" style="--color-tint: #ff0000"><h3>One</h3></div>
  <div class="card" style="--color-tint: #00ff00"><h3>Two</h3></div>
</section>`

const FIXTURE = `<!DOCTYPE html><html ${HTML_ATTRS}><head>
  <style id="x">body { margin: 0 }</style>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">${JSON.stringify(RULES)}</script>
</head><body>
  ${BODY}
</body></html>`

const SKY_600 = COLORS.find((c) => c.id === 'sky-600').value

function boot(html = FIXTURE) {
  if (isOpen()) close()
  const dom = loadPage(html)
  const win = dom.window
  const doc = win.document
  const frames = stubFrames(win)
  const io = stubIntersection(win)

  const el = (sel) => doc.querySelector(sel)
  if (el('#f')) setBox(el('#f'), box(20, 20, 600, 400))
  if (el('#f h2')) setBox(el('#f h2'), box(40, 40, 200, 30))
  doc.querySelectorAll('.card').forEach((card, i) => setBox(card, box(40 + i * 220, 100, 200, 120)))
  doc.querySelectorAll('.card h3').forEach((h3, i) => setBox(h3, box(60 + i * 220, 120, 160, 30)))
  doc.querySelectorAll('li').forEach((li, i) => setBox(li, box(40, 100 + i * 40, 200, 32)))
  if (el('h1')) setBox(el('h1'), box(40, 40, 300, 40))

  open({ view: 'inline' })

  const host = doc.querySelector('hypercms-inline')
  const layerEl = host.querySelector('.hcms-inline-layer')
  for (const handle of layerEl.querySelectorAll('.hcms-inline-handle')) setBox(handle, box(0, 0, 24, 24))
  for (const chip of layerEl.querySelectorAll('.hcms-inline-style-chip')) setBox(chip, box(0, 0, 60, 28))
  for (const strip of layerEl.querySelectorAll('.hcms-inline-row-controls')) setBox(strip, box(0, 0, 90, 28))
  for (const settings of layerEl.querySelectorAll('.hcms-inline-settings')) setBox(settings, box(0, 0, 24, 24))

  return { dom, win, doc, frames, io, host, layerEl }
}

test('resolveTargets: style roles are reported when a doc is given', () => {
  const dom = loadPage(FIXTURE)
  try {
    const doc = dom.window.document
    const withDoc = resolveTargets(doc, RULES, doc).targets
    const role = (path) => withDoc.find((target) => target.path.join('.') === path)?.style
    assert.equal(role('theme.accent'), 'page')
    assert.equal(role('theme.body'), 'page')
    assert.equal(role('features.layout'), 'section')
    assert.equal(role('features.background'), 'section')
    assert.equal(role('cards.0.tint'), 'section')
    assert.equal(role('features.heading'), null)

    const withoutDoc = resolveTargets(doc, RULES).targets
    assert.ok(withoutDoc.length > 0)
    assert.ok(withoutDoc.every((target) => target.style === null))

    const styled = resolveTargets(doc, { css: 'style#x' }, doc).targets
    assert.equal(styled.length, 1)
    assert.equal(styled[0].kind, 'handle')
    assert.equal(styled[0].style, null)
  } finally {
    reset(dom)
  }
})

test('styleGroups: page, section and row groups', () => {
  const dom = loadPage(FIXTURE)
  try {
    const doc = dom.window.document
    const { targets, lists } = resolveTargets(doc, RULES, doc)
    const groups = styleGroups(targets, lists)
    const pageGroup = groups.find((group) => group.scope === 'page')
    assert.deepEqual(pageGroup.paths, ['theme.accent', 'theme.body'])
    const sectionGroup = groups.find((group) => group.scope === 'section')
    assert.equal(sectionGroup.el, doc.querySelector('#f'))
    assert.deepEqual(sectionGroup.paths, ['features.layout', 'features.background'])
    const rowGroups = groups.filter((group) => group.scope === 'row')
    assert.equal(rowGroups.length, 2)
    assert.equal(rowGroups[0].el, doc.querySelectorAll('.card')[0])
    assert.deepEqual(rowGroups[0].paths, ['cards.0.tint'])
    assert.equal(rowGroups[1].el, doc.querySelectorAll('.card')[1])
    assert.deepEqual(rowGroups[1].paths, ['cards.1.tint'])
  } finally {
    reset(dom)
  }
})

test('inline style: style fields are not handles or click targets', () => {
  const t = boot()
  try {
    const stylePaths = new Set(['theme.accent', 'theme.body', 'features.layout', 'features.background', 'cards.0.tint', 'cards.1.tint'])
    for (const handle of t.layerEl.querySelectorAll('.hcms-inline-handle')) {
      assert.ok(!stylePaths.has(handle.getAttribute('data-hcms-target')), `${handle.getAttribute('data-hcms-target')} must not be a handle`)
    }
    assert.equal(t.layerEl.querySelectorAll('.hcms-inline-style-chip').length, 1)

    const pop = t.host.querySelector('.hcms-inline-pop')
    t.doc.querySelector('#f').dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))
    t.frames.flush()
    assert.equal(pop.hidden, true, 'clicking the styled section itself opens nothing')
  } finally {
    close()
    reset(t.dom)
  }
})

test('inline style: the section chip opens only that section style fields', () => {
  const t = boot()
  try {
    const chip = t.layerEl.querySelector('.hcms-inline-style-chip')
    chip.dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))
    const pop = t.host.querySelector('.hcms-inline-pop')
    assert.equal(pop.hidden, false)
    const active = [...t.host.querySelectorAll('.is-hcms-inline-active')].map((el) => el.getAttribute('data-hcms-path'))
    assert.deepEqual(active.sort(), ['features.background', 'features.layout'])
    assert.equal(t.host.querySelector('.hcms-inline-pop-title').textContent, 'Style')
  } finally {
    close()
    reset(t.dom)
  }
})

test('inline style: the page style button opens the page style fields', () => {
  const t = boot()
  try {
    const button = t.host.querySelector('[data-hcms-page-style-open]')
    assert.equal(button.hidden, false)
    button.dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))

    const pop = t.host.querySelector('.hcms-inline-pop')
    assert.equal(pop.hidden, false)
    const active = () => [...t.host.querySelectorAll('.is-hcms-inline-active')].map((el) => el.getAttribute('data-hcms-path'))
    assert.deepEqual(active().sort(), ['theme.accent', 'theme.body'])
    assert.ok(t.host.querySelector('[data-hcms-page-style]').classList.contains('is-hcms-inline-onpath'))
    assert.equal(t.host.querySelector('.hcms-inline-pop-title').textContent, 'Page style')

    const accent = t.host.querySelector('[data-hcms-path="theme.accent"]')
    accent.querySelector('.hcms-color-current').dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))
    const sky = [...accent.querySelectorAll('.hcms-color-swatch')].find(
      (b) => b.getAttribute('data-hcms-color') === SKY_600
    )
    assert.ok(sky, 'sky-600 swatch rendered')
    sky.dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))

    const style = t.doc.documentElement.getAttribute('style')
    assert.match(style, /--color-accent:\s*oklch\(/)
    assert.match(style, /--font-body:\s*'Inter'/)
  } finally {
    close()
    reset(t.dom)
  }
})

test('inline style: a row gear menu offers Style above Delete', () => {
  const t = boot()
  try {
    const settings = t.layerEl.querySelector('.hcms-inline-settings[data-hcms-row="0"]')
    assert.ok(settings, 'first row settings rendered')
    const gear = settings.querySelector('[data-hcms-list-action="settings"]')
    gear.dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))

    const items = [...settings.querySelectorAll('[role="menuitem"]')]
    assert.deepEqual(items.map((item) => item.textContent), ['Style', 'Delete'])

    items[0].dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))
    const pop = t.host.querySelector('.hcms-inline-pop')
    assert.equal(pop.hidden, false)
    const active = [...t.host.querySelectorAll('.is-hcms-inline-active')].map((el) => el.getAttribute('data-hcms-path'))
    assert.deepEqual(active, ['cards.0.tint'])
  } finally {
    close()
    reset(t.dom)
  }
})

test('inline style: a page with no style fields keeps the old controls', () => {
  const plain = page('{"title":"h1","items":["li",{"name":"span"}]}', '<h1>Title</h1><ul><li><span>a</span></li></ul>')
  const t = boot(plain)
  try {
    t.io.report(true)
    t.frames.flush()
    const button = t.host.querySelector('[data-hcms-page-style-open]')
    assert.equal(button.hidden, true)
    assert.equal(t.layerEl.querySelectorAll('.hcms-inline-style-chip').length, 0)

    const settings = t.layerEl.querySelector('.hcms-inline-settings')
    assert.ok(settings, 'row settings rendered')
    const gear = settings.querySelector('[data-hcms-list-action="settings"]')
    gear.dispatchEvent(new t.win.MouseEvent('click', { bubbles: true }))
    const items = [...settings.querySelectorAll('[role="menuitem"]')]
    assert.equal(items.length, 1)
    assert.equal(items[0].textContent, 'Delete')
  } finally {
    close()
    reset(t.dom)
  }
})
