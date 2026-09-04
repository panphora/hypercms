import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { detectEditMode, injectToggle, maybeInjectToggle, parseRgb, pickSurface, TOGGLE_STYLE } from '../src/toggle.js'

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

test('injectToggle: click calls open when closed, close when open', () => {
  const dom = setupDom()
  let openState = false
  const api = spyApi({ isOpen: () => openState })
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
  const api = spyApi()
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
