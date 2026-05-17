import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

test('open: moves focus into shell', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
    <h1 class="title">x</h1>
    <button id="outside">outside</button>
  </body></html>`)
  const outside = document.getElementById('outside')
  outside.focus()
  open()
  try {
    const shell = document.querySelector('[data-hcms-shell]')
    assert.ok(shell.contains(document.activeElement), 'focus is inside shell after open')
  } finally {
    close()
    dom.window.close()
  }
})

test('close: restores focus to previously focused element', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
    <h1 class="title">x</h1>
    <button id="outside">outside</button>
  </body></html>`)
  const outside = document.getElementById('outside')
  outside.focus()
  open()
  close()
  assert.equal(document.activeElement, outside, 'focus restored to outside button')
  dom.window.close()
})
