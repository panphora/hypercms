import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { detectEditMode, injectToggle, maybeInjectToggle } from '../src/toggle.js'

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
    '<!DOCTYPE html><html><head></head><body><h1>Hi</h1></body></html>',
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
  assert.equal(btn.id, 'hcms-toggle')
  assert.ok(btn.hasAttribute('no-save'))
  assert.ok(btn.hasAttribute('snapshot-remove'))
  assert.ok(btn.hasAttribute('save-ignore'))
  assert.equal(btn.getAttribute('aria-label'), 'Toggle content editor')
  const style = dom.window.document.getElementById('hcms-toggle-style')
  assert.ok(style, 'style tag injected')
  assert.ok(style.hasAttribute('snapshot-remove'))
  assert.equal(injectToggle(api, dom.window.document), btn, 'second call returns the same node')
  assert.equal(dom.window.document.querySelectorAll('#hcms-toggle').length, 1)
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
