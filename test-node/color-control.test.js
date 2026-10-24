import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { componentForScalarRule, injectDefaults, injectComponents } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { bindEvents } from '../src/events.js'
import { parseColorOptions } from '../src/color-control.js'
import { COLORS } from '../src/catalogs/colors.js'

const valueOf = (id) => COLORS.find((c) => c.id === id).value
const ROSE_600 = valueOf('rose-600')
const SKY_600 = valueOf('sky-600')

function setupDoc(bodyHtml = '', htmlAttrs = '') {
  return new JSDOM(`<!DOCTYPE html><html ${htmlAttrs}><head></head><body>${bodyHtml}</body></html>`).window.document
}

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

const click = (doc, el) => el.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }))
const change = (doc, el) => el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
const input = (doc, el) => el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))

test('parseColorOptions: palette, hue, shade, ids, literal and custom', () => {
  const none = parseColorOptions(null, null)
  assert.equal(none.swatches.length, 286)
  assert.equal(none.custom, true)
  assert.equal(none.full, true)

  const rose = parseColorOptions(['rose'], null)
  assert.equal(rose.swatches.length, 11)
  assert.equal(rose.custom, false)

  const shade = parseColorOptions(['50'], null)
  // 26 hues carry shade 50, but zinc/neutral/mauve share one value and the
  // parser offers each value once.
  assert.equal(shade.swatches.length, 24)

  const picked = parseColorOptions(['rose-600', 'sky-600', 'custom'], null)
  assert.equal(picked.swatches.length, 2)
  assert.equal(picked.custom, true)

  const literal = parseColorOptions(['#0f172a'], null)
  assert.equal(literal.swatches.length, 1)
  assert.equal(literal.swatches[0].value, '#0f172a')

  const warns = []
  const original = console.warn
  console.warn = (...args) => warns.push(args.join(' '))
  try {
    const bogus = parseColorOptions(['bogus-token'], null)
    assert.equal(bogus.swatches.length, 0)
    assert.equal(warns.length, 1)
  } finally {
    console.warn = original
  }
})

test('inference: --color / --color-* custom properties and an explicit component', () => {
  const doc = setupDoc('<section id="s" data-bg="red" data-hcms-component:data-bg="color"></section>')
  assert.equal(componentForScalarRule('html@--color-bg', doc), '@color')
  assert.equal(componentForScalarRule('html@--color', doc), '@color')
  assert.equal(componentForScalarRule('html@--colorful', doc), '@scalar')
  assert.equal(componentForScalarRule('html@--spacing', doc), '@scalar')
  assert.equal(componentForScalarRule('#s@data-bg', doc), '@color')
})

test('full palette: 286 swatches, the current one pressed, the rest of the page intact', () => {
  const doc = setupDoc('', `style="color: red; --color-accent: ${ROSE_600}"`)
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: ROSE_600 } })

  const control = formHost.querySelector('.hcms-color')
  assert.ok(control, 'color control rendered')
  const hidden = formHost.querySelector('input[type="hidden"][data-hcms-field="accent"]')
  assert.ok(hidden, 'hidden field rendered')
  assert.equal(hidden.value, ROSE_600)
  assert.equal(control.querySelectorAll('.hcms-color-swatch').length, 286)
  const pressed = control.querySelectorAll('.hcms-color-swatch[aria-pressed="true"]')
  assert.equal(pressed.length, 1)
  assert.equal(pressed[0].getAttribute('data-hcms-color'), ROSE_600)
  assert.equal(control.querySelector('.hcms-color-name').textContent, 'Rose 600')
  assert.equal(control.querySelector('.hcms-color-panel').hidden, true)
  assert.equal(control.querySelector('.hcms-color-grid').classList.contains('hcms-color-grid--full'), true)
  assert.ok(control.querySelector('[data-hcms-color-input="text"]'), 'custom text input exists')
  assert.ok(control.querySelector('[data-hcms-color-input="native"]'), 'custom native input exists')
})

test('a value outside the palette is prepended and pressed', () => {
  const doc = setupDoc('', 'style="--color-accent: #123456"')
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: '#123456' } })

  const control = formHost.querySelector('.hcms-color')
  const first = control.querySelector('.hcms-color-swatch')
  assert.equal(first.getAttribute('data-hcms-color'), '#123456')
  assert.equal(first.getAttribute('aria-pressed'), 'true')
  assert.equal(control.querySelectorAll('.hcms-color-swatch[aria-pressed="true"]').length, 1)
  assert.equal(control.querySelector('.hcms-color-name').textContent, '#123456')
})

