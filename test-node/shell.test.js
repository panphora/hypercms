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
  assert.equal(titleEl.textContent.trim(), 'Page content')
  destroy()
})

test('mountShell: pixel-quiet geometry — minibar, scroll body, mirk close/save', () => {
  const doc = setupDom()
  const { root, destroy } = mountShell({ mountTo: doc.body, doc, showSaveButton: true })
  assert.ok(root.classList.contains('pixel-quiet'), 'shell carries the pixel-quiet look')
  // condensed minibar pinned to the panel top
  assert.ok(root.querySelector('.hcms-shell-minibar'), 'minibar present')
  // scroll region wraps header + form + footer
  const bodyRegion = root.querySelector('.hcms-shell-body')
  assert.ok(bodyRegion, 'scroll body present')
  assert.ok(bodyRegion.querySelector('[data-hcms-form-root]'), 'form root lives inside the scroll body')
  assert.ok(bodyRegion.querySelector('.hcms-shell-footer'), 'footer is in-flow inside the scroll body')
  // close + save are real mirk buttons; close keeps its action hook, save
  // carries [trigger-save] for the host save system (no hypercms wiring)
  const close = root.querySelector('.hcms-shell-close')
  assert.ok(close.classList.contains('mirk-button'), 'close is a mirk-button')
  assert.equal(close.getAttribute('data-hcms-action'), 'close')
  const save = root.querySelector('.hcms-shell-save')
  assert.ok(save.classList.contains('mirk-button'), 'save is a mirk-button')
  assert.ok(save.hasAttribute('trigger-save'), 'save carries [trigger-save]')
  assert.equal(save.getAttribute('data-hcms-action'), null, 'save has no hypercms action hook')
  // header carries the eyebrow + title
  assert.ok(root.querySelector('.hcms-shell-eyebrow'), 'eyebrow present')
  destroy()
})

test('mountShell: theme option pins dark', () => {
  const doc = setupDom()
  const { root, destroy } = mountShell({ mountTo: doc.body, doc, theme: 'dark' })
  assert.ok(root.classList.contains('dark'))
  destroy()
})

test('mountShell: custom title + eyebrow', () => {
  const doc = setupDom()
  const { root, destroy } = mountShell({ mountTo: doc.body, doc, title: 'Settings', eyebrow: 'EDITING' })
  assert.equal(root.querySelector('.hcms-shell-title').textContent.trim(), 'Settings')
  assert.equal(root.querySelector('.hcms-shell-eyebrow').textContent.trim(), 'EDITING')
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
