import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import {
  detectEditMode,
  injectToggle,
  maybeInjectToggle,
  parseRgb,
  pickSurface,
  readStoredView,
  TOGGLE_STYLE,
} from '../src/toggle.js'

// ---------------------------------------------------------------------------
// detectEditMode — mirrors hyperclayjs core/isAdminOfCurrentResource.js
// precedence: ?editmode param wins, then the forced global, then the owner
// cookie. Pure string logic pinned here; wiring rides the browser tier.
// ---------------------------------------------------------------------------

test('detectEditMode: ?editmode param wins over global and cookie', () => {
  assert.equal(detectEditMode({ search: '?editmode=true' }), true)
  assert.equal(detectEditMode({ search: '?editmode=false', forced: true, cookie: 'isAdminOfCurrentResource=1' }), false)
  assert.equal(detectEditMode({ search: '?a=1&editmode=true' }), true)
  assert.equal(detectEditMode({ search: 'editmode=true' }), true)
  assert.equal(detectEditMode({ search: '?editmode=1' }), false)
})

test('detectEditMode: empty editmode param falls through to the cookie', () => {
  assert.equal(detectEditMode({ search: '?editmode=', cookie: 'isAdminOfCurrentResource=1' }), true)
  assert.equal(detectEditMode({ search: '?editmode=' }), false)
})

test('detectEditMode: forced global beats the cookie', () => {
  assert.equal(detectEditMode({ forced: true }), true)
  assert.equal(detectEditMode({ forced: false, cookie: 'isAdminOfCurrentResource=1' }), false)
})

test('detectEditMode: owner cookie needs a non-empty value under the exact name', () => {
  assert.equal(detectEditMode({ cookie: 'isAdminOfCurrentResource=1' }), true)
  assert.equal(detectEditMode({ cookie: 'a=1; isAdminOfCurrentResource=yes; b=2' }), true)
  assert.equal(detectEditMode({ cookie: 'isAdminOfCurrentResource=' }), false)
  assert.equal(detectEditMode({ cookie: 'xisAdminOfCurrentResource=1' }), false)
  assert.equal(detectEditMode({ cookie: '' }), false)
  assert.equal(detectEditMode({}), false)
  assert.equal(detectEditMode(), false)
})

// ---------------------------------------------------------------------------
// injectToggle — DOM shape, strip attributes, idempotence, click wiring.
// ---------------------------------------------------------------------------

function setupDom(url = 'http://localhost/page') {
  const dom = new JSDOM(
    // The head is deliberately NOT empty: with no existing child, appendChild
    // and insertBefore(x, head.firstChild) are indistinguishable, and the
    // "style is prepended" assertion below cannot fail.
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>Hi</h1></body></html>',
    { url }
  )
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  return dom
}

function spyApi(overrides = {}) {
  const calls = []
  return {
    calls,
    open: () => calls.push('open'),
    close: () => calls.push('close'),
    isOpen: () => false,
    hasRules: () => true,
    ...overrides,
  }
}

test('injectToggle: builds the button with the strip attributes, once', () => {
  const dom = setupDom()
  const api = spyApi()
  const btn = injectToggle(api, dom.window.document)
  assert.equal(btn.tagName.toLowerCase(), 'hypercms-toggle')
  assert.equal(btn.id, 'hcms-toggle')
  assert.ok(btn.hasAttribute('data-hcms-toggle-host'))
  assert.ok(btn.hasAttribute('no-save'))
  assert.ok(btn.hasAttribute('snapshot-remove'))
  assert.ok(btn.hasAttribute('save-ignore'))
  // No aria-label: it would override the visible text and freeze the accessible
  // name at one string while the button reads "Edit content" / "Close editor"
  // (WCAG 2.5.3). The two spans carry the name, and display:none swaps it.
  const main = btn.querySelector('.hcms-toggle__main')
  assert.equal(main.hasAttribute('aria-label'), false)
  assert.equal(btn.hasAttribute('aria-label'), false)
  assert.ok(btn.querySelector('button.hcms-toggle__main'))
  assert.equal(btn.querySelector('.hcms-toggle__open').textContent, 'Edit content')
  assert.equal(btn.querySelector('.hcms-toggle__close').textContent, 'Close editor')
  assert.equal(btn.style.getPropertyPriority('position'), 'important')
  assert.equal(btn.style.position, 'fixed')
  const style = dom.window.document.getElementById('hcms-toggle-style')
  assert.ok(style, 'style tag injected')
  assert.ok(style.hasAttribute('no-save'))
  assert.ok(style.hasAttribute('snapshot-remove'))
  assert.ok(style.hasAttribute('save-ignore'))
  assert.equal(dom.window.document.head.firstChild, style, 'style is prepended, not appended')
  assert.equal(dom.window.document.head.children.length, 2, 'and the page keeps what it had')
  assert.equal(injectToggle(api, dom.window.document), btn, 'second call returns the same node')
  assert.equal(dom.window.document.querySelectorAll('[data-hcms-toggle-host]').length, 1)
  assert.equal(dom.window.document.querySelectorAll('#hcms-toggle-style').length, 1)
  dom.window.close()
})

