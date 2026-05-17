import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountShell } from '../src/shell.js'

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>')
  return dom.window.document
}

test('mountShell: creates shell with all parts', () => {
  const doc = setupDom()
  const { root, formRoot, errorEl, destroy } = mountShell({ mountTo: doc.body, doc })
  assert.ok(root.hasAttribute('data-hcms-shell'))
  assert.ok(root.hasAttribute('save-ignore'))
  assert.ok(formRoot.hasAttribute('data-hcms-form-root'))
  assert.equal(errorEl.hidden, true)
  destroy()
})

test('mountShell: body classes applied + removed', () => {
  const doc = setupDom()
  const { destroy } = mountShell({ mountTo: doc.body, doc })
  assert.ok(doc.body.classList.contains('hcms-open'))
  destroy()
  assert.equal(doc.body.classList.contains('hcms-open'), false)
})

test('mountShell: overlay class when overlay opt set', () => {
  const doc = setupDom()
  const { destroy } = mountShell({ mountTo: doc.body, doc, overlay: true })
  assert.ok(doc.body.classList.contains('hcms-overlay'))
  destroy()
})

test('mountShell: side=left adds side class', () => {
  const doc = setupDom()
  const { root, destroy } = mountShell({ mountTo: doc.body, doc, side: 'left' })
  assert.ok(root.classList.contains('hcms-side-left'))
  assert.ok(doc.body.classList.contains('hcms-side-left'))
  destroy()
})

test('mountShell: save button hidden by default', () => {
  const doc = setupDom()
  const { root, destroy } = mountShell({ mountTo: doc.body, doc })
  assert.equal(root.querySelector('.hcms-shell-footer').hidden, true)
  destroy()
})

// v0.3 fix #12 (Nice-to-have): shell already traps focus + locks body, so
// dialog ARIA semantics belong on the root. aria-labelledby points at the
// shell title's auto-generated id.
test('mountShell: dialog ARIA semantics on shell root', () => {
  const doc = setupDom()
  const { root, destroy } = mountShell({ mountTo: doc.body, doc })
  assert.equal(root.getAttribute('role'), 'dialog')
  assert.equal(root.getAttribute('aria-modal'), 'true')
  const labelId = root.getAttribute('aria-labelledby')
  assert.ok(labelId, 'aria-labelledby is set')
  const titleEl = root.querySelector('#' + labelId)
  assert.ok(titleEl, 'aria-labelledby resolves inside the shell')
  assert.equal(titleEl.textContent, 'Edit')
  destroy()
})

test('mountShell: each instance gets a distinct title id', () => {
  const doc = setupDom()
  const a = mountShell({ mountTo: doc.body, doc })
  const b = mountShell({ mountTo: doc.body, doc })
  assert.notEqual(a.root.getAttribute('aria-labelledby'), b.root.getAttribute('aria-labelledby'))
  a.destroy()
  b.destroy()
})

test('mountShell: save button shown when showSaveButton: true', () => {
  const doc = setupDom()
  const { root, destroy } = mountShell({ mountTo: doc.body, doc, showSaveButton: true })
  assert.equal(root.querySelector('.hcms-shell-footer').hidden, false)
  destroy()
})
