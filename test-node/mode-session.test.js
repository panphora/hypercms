import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import {
  open,
  close,
  isOpen,
  currentView,
  api,
  maybeAutoOpen,
  prepareModeLease,
  modeParticipant,
  cms,
} from '../src/hypercms.js'
import { state, pendingWork, quiesceSession, resumeSession } from '../src/session.js'
import { injectToggle } from '../src/toggle.js'

const PAGE =
  '<!DOCTYPE html><html><head>' +
  '<script type="application/json" data-rules-name="cms" data-rules-version="1">{"title":".title"}</script>' +
  '</head><body><h1 class="title">Hi</h1></body></html>'

function mutationStub() {
  const off = () => () => {}
  return {
    onAnyChange: off, onAddOrRemove: off, onAddElement: off,
    onRemoveElement: off, onAttribute: off, pause() {}, resume() {},
  }
}

function setupDom({ url = 'http://localhost/page', lifecycle = null } = {}) {
  const dom = new JSDOM(PAGE, { url })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  dom.window.hyperclay = { Mutation: mutationStub() }
  globalThis.hyperclay = dom.window.hyperclay
  if (lifecycle) dom.window.clay = { modeLifecycle: lifecycle }
  return dom
}

function admission(initial) {
  const gate = { allowed: initial }
  gate.lifecycle = {
    canWrite: () => gate.allowed,
    register: () => () => {},
    state: { mode: initial ? 'edit' : 'view', phase: 'idle' },
  }
  return gate
}

function shell(doc) {
  return doc.querySelector('[data-hcms-shell]')
}

function uploadController() {
  const controller = {
    aborted: false,
    abort() { this.aborted = true },
  }
  return controller
}

test('standalone: open and close keep their existing behavior', () => {
  const dom = setupDom()
  assert.deepEqual(open({ pageRoot: dom.window.document.body }), { ok: true, view: 'sidebar' })
  assert.equal(isOpen(), true)
  assert.equal(currentView(), 'sidebar')
  assert.ok(shell(dom.window.document), 'the shell mounted')
  assert.deepEqual(close(), { ok: true })
  assert.equal(isOpen(), false)
  assert.equal(shell(dom.window.document), null, 'the shell was destroyed')
  dom.window.close()
})

test('standalone: close still aborts an in-flight upload', () => {
  const dom = setupDom()
  open({ pageRoot: dom.window.document.body })
  const controller = uploadController()
  state.ctx.uploads = new Set([controller])
  assert.deepEqual(close(), { ok: true })
  assert.equal(controller.aborted, true)
  assert.equal(isOpen(), false)
  dom.window.close()
})

test('managed: open defers to ClayJS admission and mounts nothing while it is closed', () => {
  const gate = admission(false)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  assert.deepEqual(open({ pageRoot: dom.window.document.body }), { ok: false, code: 'not-allowed' })
  assert.equal(isOpen(), false)
  assert.equal(shell(dom.window.document), null)
  assert.equal(dom.window.document.body.hasAttribute('data-hcms-session'), false)
  dom.window.close()
})

test('managed: open mounts once ClayJS admits writes', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  assert.deepEqual(open({ pageRoot: dom.window.document.body }), { ok: true, view: 'sidebar' })
  assert.equal(isOpen(), true)
  assert.ok(shell(dom.window.document))
  close()
  dom.window.close()
})

test('managed: auto-open waits for admission and stays closed without it', async () => {
  const gate = admission(false)
  const dom = setupDom({ url: 'http://localhost/page?cms=true', lifecycle: gate.lifecycle })
  maybeAutoOpen()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(isOpen(), false, 'a closed admission does not auto-open the CMS')
  assert.equal(shell(dom.window.document), null)
  close()
  dom.window.close()
})