// One view available, so the main button opens it: with both views and nothing
// remembered the first press opens the MENU, which is the split button's own
// spec below.
test('injectToggle: click calls open when closed, close when open', () => {
  const dom = setupDom()
  let openState = false
  const api = spyApi({ isOpen: () => openState, views: ['sidebar'] })
  const btn = injectToggle(api, dom.window.document)
  btn.click()
  assert.deepEqual(api.calls, ['open'])
  openState = true
  btn.click()
  assert.deepEqual(api.calls, ['open', 'close'])
  dom.window.close()
})

test('injectToggle: a throwing open() is caught, not unhandled', async () => {
  const dom = setupDom()
  const api = spyApi({ open: () => { throw new Error('no rules') } })
  const btn = injectToggle(api, dom.window.document)
  assert.doesNotThrow(() => btn.click())
  await new Promise((r) => setTimeout(r, 0))
  dom.window.close()
})

test('injectToggle: a page that already owns #hcms-toggle still gets a control', () => {
  const dom = setupDom()
  const squatter = dom.window.document.createElement('div')
  squatter.id = 'hcms-toggle'
  dom.window.document.body.appendChild(squatter)
  const btn = injectToggle(spyApi(), dom.window.document)
  assert.notEqual(btn, squatter)
  assert.equal(btn.id, '', 'leaves the page its id rather than shadowing the element')
  assert.ok(btn.hasAttribute('data-hcms-toggle-host'), 'still styleable and still findable')
  dom.window.close()
})

test('injectToggle: a page that already owns #hcms-toggle-style still gets our stylesheet', () => {
  const dom = setupDom()
  const squatter = dom.window.document.createElement('style')
  squatter.id = 'hcms-toggle-style'
  squatter.textContent = '/* the page had this first */'
  dom.window.document.head.appendChild(squatter)

  const host = injectToggle(spyApi(), dom.window.document)
  const ours = dom.window.document.querySelector('[data-hcms-toggle-style]')
  assert.ok(ours, 'our stylesheet is installed even though the id was taken')
  assert.notEqual(ours, squatter)
  assert.match(ours.textContent, /data-hcms-toggle-host/)
  assert.equal(ours.id, '', 'and it leaves the page its id')
  assert.ok(host.hasAttribute('data-hcms-toggle-host'))
  dom.window.close()
})

test('injectToggle: a click on the inner button reaches the handler exactly once', () => {
  const dom = setupDom()
  const api = spyApi({ views: ['sidebar'] })
  const host = injectToggle(api, dom.window.document)
  host.querySelector('.hcms-toggle__main').click()
  assert.deepEqual(api.calls, ['open'])
  dom.window.close()
})

// ---------------------------------------------------------------------------
// maybeInjectToggle — gating: edit mode (cookie / forced global) + rules.
// Reads the real globals, wired the way the other node suites do. A fresh
// jsdom document is still readyState 'loading', so injection defers to
// DOMContentLoaded — every spec awaits readiness before asserting.
// ---------------------------------------------------------------------------

function domReady(dom) {
  if (dom.window.document.readyState !== 'loading') return Promise.resolve()
  return new Promise((r) => dom.window.document.addEventListener('DOMContentLoaded', r, { once: true }))
}

test('maybeInjectToggle: owner cookie + rules → injects', async () => {
  const dom = setupDom()
  dom.window.document.cookie = 'isAdminOfCurrentResource=1'
  maybeInjectToggle(spyApi())
  await domReady(dom)
  assert.ok(dom.window.document.getElementById('hcms-toggle'))
  dom.window.close()
})

