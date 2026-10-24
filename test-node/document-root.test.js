import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'
import { rootRules } from '../src/page-root.js'

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

test('document root: a bare rule addresses <body> when the root is the document', () => {
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"mode":"@data-mode","accent":"@--color-accent","body":"."}</script>
    </head><body data-mode="dark" style="--color-accent: red">Hi</body></html>`)
  const doc = dom.window.document
  let error = null
  doc.addEventListener('hcms:error', (e) => { error = e.detail })
  open()
  try {
    const field = (path) => doc.querySelector(`[data-hcms-form-root] [data-hcms-path="${path}"] textarea`)
    assert.equal(field('mode').value, 'dark')
    assert.equal(field('body').value, 'Hi')
    assert.equal(doc.querySelector('[data-hcms-form-root] input[type="hidden"][data-hcms-field="accent"]').value, 'red')

    const mode = field('mode')
    mode.value = 'light'
    mode.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.body.getAttribute('data-mode'), 'light')
    assert.equal(error, null)
  } finally {
    close()
    reset(dom)
  }
})

test('rootRules: bare rules gain <body>; list rows are untouched', () => {
  assert.deepEqual(
    rootRules({ mode: '@data-mode', accent: '@--color-accent', body: '.', title: 'h1' }, { nodeType: 9 }),
    { mode: 'body@data-mode', accent: 'body@--color-accent', body: 'body', title: 'h1' }
  )
  const list = { items: ['li', { x: '@data-x', title: 'span' }] }
  assert.deepEqual(rootRules(list, { nodeType: 9 }), list)
  const notDocument = { mode: '@data-mode' }
  assert.equal(rootRules(notDocument, { nodeType: 1 }), notDocument)
})
