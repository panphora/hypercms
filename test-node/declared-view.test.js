import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, currentView } from '../src/hypercms.js'

const INLINE = 'hypercms-inline'

// The rules tag is where a page declares how it wants to be edited, so every
// fixture here differs from the next by that one attribute.
function fixture({ name = 'cms', view = null } = {}) {
  const viewAttr = view === null ? '' : ` data-cms-view="${view}"`
  return `<!DOCTYPE html><html><head>
  <script data-rules-name="${name}" data-rules-version="1"${viewAttr} type="application/json">
  { "title": ".title" }
  </script>
  </head><body><h1 class="title">Hello</h1></body></html>`
}

test('declared view: no data-cms-view on the rules tag means the sidebar', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture())
  open()
  try {
    assert.equal(currentView(), 'sidebar')
  } finally {
    close()
  }
  reset(dom)
})

test('declared view: data-cms-view="inline" opens the inline view', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture({ view: 'inline' }))
  open()
  try {
    assert.equal(currentView(), 'inline')
    assert.ok(dom.window.document.querySelector(INLINE), 'the inline host is in the document')
  } finally {
    close()
  }
  reset(dom)
})

test('declared view: data-cms-view="sidebar" opens the sidebar', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture({ view: 'sidebar' }))
  open()
  try {
    assert.equal(currentView(), 'sidebar')
  } finally {
    close()
  }
  reset(dom)
})

test('declared view: an unknown declaration warns once and opens the sidebar', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture({ view: 'bogus' }))
  const orig = console.warn
  const warnings = []
  console.warn = (msg) => { warnings.push(String(msg)) }
  try {
    open()
    assert.equal(currentView(), 'sidebar')
  } finally {
    console.warn = orig
    close()
  }
  assert.equal(warnings.length, 1, 'an unknown value is reported exactly once')
  assert.match(warnings[0], /data-cms-view "bogus"/)
  reset(dom)
})

test('declared view: an explicit view still overrides the declaration', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture({ view: 'inline' }))
  open({ view: 'sidebar' })
  try {
    assert.equal(currentView(), 'sidebar')
  } finally {
    close()
  }
  reset(dom)
})

test('declared view: a literal rules object has no tag to declare anything', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture({ view: 'inline' }))
  open({ rules: { title: 'h1' } })
  try {
    assert.equal(currentView(), 'sidebar')
  } finally {
    close()
  }
  reset(dom)
})

test('declared view: a bare open() with a session up keeps that view and tears nothing down', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture({ view: 'inline' }))
  open()
  const firstHost = dom.window.document.querySelector(INLINE)
  let reopened = 0
  const onOpen = () => { reopened++ }
  dom.window.document.addEventListener('hcms:open', onOpen)
  open()
  dom.window.document.removeEventListener('hcms:open', onOpen)
  try {
    assert.equal(currentView(), 'inline')
    assert.equal(dom.window.document.querySelector(INLINE), firstHost, 'same host element')
    assert.equal(dom.window.document.querySelectorAll(INLINE).length, 1)
    assert.equal(reopened, 0, 'nothing was torn down and reopened')
  } finally {
    close()
  }
  reset(dom)
})

test('declared view: a named rules tag declares the view the same way', () => {
  if (isOpen()) close()
  const dom = loadPage(fixture({ name: 'collection', view: 'inline' }))
  open({ rules: 'collection' })
  try {
    assert.equal(currentView(), 'inline')
  } finally {
    close()
  }
  reset(dom)
})