test('maybeInjectToggle: plain visitor (no cookie) → nothing', async () => {
  const dom = setupDom()
  maybeInjectToggle(spyApi())
  await domReady(dom)
  assert.equal(dom.window.document.getElementById('hcms-toggle'), null)
  dom.window.close()
})

test('maybeInjectToggle: edit mode but no rules → nothing', async () => {
  const dom = setupDom()
  dom.window.document.cookie = 'isAdminOfCurrentResource=1'
  maybeInjectToggle(spyApi({ hasRules: () => false }))
  await domReady(dom)
  assert.equal(dom.window.document.getElementById('hcms-toggle'), null)
  dom.window.close()
})

test('maybeInjectToggle: window.__hyperclayEditMode opts standalone pages in', async () => {
  const dom = setupDom()
  dom.window.__hyperclayEditMode = true
  maybeInjectToggle(spyApi())
  await domReady(dom)
  assert.ok(dom.window.document.getElementById('hcms-toggle'))
  dom.window.close()
})

test('maybeInjectToggle: ?editmode=false suppresses even for the owner', async () => {
  const dom = setupDom('http://localhost/page?editmode=false')
  dom.window.document.cookie = 'isAdminOfCurrentResource=1'
  maybeInjectToggle(spyApi())
  await domReady(dom)
  assert.equal(dom.window.document.getElementById('hcms-toggle'), null)
  dom.window.close()
})

// ---------------------------------------------------------------------------
// pickSurface — the pill is opaque and neutral, and which of the two neutrals
// it uses is decided by WCAG contrast against the page's own ink. Measured
// floor for this pair is 4.36:1 across 1516 inks. Assert the CHOICE here, never
// a contrast number: the numbers belong to the browser tier, which can compute
// them. The inks below are the ones that break a naive lightness ramp.
// ---------------------------------------------------------------------------

test('pickSurface: dark ink takes the light surface, light ink the dark one', () => {
  assert.equal(pickSurface({ r: 0x2b, g: 0x24, b: 0x1b }), 'light')
  assert.equal(pickSurface({ r: 0x0f, g: 0x17, b: 0x2a }), 'light')
  assert.equal(pickSurface({ r: 0, g: 0, b: 0 }), 'light')
  assert.equal(pickSurface({ r: 0xec, g: 0xea, b: 0xf2 }), 'dark')
  assert.equal(pickSurface({ r: 0xff, g: 0xff, b: 0xff }), 'dark')
})

test('pickSurface: mid inks resolve to the side that actually reads better', () => {
  assert.equal(pickSurface({ r: 0x6b, g: 0x72, b: 0x80 }), 'light')  // tailwind text-gray-500
  assert.equal(pickSurface({ r: 0x73, g: 0x73, b: 0x73 }), 'light')  // tailwind text-neutral-500
  assert.equal(pickSurface({ r: 0x6c, g: 0x75, b: 0x7d }), 'light')  // bootstrap .text-muted
  assert.equal(pickSurface({ r: 0x76, g: 0x76, b: 0x76 }), 'dark')   // WCAG-minimum grey on white
  assert.equal(pickSurface({ r: 0x80, g: 0x80, b: 0x80 }), 'dark')
  assert.equal(pickSurface({ r: 0x4f, g: 0x7d, b: 0x7a }), 'light')
})

test('pickSurface: a translucent ink is judged as it renders, not as authored', () => {
  // Opaque black takes the light surface at 20:1. The same black at 40% renders
  // grey, and only 2.83:1 against #fafafa, but that still beats 1.02:1 on the
  // dark surface, so light remains the right answer for the right reason.
  assert.equal(pickSurface({ r: 0, g: 0, b: 0, a: 1 }), 'light')
  assert.equal(pickSurface({ r: 0, g: 0, b: 0, a: 0.4 }), 'light')
  // A translucent WHITE ink over the dark surface stays white enough to read;
  // over the light surface it vanishes. The naive opaque reading gets this right
  // by luck, the composited one gets it right by construction.
  assert.equal(pickSurface({ r: 255, g: 255, b: 255, a: 0.6 }), 'dark')
  // Opaque red reads better on the dark surface. Half-transparent red renders as
  // pale pink on the light surface and a near-black maroon on the dark one, so
  // the answer flips. Only the composited reading can see that.
  assert.equal(pickSurface({ r: 255, g: 0, b: 0 }), 'dark')
  assert.equal(pickSurface({ r: 255, g: 0, b: 0, a: 0.5 }), 'light')
})

