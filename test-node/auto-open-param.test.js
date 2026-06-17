import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import {
  nextSearchAfterClose,
  shouldAutoOpenFromSearch,
  open,
  close,
  isOpen,
  maybeAutoOpen,
  installStyles,
} from '../src/hypercms.js'

// ---------------------------------------------------------------------------
// Pure param helpers — exhaustively unit-tested (the wiring rides the browser
// tier, but the hard string logic is pinned here).
// ---------------------------------------------------------------------------

test('shouldAutoOpenFromSearch: exactly cms=true opens', () => {
  assert.equal(shouldAutoOpenFromSearch('?cms=true'), true)
  assert.equal(shouldAutoOpenFromSearch('cms=true'), true)
  assert.equal(shouldAutoOpenFromSearch('?a=1&cms=true&b=2'), true)
})

test('shouldAutoOpenFromSearch: anything but exactly true does not open', () => {
  assert.equal(shouldAutoOpenFromSearch('?cms=false'), false)
  assert.equal(shouldAutoOpenFromSearch('?cms=1'), false)
  assert.equal(shouldAutoOpenFromSearch('?cms=TRUE'), false)
  assert.equal(shouldAutoOpenFromSearch('?cms='), false)
  assert.equal(shouldAutoOpenFromSearch('?cms'), false)
  assert.equal(shouldAutoOpenFromSearch('?other=true'), false)
  assert.equal(shouldAutoOpenFromSearch('?'), false)
  assert.equal(shouldAutoOpenFromSearch(''), false)
  assert.equal(shouldAutoOpenFromSearch(undefined), false)
})

test('nextSearchAfterClose: cms=true → cms=false, other params preserved', () => {
  assert.equal(nextSearchAfterClose('?cms=true'), '?cms=false')
  assert.equal(nextSearchAfterClose('?a=1&cms=true&b=2'), '?a=1&cms=false&b=2')
})

test('nextSearchAfterClose: never injects the param when absent', () => {
  assert.equal(nextSearchAfterClose(''), '')
  assert.equal(nextSearchAfterClose('?'), '?')
  assert.equal(nextSearchAfterClose('?a=1&b=2'), '?a=1&b=2')
})

test('nextSearchAfterClose: cms already false stays false (unchanged)', () => {
  assert.equal(nextSearchAfterClose('?cms=false'), '?cms=false')
  assert.equal(nextSearchAfterClose('?a=1&cms=false'), '?a=1&cms=false')
})

test('nextSearchAfterClose: accepts a query without the leading ?', () => {
  assert.equal(nextSearchAfterClose('cms=true'), '?cms=false')
})

// ---------------------------------------------------------------------------
// close() wiring: toggles cms=true → cms=false via history.replaceState, param
// kept, hash + other params preserved, exactly once. jsdom supports
// replaceState on http URLs.
// ---------------------------------------------------------------------------

function setupDom(url) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head>' +
      '<script type="application/json" data-rules-name="cms" data-rules-version="1">{"title":".title"}</script>' +
      '</head><body><h1 class="title">Hi</h1></body></html>',
    { url }
  )
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  dom.window.hyperclay = { Mutation: mutationStub() }
  globalThis.hyperclay = dom.window.hyperclay
  return dom
}

function mutationStub() {
  const off = () => () => {}
  return {
    onAnyChange: off, onAddOrRemove: off, onAddElement: off,
    onRemoveElement: off, onAttribute: off, pause() {}, resume() {},
  }
}

test('close(): rewrites cms=true → cms=false via replaceState, keeps the param', () => {
  const dom = setupDom('http://localhost/page?cms=true')
  open({ pageRoot: dom.window.document.body })
  close()
  assert.equal(dom.window.location.search, '?cms=false')
  dom.window.close()
})

test('close(): preserves other params and the hash', () => {
  const dom = setupDom('http://localhost/page?a=1&cms=true&b=2#section')
  open({ pageRoot: dom.window.document.body })
  close()
  assert.equal(dom.window.location.search, '?a=1&cms=false&b=2')
  assert.equal(dom.window.location.hash, '#section')
  dom.window.close()
})

test('close(): a page opened without cms= never gets the param injected', () => {
  const dom = setupDom('http://localhost/page?a=1')
  open({ pageRoot: dom.window.document.body })
  close()
  assert.equal(dom.window.location.search, '?a=1')
  dom.window.close()
})

