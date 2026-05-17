import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, installStyles } from '../src/hypercms.js'

test('installStyles + open injects style tag', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">{ "t": ".t" }</script>
    <h1 class="t">x</h1>
  </body></html>`)
  try {
    installStyles('/* test css */ .hcms-shell { color: red }')
    open()
    try {
      const style = document.getElementById('hcms-shell-styles')
      assert.ok(style, 'shell style tag injected')
      assert.match(style.textContent, /hcms-shell/)
    } finally {
      close()
    }
  } finally {
    installStyles('') // reset
    dom.window.close()
  }
})

test('per-document tracking: opening twice in same doc only injects one style tag', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">{ "t": ".t" }</script>
    <h1 class="t">x</h1>
  </body></html>`)
  try {
    installStyles('.hcms-shell { color: green }')
    open()
    close()
    open()
    try {
      const styles = document.querySelectorAll('#hcms-shell-styles, style[data-hcms-bundled-styles]')
      assert.equal(styles.length, 1, 'only one style tag survives second open')
    } finally {
      close()
    }
  } finally {
    installStyles('')
    dom.window.close()
  }
})