test('parseRgb: reads only sRGB, which is what sends everything else to the canvas', () => {
  assert.equal(parseRgb('color(srgb 1 1 1)'), null)
  assert.equal(parseRgb('oklch(0.929 0.013 255.508)'), null)
  assert.equal(parseRgb('lab(92 -1 -5)'), null)
  assert.equal(parseRgb('transparent'), null)
  assert.equal(parseRgb(undefined), null)
})

test('parseRgb: keeps alpha, in both serializations', () => {
  assert.deepEqual(parseRgb('rgb(43, 36, 27)'), { r: 43, g: 36, b: 27, a: 1 })
  assert.deepEqual(parseRgb('rgba(43, 36, 27, 0.5)'), { r: 43, g: 36, b: 27, a: 0.5 })
  assert.deepEqual(parseRgb('rgb(43 36 27 / 50%)'), { r: 43, g: 36, b: 27, a: 0.5 })
  assert.equal(parseRgb('transparent'), null)
  assert.equal(parseRgb(undefined), null)
})

// ---------------------------------------------------------------------------
// Stylesheet invariants — properties of the CSS text, which needs no engine.
// ---------------------------------------------------------------------------

// Hover must never touch the surface or the label. The first version dimmed the
// surface to #1b1b1b / #f0f0f0, which took a #767676 page from 4.36:1 to 3.79:1
// on hover: below the floor the resting state guarantees, in the one state a
// person is looking at the button.
// A whitelist, because a blacklist has already missed two spellings:
// background-color, then --hcms-toggle-color. Hover may change the border and
// the shadow and nothing else. Anything that paints the label or the surface,
// under any name, fails here without this test needing to predict the name.
test('the hover rule changes only the border and the shadow', () => {
  const hover = TOGGLE_STYLE.match(/:hover\s*\{([^}]*)\}/)
  assert.ok(hover, 'there is a hover rule')
  const properties = hover[1]
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => declaration.split(':')[0].trim())
    .sort()
  assert.deepEqual(properties, ['border-color', 'box-shadow'])
})

// The narrow-viewport override has to be at least as specific as the rule it
// overrides, because a media query contributes no specificity of its own. The
// first version of this file set --hcms-toggle-shift on `body.hcms-open` (0,1,1)
// inside the media query and on `body.hcms-open:not(.hcms-overlay):not(.hcms-side-left)`
// (0,3,1) outside it, so the narrow override never applied and the button sat
// off the left edge of a 375px screen with the CMS open.
test('theme: the narrow-viewport toggle shift outranks the docked-right rule', () => {
  const css = readFileSync(new URL('../src/theme/pixel-quiet.overrides.css', import.meta.url), 'utf8')
  const rulesFor = (decl) => [...css.matchAll(new RegExp(`([^{}]+)\\{[^{}]*${decl}[^{}]*\\}`, 'g'))]
    .map((m) => m[1].trim().split('\n').pop().trim())
  const selectors = rulesFor('--hcms-toggle-shift:')
  assert.equal(selectors.length, 2, 'one docked-right rule and one narrow override')
  // Same selector, not merely the same class count: an equally specific but
  // DIFFERENT selector (.hcms-side-left in place of :not(.hcms-side-left)) also
  // counts three classes, passes, and restores the off-screen bug. Source order
  // then does the rest, and the media block sits later in the file.
  assert.equal(selectors[1], selectors[0],
    'the narrow override must use the same selector as the rule it overrides')
  // Membership in the narrow block, not arithmetic on indexOf. The previous
  // version searched from the file's FIRST @media, which is the dark-scheme
  // block 70 lines earlier, so it always found the docked-right rule outside
  // any media query and always passed. Moving the reset out of the block then
  // restored the off-screen bug with the whole suite green.
  const narrow = css.match(/@media\s*\(max-width:\s*799px\)\s*\{([\s\S]*?)\n\}/)
  assert.ok(narrow, 'the narrow-viewport block exists')
  assert.match(
    narrow[1],
    /body\.hcms-open:not\(\.hcms-overlay\):not\(\.hcms-side-left\)\s*\{[^}]*--hcms-toggle-shift:\s*0px/,
    'the shift reset must live inside the narrow-viewport block, on the same selector'
  )
})