test('narrowed options render inline with no custom picker', () => {
  const doc = setupDoc(
    '',
    `style="--color-accent: ${ROSE_600}" data-hcms-options:--color-accent="rose-600 sky-600 emerald-600"`
  )
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: ROSE_600 } })

  const control = formHost.querySelector('.hcms-color')
  assert.equal(control.classList.contains('hcms-color--inline'), true)
  assert.equal(control.querySelector('.hcms-color-panel').hidden, false)
  assert.equal(control.querySelectorAll('.hcms-color-swatch').length, 3)
  assert.equal(control.querySelector('.hcms-color-custom'), null)
  assert.equal(control.querySelector('.hcms-color-current').hasAttribute('data-hcms-action'), false)
})

test('picking a swatch writes it and closes the panel', () => {
  const doc = setupDoc('', `style="color: red; --color-accent: ${ROSE_600}"`)
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: ROSE_600 } })
  const ctx = commitCtx(doc, rules, formHost)

  const control = formHost.querySelector('.hcms-color')
  const toggle = control.querySelector('.hcms-color-current')
  click(doc, toggle)
  assert.equal(control.querySelector('.hcms-color-panel').hidden, false)

  const sky = Array.from(control.querySelectorAll('.hcms-color-swatch')).find(
    (b) => b.getAttribute('data-hcms-color') === SKY_600
  )
  assert.ok(sky, 'sky-600 swatch rendered')
  click(doc, sky)

  const style = doc.documentElement.getAttribute('style')
  assert.match(style, /--color-accent:\s*oklch\(58\.8% 0\.158 241\.966\)/)
  assert.match(style, /color:\s*red/)
  assert.equal(control.querySelector('.hcms-color-panel').hidden, true)
  assert.ok(ctx.formRoot)
})

test('panel open state survives a rebuild for the same document and path', () => {
  const doc = setupDoc('', `style="--color-accent: ${ROSE_600}"`)
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: ROSE_600 } })
  commitCtx(doc, rules, formHost)

  click(doc, formHost.querySelector('.hcms-color-current'))

  const again = buildForm({ pageRules: rules, formRules: null, data: { theme: { accent: ROSE_600 } }, doc })
  formHost.replaceChildren(again)
  const rebuilt = formHost.querySelector('.hcms-color')
  assert.equal(rebuilt.querySelector('.hcms-color-panel').hidden, false)

  click(doc, rebuilt.querySelector('.hcms-color-current'))
  const third = buildForm({ pageRules: rules, formRules: null, data: { theme: { accent: ROSE_600 } }, doc })
  formHost.replaceChildren(third)
  assert.equal(formHost.querySelector('.hcms-color-panel').hidden, true)
})

test('custom text commits on change only, and rejects unsafe input', () => {
  const doc = setupDoc('', `style="--color-accent: ${ROSE_600}"`)
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: ROSE_600 } })
  commitCtx(doc, rules, formHost)

  const control = formHost.querySelector('.hcms-color')
  const text = control.querySelector('[data-hcms-color-input="text"]')

  text.value = 'rgb(0 0 0 / 50%)'
  input(doc, text)
  assert.match(doc.documentElement.getAttribute('style'), /--color-accent:\s*oklch\(58\.6% 0\.253 17\.585\)/)

  text.value = 'oklch(50% 0.1 200)'
  change(doc, text)
  assert.match(doc.documentElement.getAttribute('style'), /--color-accent:\s*oklch\(50% 0\.1 200\)/)

  text.value = 'nope;'
  change(doc, text)
  const errorSlot = control.querySelector(':scope > .hcms-error')
  assert.equal(errorSlot.hidden, false)
  assert.match(doc.documentElement.getAttribute('style'), /--color-accent:\s*oklch\(50% 0\.1 200\)/)
})

test('native picker commits on change', () => {
  const doc = setupDoc('', `style="--color-accent: ${ROSE_600}"`)
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: ROSE_600 } })
  commitCtx(doc, rules, formHost)

  const native = formHost.querySelector('[data-hcms-color-input="native"]')
  native.value = '#ff8800'
  change(doc, native)
  assert.match(doc.documentElement.getAttribute('style'), /--color-accent:\s*#ff8800/)
})

test('clear removes the declaration and keeps the rest of the style', () => {
  const doc = setupDoc('', `style="color: red; --color-accent: ${ROSE_600}"`)
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: ROSE_600 } })
  commitCtx(doc, rules, formHost)

  click(doc, formHost.querySelector('.hcms-color-clear'))
  const style = doc.documentElement.getAttribute('style') || ''
  assert.doesNotMatch(style, /--color-accent/)
  assert.match(style, /color:\s*red/)
})
