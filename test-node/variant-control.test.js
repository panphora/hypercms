import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { componentForScalarRule, injectDefaults, injectComponents } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { bindEvents } from '../src/events.js'
import { parseVariantOptions } from '../src/variant-control.js'

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

const change = (doc, el) => el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))

const TOKENS = '1:cols-1 2:cols-2 3:cols-3'

test('parseVariantOptions: value:icon tokens, bare icon names and unknown values', () => {
  const options = parseVariantOptions(['1:cols-1', '2:cols-2', 'cards', 'wide'])
  assert.deepEqual(options.map((o) => o.value), ['1', '2', 'cards', 'wide'])
  assert.ok(options[0].icon, 'cols-1 has an icon')
  assert.ok(options[1].icon, 'cols-2 has an icon')
  assert.ok(options[2].icon, 'bare "cards" resolves its own icon')
  assert.equal(typeof options[0].icon.svg, 'string')
  assert.equal(options[0].label, 'One column')
  assert.equal(options[1].label, 'Two columns')
  assert.equal(options[2].label, 'Cards')
  assert.equal(options[3].icon, null)
  assert.equal(options[3].label, 'Wide')
})

test('selection: an explicit variant component, otherwise a plain scalar', () => {
  const doc = setupDoc(
    '<section id="f" data-layout="3" data-hcms-component:data-layout="variant"></section>'
  )
  const rules = { features: { layout: '#f@data-layout' } }
  assert.equal(componentForScalarRule('#f@data-layout', doc, ['features', 'layout'], rules), '@variant')

  const plain = setupDoc('<section id="f" data-layout="3"></section>')
  assert.equal(componentForScalarRule('#f@data-layout', plain, ['features', 'layout'], rules), '@scalar')
})

test('a variant builds one native radio per token, the current one checked', () => {
  const doc = setupDoc(
    `<section id="f" data-layout="3" data-hcms-component:data-layout="variant"
      data-hcms-options:data-layout="${TOKENS}"></section>`
  )
  const rules = { features: { layout: '#f@data-layout' } }
  const formHost = mountForm(doc, rules, { features: { layout: '3' } })

  const control = formHost.querySelector('.hcms-variant')
  assert.ok(control, 'variant control rendered')
  const radios = control.querySelectorAll('input[type="radio"]')
  assert.equal(radios.length, 3)
  const names = new Set(Array.from(radios, (r) => r.name))
  assert.equal(names.size, 1, 'all options share one group name')
  assert.deepEqual(Array.from(radios, (r) => r.value), ['1', '2', '3'])
  const checked = control.querySelectorAll('input[type="radio"]:checked')
  assert.equal(checked.length, 1)
  assert.equal(checked[0].value, '3')
  for (const option of control.querySelectorAll('.hcms-variant-option')) {
    assert.ok(option.querySelector('svg'), 'every option shows its icon')
  }

  for (const el of formHost.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      assert.doesNotMatch(attr.value, /cols-/, `no icon markup/token leaks into ${el.tagName}[${attr.name}]`)
    }
  }
})

test('an unlisted current value is prepended as a checked text option', () => {
  const doc = setupDoc(
    `<section id="f" data-layout="9" data-hcms-component:data-layout="variant"
      data-hcms-options:data-layout="${TOKENS}"></section>`
  )
  const rules = { features: { layout: '#f@data-layout' } }
  const formHost = mountForm(doc, rules, { features: { layout: '9' } })

  const options = formHost.querySelectorAll('.hcms-variant-option')
  assert.equal(options.length, 4)
  const first = options[0]
  assert.equal(first.querySelector('input[type="radio"]').value, '9')
  assert.equal(first.querySelector('input[type="radio"]').checked, true)
  assert.equal(first.querySelector('svg'), null, 'the fallback option carries no icon')
  assert.equal(first.querySelector('.hcms-variant-label').textContent, '9')
})

test('choosing an option writes only the attribute it is bound to', () => {
  const doc = setupDoc(
    `<section id="f" class="feature" data-layout="3" data-hcms-component:data-layout="variant"
      data-hcms-options:data-layout="${TOKENS}"></section>`
  )
  const rules = { features: { layout: '#f@data-layout' } }
  const formHost = mountForm(doc, rules, { features: { layout: '3' } })
  commitCtx(doc, rules, formHost)

  const section = doc.getElementById('f')
  const before = Array.from(section.attributes, (a) => a.name).sort()

  const one = Array.from(formHost.querySelectorAll('input[type="radio"]')).find((r) => r.value === '1')
  one.checked = true
  change(doc, one)

  assert.equal(section.getAttribute('data-layout'), '1')
  assert.deepEqual(Array.from(section.attributes, (a) => a.name).sort(), before, 'no attribute added or lost')
  assert.equal(section.className, 'feature')
  assert.equal(section.innerHTML, '')
})

test('missing options: the field error, and the current value still round-trips', () => {
  const doc = setupDoc('<section id="f" data-layout="3" data-hcms-component:data-layout="variant"></section>')
  const rules = { features: { layout: '#f@data-layout' } }
  const formHost = mountForm(doc, rules, { features: { layout: '3' } })

  const control = formHost.querySelector('.hcms-variant')
  const errorSlot = control.querySelector('.hcms-error')
  assert.equal(errorSlot.hidden, false)
  assert.equal(errorSlot.textContent, 'data-hcms-options required (value:icon tokens)')

  const radios = control.querySelectorAll('input[type="radio"]')
  assert.equal(radios.length, 1)
  assert.equal(radios[0].value, '3')
})

test('a variant and a color on separate properties build one control each', () => {
  const doc = setupDoc(
    `<section id="f" data-layout="2" style="--color-section-bg: red"
      data-hcms-component:data-layout="variant" data-hcms-options:data-layout="${TOKENS}"></section>`,
    'data-hcms-component:--color-section-bg="color"'
  )
  const rules = { features: { layout: '#f@data-layout', bg: '#f@--color-section-bg' } }
  const formHost = mountForm(doc, rules, { features: { layout: '2', bg: 'red' } })

  assert.equal(formHost.querySelectorAll('.hcms-variant').length, 1)
  assert.equal(formHost.querySelectorAll('.hcms-color').length, 1)
  assert.equal(formHost.querySelectorAll('.hcms-variant input[type="radio"]').length, 3)
})