// ---------------------------------------------------------------------------
// The canvas colour path. jsdom has neither a 2d context nor CSS.supports, so
// these supply both and drive the branch on purpose. Each pins a safeguard that
// a reviewer deleted with the whole suite green. No rAF in jsdom, so injectToggle
// sets the surface synchronously and these read it straight off the host.
// ---------------------------------------------------------------------------

function paintWith(dom, ink, answer, seen) {
  const win = dom.window
  win.CSS = { supports: () => true }
  win.HTMLCanvasElement.prototype.getContext = function () {
    let fill = ''
    return {
      globalCompositeOperation: '',
      set fillStyle(value) { fill = value },
      get fillStyle() { return fill },
      fillRect() {},
      getImageData() {
        if (seen) seen.push(fill)
        const rgb = answer(fill)
        return { data: [rgb.r, rgb.g, rgb.b, Math.round((rgb.a == null ? 1 : rgb.a) * 255)] }
      },
    }
  }
  win.getComputedStyle = () => ({ color: ink })
}

// Round-trips sRGB, which keeps the sentinel probe satisfied, and answers one
// fixed colour for everything else. That is what a real canvas does, minus a
// colour space converter.
const faithful = (fixed) => (value) => parseRgb(value) || fixed

test('an sRGB ink never reaches the canvas', () => {
  const dom = setupDom()
  const seen = []
  paintWith(dom, 'rgb(255, 255, 255)', faithful({ r: 0, g: 0, b: 0, a: 1 }), seen)
  const host = injectToggle(spyApi(), dom.window.document)
  assert.equal(host.getAttribute('data-hcms-surface'), 'dark')
  assert.deepEqual(seen, [], 'an rgb() ink must be parsed directly, never painted')
  dom.window.close()
})

test('a canvas that fuzzes its readback is refused', () => {
  const dom = setupDom()
  // Firefox's resistFingerprinting answers one colour for everything. Believing
  // it would send every page to whichever surface that colour implies.
  paintWith(dom, 'oklch(0.2 0 0)', () => ({ r: 255, g: 255, b: 255, a: 1 }))
  const host = injectToggle(spyApi(), dom.window.document)
  // Refused, so the ink is unreadable, so the quiet default stands. NOT 'dark',
  // which is what believing the white readback gives for this dark ink.
  assert.equal(host.getAttribute('data-hcms-surface'), 'light')
  dom.window.close()
})

test('each document measures through its own canvas', () => {
  const first = setupDom()
  const second = setupDom()
  paintWith(first, 'oklch(0.2 0 0)', faithful({ r: 32, g: 32, b: 32, a: 1 }))
  paintWith(second, 'oklch(0.95 0 0)', faithful({ r: 240, g: 240, b: 240, a: 1 }))
  const a = injectToggle(spyApi(), first.window.document)
  const b = injectToggle(spyApi(), second.window.document)
  assert.equal(a.getAttribute('data-hcms-surface'), 'light')
  assert.equal(
    b.getAttribute('data-hcms-surface'),
    'dark',
    'a shared context measures the second document with the first document\'s canvas'
  )
  first.window.close()
  second.window.close()
})

// ---------------------------------------------------------------------------
// The split button (§5.1). Two real buttons in a group, a menu of the views
// this build has, and one remembered choice in localStorage under `hcms.view`.
// Each spec drives the DOM the way a person does — press the main button, press
// the arrow, walk the menu — rather than calling the internals.
// ---------------------------------------------------------------------------

