import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, currentView, api } from '../src/hypercms.js'

const FIXTURE = `<!DOCTYPE html><html><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "title": ".title" }
  </script>
  <h1 class="title">Hello</h1>
</body></html>`

test('hcms:open carries the page it belongs to and the view rendering it', () => {
  const dom = loadPage(FIXTURE)
  const seen = []
  document.body.addEventListener('hcms:open', (e) => seen.push(e.detail))
  open()
  try {
    assert.equal(seen.length, 1)
    assert.equal(seen[0].pageRoot, document.body)
    assert.equal(seen[0].view, 'sidebar')
  } finally {
    close()
  }
  reset(dom)
})

test('hcms:change still carries .data, and now carries pageRoot and view too', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  const seen = []
  document.body.addEventListener('hcms:change', (e) => seen.push(e.detail))
  open()
  try {
    api.setValue('title', 'Changed')
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0].data, { title: 'Changed' })
    assert.equal(seen[0].path, 'title')
    assert.equal(seen[0].pageRoot, document.body)
    assert.equal(seen[0].view, 'sidebar')
  } finally {
    close()
  }
  reset(dom)
})

test('hcms:close carries pageRoot and view, where it used to carry null', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  const seen = []
  document.body.addEventListener('hcms:close', (e) => seen.push(e.detail))
  open()
  close()
  assert.equal(seen.length, 1)
  assert.equal(seen[0].pageRoot, document.body)
  assert.equal(seen[0].view, 'sidebar')
  reset(dom)
})

test('currentView() names the view that owns the session, and agrees with isOpen()', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  assert.equal(isOpen(), false)
  assert.equal(currentView(), null)
  open()
  try {
    assert.equal(isOpen(), true)
    assert.equal(currentView(), 'sidebar')
  } finally {
    close()
  }
  assert.equal(isOpen(), false)
  assert.equal(currentView(), null)
  reset(dom)
})

test('a dispatch survives the view root being torn out of the document', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  const seen = []
  document.body.addEventListener('hcms:close', (e) => seen.push(e.detail))
  open()
  // What a full-document morph (live sync, a version restore) does to the shell.
  const shellRoot = document.querySelector('[data-hcms-shell]')
  assert.ok(shellRoot)
  shellRoot.remove()
  assert.equal(shellRoot.isConnected, false)
  close()
  assert.equal(seen.length, 1, 'the event landed on the page, not in the detached tree')
  reset(dom)
})