test('managed: auto-open opens when admission is open', async () => {
  const gate = admission(true)
  const dom = setupDom({ url: 'http://localhost/page?cms=true', lifecycle: gate.lifecycle })
  maybeAutoOpen()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(isOpen(), true)
  close()
  dom.window.close()
})

test('standalone: auto-open is unchanged', async () => {
  const dom = setupDom({ url: 'http://localhost/page?cms=true' })
  maybeAutoOpen()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(isOpen(), true)
  close()
  dom.window.close()
})

test('lease: prepare is inert, enable mounts, quiesce stops admission, resume restores it, dispose closes', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  const lease = prepareModeLease({ doc: dom.window.document, pageRoot: dom.window.document.body })
  assert.equal(isOpen(), false, 'prepare mounted nothing')
  assert.equal(shell(dom.window.document), null)

  lease.enable()
  assert.equal(isOpen(), true)
  assert.ok(shell(dom.window.document))
  api.setValue('title', 'Changed')
  assert.equal(dom.window.document.querySelector('.title').textContent, 'Changed')

  assert.deepEqual(lease.quiesce(), { ok: true })
  assert.equal(state.ctx.quiesced, true)
  assert.throws(() => api.setValue('title', 'Refused'), /not admitting/)
  api._commit()

  lease.resume()
  assert.equal(state.ctx.quiesced, false)
  api.setValue('title', 'Again')
  assert.equal(dom.window.document.querySelector('.title').textContent, 'Again')

  lease.dispose()
  assert.equal(isOpen(), false)
  assert.equal(shell(dom.window.document), null, 'dispose went through destroy()')
  lease.dispose()
  assert.equal(isOpen(), false, 'dispose is idempotent')
  dom.window.close()
})

test('lease: a second prep/enable cycle mounts a fresh session', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  const first = modeParticipant({ doc: dom.window.document, pageRoot: dom.window.document.body })
  assert.equal(first.id, 'hypercms')
  assert.equal(typeof first.order, 'number')
  const one = first.prepare({ generation: 1 })
  assert.equal(typeof one.ready?.then, 'function')
  one.enable()
  const firstCtx = state.ctx
  one.dispose()
  const two = first.prepare({ generation: 2 })
  two.enable()
  assert.notEqual(state.ctx, firstCtx)
  assert.equal(isOpen(), true)
  two.dispose()
  assert.equal(isOpen(), false)
  dom.window.close()
})

test('lease: an upload blocks exit without aborting it', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  const lease = prepareModeLease({ doc: dom.window.document, pageRoot: dom.window.document.body })
  lease.enable()
  const controller = uploadController()
  state.ctx.uploads = new Set([controller])

  assert.deepEqual(lease.quiesce(), { ok: false, code: 'pending-input', pending: ['upload'] })
  assert.equal(isOpen(), true, 'the editing session was kept')
  assert.equal(controller.aborted, false, 'the upload was not aborted')
  assert.equal(state.ctx.quiesced, false, 'admission was not closed behind the refusal')

  state.ctx.uploads.clear()
  assert.deepEqual(lease.quiesce(), { ok: true })
  lease.dispose()
  dom.window.close()
})

test('lease: a painted upload preview blocks exit with no controller to abort', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  const lease = prepareModeLease({ doc: dom.window.document, pageRoot: dom.window.document.body })
  lease.enable()
  dom.window.document.querySelector('.title').setAttribute('data-hcms-uploading', '')
  assert.deepEqual(pendingWork(state.ctx), ['preview'])
  assert.deepEqual(lease.quiesce(), { ok: false, code: 'pending-input', pending: ['preview'] })
  assert.equal(isOpen(), true)

  dom.window.document.querySelector('.title').removeAttribute('data-hcms-uploading')
  assert.deepEqual(pendingWork(state.ctx), [])
  assert.deepEqual(lease.quiesce(), { ok: true })
  lease.dispose()
  dom.window.close()
})