// A spy that records WHICH view each open asked for, which is the whole subject
// here. spyApi above deliberately keeps its coarser shape, so the click-wiring
// specs it serves keep asserting exactly what they asserted before.
function viewApi(overrides = {}) {
  const opened = []
  return {
    opened,
    open: (opts = {}) => { opened.push(opts.view || null) },
    close: () => {},
    isOpen: () => false,
    hasRules: () => true,
    ...overrides,
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

const parts = (host) => ({
  main: host.querySelector('.hcms-toggle__main'),
  arrow: host.querySelector('.hcms-toggle__arrow'),
  menu: host.querySelector('.hcms-toggle__menu'),
  items: [...host.querySelectorAll('[role="menuitemradio"]')],
})

function keydown(dom, el, key) {
  const ev = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  return ev
}

test('split button: first run with both views opens the menu, not a view', async () => {
  const dom = setupDom()
  const api = viewApi()
  const host = injectToggle(api, dom.window.document)
  const { main, arrow, menu, items } = parts(host)
  assert.equal(menu.hidden, true, 'the menu starts closed')

  main.click()
  await tick()
  assert.deepEqual(api.opened, [], 'nothing was opened — the button asked instead of guessing')
  assert.equal(menu.hidden, false)
  assert.equal(arrow.getAttribute('aria-expanded'), 'true')
  assert.deepEqual(items.map((i) => i.getAttribute('data-hcms-view')), ['sidebar', 'inline'])
  assert.equal(dom.window.localStorage.getItem('hcms.view'), null, 'and nothing was remembered')
  dom.window.close()
})

test('split button: a remembered view opens straight away, with no menu', async () => {
  const dom = setupDom()
  dom.window.localStorage.setItem('hcms.view', 'inline')
  const api = viewApi()
  const host = injectToggle(api, dom.window.document)
  const { main, menu } = parts(host)

  main.click()
  await tick()
  assert.deepEqual(api.opened, ['inline'])
  assert.equal(menu.hidden, true, 'a remembered view is not a question')
  dom.window.close()
})

// The preference belongs to the person, not to the page. A build without the
// inline view must not spend someone else's setting.
test('split button: a remembered view this page cannot render falls back and is kept', async () => {
  const dom = setupDom()
  dom.window.localStorage.setItem('hcms.view', 'inline')
  const api = viewApi({ views: ['sidebar'] })
  const host = injectToggle(api, dom.window.document)

  parts(host).main.click()
  await tick()
  assert.deepEqual(api.opened, ['sidebar'], 'the view this page does have')
  assert.equal(
    dom.window.localStorage.getItem('hcms.view'),
    'inline',
    'the stored preference survives a page that cannot honour it'
  )
  dom.window.close()
})

// The membership check at the boundary, on its own. The button ALSO filters a
// remembered view against the views this page has, and that second gate hides a
// missing check here: every value this rejects is a value that filter rejects
// too. Anything else reading the preference would get the raw string.
test('split button: only the two view names read back as a preference', () => {
  const dom = setupDom()
  const win = dom.window
  for (const value of ['drawer', 'Sidebar', 'inline ', '', 'null']) {
    win.localStorage.setItem('hcms.view', value)
    assert.equal(readStoredView(win), null, `"${value}" is not a view name`)
  }
  win.localStorage.removeItem('hcms.view')
  assert.equal(readStoredView(win), null, 'and an absent one is first run')
  for (const value of ['sidebar', 'inline']) {
    win.localStorage.setItem('hcms.view', value)
    assert.equal(readStoredView(win), value)
  }
  dom.window.close()
})

test('split button: a stored value that is not a view name reads as first run', async () => {
  const dom = setupDom()
  dom.window.localStorage.setItem('hcms.view', 'drawer')
  const api = viewApi()
  const host = injectToggle(api, dom.window.document)

  parts(host).main.click()
  await tick()
  assert.deepEqual(api.opened, [], 'no view was opened off an unknown name')
  assert.equal(parts(host).menu.hidden, false, 'the menu asked instead')
  dom.window.close()
})

test('split button: one view means no arrow at all, and the button opens it', async () => {
  const dom = setupDom()
  const api = viewApi({ views: ['sidebar'] })
  const host = injectToggle(api, dom.window.document)
  const { main, arrow, menu } = parts(host)
  assert.equal(arrow === null, true, 'an arrow offering one view is a question with one answer')
  assert.equal(menu === null, true)
  assert.equal(host.hasAttribute('data-hcms-split'), false)

  main.click()
  await tick()
  assert.deepEqual(api.opened, ['sidebar'])
  dom.window.close()
})

test('split button: picking a view opens it and remembers it', async () => {
  const dom = setupDom()
  const api = viewApi()
  const host = injectToggle(api, dom.window.document)
  const { arrow, menu, items } = parts(host)

  arrow.click()
  items[1].click()
  await tick()
  assert.deepEqual(api.opened, ['inline'])
  assert.equal(dom.window.localStorage.getItem('hcms.view'), 'inline')
  assert.equal(menu.hidden, true, 'the menu closes behind the choice')

  // Reopening shows the choice as the checked one.
  arrow.click()
  assert.deepEqual(
    parts(host).items.map((i) => i.getAttribute('aria-checked')),
    ['false', 'true']
  )
  dom.window.close()
})

test('split button: a view that fails to mount is not remembered', async () => {
  const dom = setupDom()
  const api = viewApi({ open: () => { throw new Error('no mutation hub') } })
  const host = injectToggle(api, dom.window.document)
  const { arrow, items } = parts(host)

  arrow.click()
  assert.doesNotThrow(() => items[1].click())
  await tick()
  assert.equal(
    dom.window.localStorage.getItem('hcms.view'),
    null,
    'a preference written before the open would teach the next load to retry a broken view'
  )
  dom.window.close()
})

test('split button: the keyboard walks the menu and Escape hands focus back', async () => {
  const dom = setupDom()
  const doc = dom.window.document
  const api = viewApi()
  const host = injectToggle(api, doc)
  const { arrow, menu, items } = parts(host)

  assert.equal(arrow.getAttribute('aria-haspopup'), 'menu')
  arrow.focus()
  keydown(dom, arrow, 'ArrowDown')
  assert.equal(menu.hidden, false)
  assert.equal(doc.activeElement, items[0], 'ArrowDown opens onto the first item')

  keydown(dom, items[0], 'ArrowDown')
  assert.equal(doc.activeElement, items[1])
  keydown(dom, items[1], 'ArrowDown')
  assert.equal(doc.activeElement, items[0], 'and wraps')
  keydown(dom, items[0], 'End')
  assert.equal(doc.activeElement, items[items.length - 1])
  keydown(dom, items[items.length - 1], 'Home')
  assert.equal(doc.activeElement, items[0])

  keydown(dom, items[0], 'Escape')
  assert.equal(menu.hidden, true)
  assert.equal(arrow.getAttribute('aria-expanded'), 'false')
  assert.equal(doc.activeElement, arrow, 'Escape returns focus to the arrow')

  // ArrowUp opens onto the last item, and Enter selects whatever is focused.
  keydown(dom, arrow, 'ArrowUp')
  assert.equal(doc.activeElement, items[items.length - 1])
  keydown(dom, items[items.length - 1], 'Enter')
  await tick()
  assert.deepEqual(api.opened, ['inline'])
  assert.equal(menu.hidden, true)
  dom.window.close()
})

test('split button: Tab leaves the menu instead of cycling inside it', () => {
  const dom = setupDom()
  const host = injectToggle(viewApi(), dom.window.document)
  const { arrow, menu, items } = parts(host)
  keydown(dom, arrow, 'ArrowDown')
  const ev = keydown(dom, items[0], 'Tab')
  assert.equal(menu.hidden, true)
  assert.equal(ev.defaultPrevented, false, 'the browser still moves focus onward')
  dom.window.close()
})

test('split button: a pointer press outside the control closes the menu', () => {
  const dom = setupDom()
  const doc = dom.window.document
  const host = injectToggle(viewApi(), doc)
  const { arrow, menu } = parts(host)
  arrow.click()
  assert.equal(menu.hidden, false)
  // Inside first: pressing the control itself must not close it out from under
  // the click that is about to land on it.
  host.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }))
  assert.equal(menu.hidden, false)
  doc.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }))
  assert.equal(menu.hidden, true)
  dom.window.close()
})

// The same reason the host's position is pinned: a page-level
// `* { ... !important }` reset is what these declarations exist to survive, and
// an ordinary declaration loses to it. Structure only — the arrow's opaque
// surface and the menu's whole geometry, never its cosmetics.
test('split button: the arrow and the menu root carry their structural pins', () => {
  const dom = setupDom()
  const host = injectToggle(viewApi(), dom.window.document)
  const { arrow, menu } = parts(host)

  assert.equal(arrow.style.getPropertyPriority('background'), 'important')
  for (const property of ['position', 'right', 'bottom', 'z-index', 'display']) {
    assert.equal(
      menu.style.getPropertyPriority(property),
      'important',
      `the menu's ${property} must survive a hostile reset`
    )
  }
  assert.equal(menu.style.position, 'absolute')
  // [hidden] is a UA rule at zero specificity, so the hidden state is pinned too.
  assert.equal(menu.style.display, 'none')
  arrow.click()
  assert.equal(menu.style.display, 'block')
  assert.equal(menu.style.getPropertyPriority('display'), 'important')
  dom.window.close()
})
