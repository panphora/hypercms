import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import {
  componentForScalarRule,
  readOptionsOverride,
  readCropOverride,
  injectDefaults,
  injectComponents,
} from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { bindEvents } from '../src/events.js'

function setupDoc(bodyHtml = '', htmlAttrs = '') {
  return new JSDOM(`<!DOCTYPE html><html ${htmlAttrs}><head></head><body>${bodyHtml}</body></html>`).window.document
}

// Mirror open(): inject the shape defaults + the components this page's rules
// select, before deriving rules / building the form.
function prepare(doc, rules) {
  injectDefaults(doc)
  injectComponents(doc, rules)
}

function mountForm(doc, rules, data) {
  prepare(doc, rules)
  const formHost = doc.createElement('div')
  formHost.setAttribute('data-hcms-form-root', '')
  doc.body.appendChild(formHost)
  formHost.appendChild(buildForm({ pageRules: rules, formRules: null, data, doc }))
  return formHost
}

// Commit through the real form path: bindEvents watches the form root and a
// dispatched change commits the extracted data onto the page.
function commitCtx(doc, rules, formHost) {
  const errorEl = doc.createElement('div')
  errorEl.hidden = true
  const ctx = {
    doc,
    pageRoot: doc,
    pageRules: rules,
    formRules: deriveFormRules(rules, doc),
    formRoot: formHost,
    errorEl,
    lastFingerprint: null,
    lastData: null,
    observerHandle: null,
    dispatch: () => {},
  }
  bindEvents(ctx)
  return ctx
}

test('scoped attributes: one element, two rules, two different controls', () => {
  const doc = setupDoc(
    `<section id="s" data-tone="calm" data-live="true"
      data-hcms-component:data-tone="select" data-hcms-options:data-tone="calm loud"
      data-hcms-component:data-live="checkbox"></section>`
  )
  const rules = { tone: '#s@data-tone', live: '#s@data-live' }
  assert.equal(componentForScalarRule('#s@data-tone', doc, ['tone'], rules), '@select')
  assert.equal(componentForScalarRule('#s@data-live', doc, ['live'], rules), '@checkbox')
  assert.deepEqual(readOptionsOverride('#s@data-tone', doc, ['tone'], rules), ['calm', 'loud'])
  assert.equal(readOptionsOverride('#s@data-live', doc, ['live'], rules), null)

  const formHost = mountForm(doc, rules, { tone: 'calm', live: 'true' })
  const select = formHost.querySelector('select[data-hcms-field="tone"]')
  assert.ok(select, 'scoped select rendered')
  assert.deepEqual(Array.from(select.options).map((o) => o.value), ['calm', 'loud'])
  assert.equal(select.value, 'calm')
  const cb = formHost.querySelector('input[type="checkbox"][data-hcms-field="live"]')
  assert.ok(cb, 'scoped checkbox rendered')
  assert.equal(cb.checked, true)
})

test('scoped attribute beats the plain attribute for its own rule only', () => {
  const doc = setupDoc(
    `<section id="s" data-tone="calm" data-hcms-component="textarea" data-hcms-component:data-tone="select"></section>`
  )
  assert.equal(componentForScalarRule('#s@data-tone', doc), '@select')
  assert.equal(componentForScalarRule('#s', doc), '@textarea')
})

test('plain attributes still apply when no scoped attribute exists', () => {
  const doc = setupDoc(`<section id="s" data-tone="a" data-hcms-component="select" data-hcms-options="a b"></section>`)
  const rules = { tone: '#s@data-tone' }
  assert.equal(componentForScalarRule('#s@data-tone', doc), '@select')
  assert.deepEqual(readOptionsOverride('#s@data-tone', doc), ['a', 'b'])
  const formHost = mountForm(doc, rules, { tone: 'a' })
  assert.ok(formHost.querySelector('select[data-hcms-field="tone"]'), 'plain select rendered')
})

test('a custom-property rule ignores the plain attribute', () => {
  const doc = setupDoc('', 'style="--accent: red" data-hcms-component="select" data-hcms-options="a b"')
  const rules = { accent: 'html@--accent' }
  assert.equal(componentForScalarRule('html@--accent', doc, ['accent'], rules), '@scalar')
  assert.equal(readOptionsOverride('html@--accent', doc, ['accent'], rules), null)
  const formHost = mountForm(doc, rules, { accent: 'red' })
  const input = formHost.querySelector('textarea[data-hcms-field="accent"]')
  assert.ok(input, 'scalar field rendered')
  assert.equal(input.value, 'red')
})

test('a custom-property rule honours its scoped attribute and writes back', () => {
  const doc = setupDoc(
    '',
    'style="--tone: calm; color: red" data-hcms-component:--tone="select" data-hcms-options:--tone="calm loud"'
  )
  const rules = { tone: 'html@--tone' }
  assert.equal(componentForScalarRule('html@--tone', doc, ['tone'], rules), '@select')
  assert.deepEqual(readOptionsOverride('html@--tone', doc, ['tone'], rules), ['calm', 'loud'])

  const formHost = mountForm(doc, rules, { tone: 'calm' })
  const select = formHost.querySelector('select[data-hcms-field="tone"]')
  assert.ok(select, 'scoped select rendered for the custom property')
  assert.deepEqual(Array.from(select.options).map((o) => o.value), ['calm', 'loud'])
  commitCtx(doc, rules, formHost)

  select.value = 'loud'
  select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))

  const style = doc.documentElement.getAttribute('style')
  assert.match(style, /--tone:\s*loud/, 'custom property rewritten')
  assert.match(style, /color:\s*red/, 'other declaration survives')
})

test('scoped crop attribute', () => {
  const doc = setupDoc(`<img id="i" src="a.png" data-hcms-crop:src="1:1">`)
  assert.equal(readCropOverride('#i@src', doc), '1:1')
})