test('lease: dispose after the barrier aborts uploads and destroys the view', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  const lease = prepareModeLease({ doc: dom.window.document, pageRoot: dom.window.document.body })
  lease.enable()
  const controller = uploadController()
  state.ctx.uploads = new Set([controller])
  lease.dispose()
  assert.equal(controller.aborted, true)
  assert.equal(isOpen(), false)
  assert.equal(shell(dom.window.document), null)
  dom.window.close()
})

test('managed: close refuses a pending upload before aborting it, then closes once it settles', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  open({ pageRoot: dom.window.document.body })
  const controller = uploadController()
  state.ctx.uploads = new Set([controller])

  assert.deepEqual(close(), { ok: false, code: 'pending-input', pending: ['upload'] })
  assert.equal(isOpen(), true)
  assert.equal(controller.aborted, false)

  state.ctx.uploads.clear()
  assert.deepEqual(close(), { ok: true })
  assert.equal(isOpen(), false)
  dom.window.close()
})

test('managed: close is busy while a transition holds admission closed', () => {
  const gate = admission(true)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  open({ pageRoot: dom.window.document.body })
  gate.allowed = false
  assert.deepEqual(close(), { ok: false, code: 'busy' })
  assert.equal(isOpen(), true)
  gate.allowed = true
  assert.deepEqual(close(), { ok: true })
  dom.window.close()
})

test('managed: the shell\u0027s own close button asks ClayJS to leave edit instead of tearing down', () => {
  const gate = admission(true)
  const calls = []
  const dom = setupDom({ lifecycle: gate.lifecycle })
  dom.window.clay.setMode = (mode) => { calls.push(mode); return Promise.resolve({ ok: true }) }
  open({ pageRoot: dom.window.document.body })
  dom.window.document.querySelector('[data-hcms-action="close"]').click()
  assert.deepEqual(calls, ['view'])
  assert.equal(isOpen(), true, 'the CMS waits for the committed mode change')
  close()
  dom.window.close()
})

test('standalone: the shell\u0027s close button still closes directly', () => {
  const dom = setupDom()
  open({ pageRoot: dom.window.document.body })
  dom.window.document.querySelector('[data-hcms-action="close"]').click()
  assert.equal(isOpen(), false)
  dom.window.close()
})

test('toggle: managed page in view asks ClayJS for edit, then opens the CMS', async () => {
  const gate = admission(false)
  const calls = []
  const cmsCalls = []
  const dom = setupDom({ lifecycle: gate.lifecycle })
  dom.window.clay.mode = 'view'
  dom.window.clay.setMode = (mode) => { calls.push(mode); return Promise.resolve({ ok: true, mode: 'edit', changed: true }) }
  let openState = false
  const host = injectToggle({
    open: () => cmsCalls.push('open'),
    close: () => cmsCalls.push('close'),
    isOpen: () => openState,
  }, dom.window.document)

  host.click()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(calls, ['edit'])
  assert.deepEqual(cmsCalls, ['open'], 'the switch committed, so the CMS opens')

  openState = true
  host.click()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(calls, ['edit', 'view'])
  assert.deepEqual(cmsCalls, ['open'], 'leaving is the mode switch, not a direct close')
  dom.window.close()
})

test('toggle: managed page without setMode falls back to open(), which admission still refuses', async () => {
  const gate = admission(false)
  const dom = setupDom({ lifecycle: gate.lifecycle })
  const host = injectToggle({ open, close, isOpen }, dom.window.document)
  host.click()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(isOpen(), false)
  close()
  dom.window.close()
})

test('session: quiesce and resume helpers guard a closed session', () => {
  assert.deepEqual(quiesceSession(null), { ok: true })
  assert.deepEqual(resumeSession(null), undefined)
  assert.deepEqual(pendingWork(null), [])
})

test('cms facade exposes the lifecycle hooks', () => {
  assert.equal(cms.prepareModeLease, prepareModeLease)
  assert.equal(cms.modeParticipant, modeParticipant)
})
