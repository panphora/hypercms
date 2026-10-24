import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'

// A bare open() reads and writes the whole document, so a theme property on
// <html> resolves; events still report <body> as the page.
test('document root: a bare open() edits a property on <html> and reports body as the page', () => {
  const dom = loadPage(`<!DOCTYPE html><html style="color: red; --color-accent: #123456"><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"accent":"html@--color-accent","title":"h1"}</script>
    </head><body><h1>Hello</h1></body></html>`)
  const doc = dom.window.document
  let opened = null
  doc.body.addEventListener('hcms:open', (e) => { opened = e.detail.pageRoot })
  open()
  try {
    assert.equal(opened, doc.body)
    const field = doc.querySelector('[data-hcms-form-root] input[type="hidden"][data-hcms-field="accent"]')
    assert.equal(field.value, '#123456')
    const swatch = doc.querySelector('[data-hcms-path="accent"] .hcms-color-swatch[title="sky-600"]')
    swatch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    const style = doc.documentElement.getAttribute('style')
    assert.match(style, /--color-accent: oklch\(/)
    assert.match(style, /color: red/)
  } finally {
    close()
    reset(dom)
  }
})