test('close(): cms already false stays false', () => {
  const dom = setupDom('http://localhost/page?cms=false')
  open({ pageRoot: dom.window.document.body })
  close()
  assert.equal(dom.window.location.search, '?cms=false')
  dom.window.close()
})

// ---------------------------------------------------------------------------
// whenReady three-layer auto-open: event-primary + slow self-cancelling
// backstop. These drive maybeAutoOpen() with Mutation absent, then exercise
// each ready path. Globals are wired the same way the close() tests do.
// ---------------------------------------------------------------------------

function setupDomNoMutation(url) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head>' +
      '<script type="application/json" data-rules-name="cms" data-rules-version="1">{"title":".title"}</script>' +
      '</head><body><h1 class="title">Hi</h1></body></html>',
    { url }
  )
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  dom.window.hyperclay = {}
  globalThis.hyperclay = dom.window.hyperclay
  return dom
}

test('auto-open event path: dispatching hyperclay:mutation-ready opens without waiting for the poll', async () => {
  const dom = setupDomNoMutation('http://localhost/page?cms=true')
  maybeAutoOpen()
  assert.equal(isOpen(), false, 'Mutation absent → not open yet')

  // Install Mutation and fire the event the way mutation.js does.
  dom.window.hyperclay.Mutation = mutationStub()
  const t0 = Date.now()
  dom.window.document.dispatchEvent(
    new dom.window.CustomEvent('hyperclay:mutation-ready', { detail: {} })
  )
  // The event handler fires synchronously, so open happens with no poll delay.
  assert.equal(isOpen(), true, 'event handler opened the shell')
  assert.ok(Date.now() - t0 < 100, 'opened well under one backstop tick (250ms)')

  close()
  dom.window.close()
})

test('auto-open backstop path: opens via the 250ms poll for a direct Mutation install (no event)', async () => {
  const dom = setupDomNoMutation('http://localhost/page?cms=true')
  maybeAutoOpen()
  assert.equal(isOpen(), false, 'Mutation absent → not open yet')

  // Direct assignment with NO event dispatch (the exotic hand-rolled host).
  dom.window.hyperclay.Mutation = mutationStub()
  // Backstop ticks at 250ms; wait long enough for one tick.
  await new Promise((r) => setTimeout(r, 350))
  assert.equal(isOpen(), true, 'backstop poll opened the shell')

  close()
  dom.window.close()
})

test('auto-open backstop self-cancels once the event opens (no late re-open after close)', async () => {
  const dom = setupDomNoMutation('http://localhost/page?cms=true')
  maybeAutoOpen()

  dom.window.hyperclay.Mutation = mutationStub()
  dom.window.document.dispatchEvent(
    new dom.window.CustomEvent('hyperclay:mutation-ready', { detail: {} })
  )
  assert.equal(isOpen(), true)

  // Close, then wait past several backstop ticks: a self-cancelled interval must
  // not resurrect the shell.
  close()
  assert.equal(isOpen(), false)
  await new Promise((r) => setTimeout(r, 350))
  assert.equal(isOpen(), false, 'backstop did not re-open after the event path finished')

  dom.window.close()
})

// ---------------------------------------------------------------------------
// Regression: the synchronous fast-path must not race installStyles. On the
// bundled entry (hypercms-bundle.js) installStyles() runs AFTER the module that
// fires maybeAutoOpen() evaluates, so a synchronous fast-path open() would mount
// the shell with cssText still empty — an unstyled sidebar. The fast-path now
// defers a microtask, so styles installed right after maybeAutoOpen still land.
// ---------------------------------------------------------------------------

test('auto-open fast-path: styles installed AFTER maybeAutoOpen still reach the shell (bundle order)', async () => {
  const dom = setupDom('http://localhost/page?cms=true') // Mutation present → fast-path
  installStyles('') // cssText not yet set, as before the bundle's installStyles runs
  maybeAutoOpen() // fast-path defers open() to a microtask (the bug fired it synchronously)
  installStyles('.hcms-shell { position: fixed }') // bundle installs styles post-eval
  await new Promise((r) => setTimeout(r, 0)) // drain the microtask → open() runs now

  assert.equal(isOpen(), true, 'auto-open mounted the shell')
  const style = dom.window.document.getElementById('hcms-shell-styles')
  assert.ok(style, 'shell stylesheet element exists')
  assert.equal(style.tagName, 'STYLE', 'injected an inline <style>, not the fallback <link>')
  assert.match(style.textContent, /position: fixed/, 'injected the late-installed CSS')

  close()
  installStyles('') // reset module-global cssText for the rest of the suite
  dom.window.close()
})
