import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { injectDefaults, injectComponents, styleRole } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { bindEvents } from '../src/events.js'
import { COLORS } from '../src/catalogs/colors.js'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

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

const SKY_600 = COLORS.find((c) => c.id === 'sky-600').value

const RULES = {
  theme: { accent: 'html@--color-accent', body: 'html@--font-body' },
  features: { heading: '#f h2', layout: '#f@data-layout', intro: '#f p', background: '#f@--color-section-bg' },
}

const FIXTURE_BODY = `<section id="f" data-layout="2" style="--color-section-bg: #eeeeee"
    data-hcms-component:data-layout="variant" data-hcms-options:data-layout="1:cols-1 2:cols-2">
    <h2>Features</h2><p>Intro</p>
  </section>`

const FIXTURE_HTML_ATTRS = `style="--color-accent: #123456; --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif"`

function sessionFixture(rules) {
  return `<!DOCTYPE html>
<html ${FIXTURE_HTML_ATTRS}>
<head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  ${rules}
  </script>
</head>
<body>
  ${FIXTURE_BODY}
</body></html>`
}

const fieldPaths = (container, selector = ':scope > .hcms-object-fields > [data-hcms-path]') =>
  Array.from(container.querySelectorAll(selector)).map((el) => el.getAttribute('data-hcms-path'))

test('styleRole: page hosts, section fields and content fields', () => {
  const doc = setupDoc(FIXTURE_BODY, FIXTURE_HTML_ATTRS)
  prepare(doc, RULES)
  const pageRules = RULES
  assert.equal(styleRole(pageRules.theme.accent, doc, ['theme', 'accent'], pageRules), 'page')
  assert.equal(styleRole(pageRules.theme.body, doc, ['theme', 'body'], pageRules), 'page')
  assert.equal(styleRole(pageRules.features.layout, doc, ['features', 'layout'], pageRules), 'section')
  assert.equal(styleRole(pageRules.features.background, doc, ['features', 'background'], pageRules), 'section')
  assert.equal(styleRole(pageRules.features.heading, doc, ['features', 'heading'], pageRules), null)

  const listRules = { cards: ['.card', { tint: '.card@--color-tint' }] }
  assert.equal(styleRole(listRules.cards[1].tint, doc, ['cards', '*', 'tint'], listRules), 'section')
})

test('the Page style group renders first and only holds the page-bound fields', () => {
  const doc = setupDoc(FIXTURE_BODY, FIXTURE_HTML_ATTRS)
  const formHost = mountForm(doc, RULES, {
    theme: { accent: '#123456', body: "'Inter', ui-sans-serif, system-ui, sans-serif" },
    features: { heading: 'Features', layout: '2', intro: 'Intro', background: '#eeeeee' },
  })

  const first = formHost.firstElementChild
  assert.ok(first.hasAttribute('data-hcms-page-style'), 'page style group is the first element')
  assert.equal(first.querySelector('[data-hcms-label]').textContent, 'Page style')
  assert.ok(first.querySelector('[data-hcms-path="theme.accent"]'), 'accent field in the page style group')
  assert.ok(first.querySelector('[data-hcms-path="theme.body"]'), 'body field in the page style group')
  assert.equal(formHost.querySelector('[data-hcms-path="theme"]'), null, 'the emptied group is not rendered')
})

test('a root scalar rule renders one field, not one in the form and one in Page style', () => {
  const doc = setupDoc('', 'style="--color-accent: #123456"')
  const formHost = mountForm(doc, 'html@--color-accent', '#123456')

  assert.equal(formHost.querySelector('[data-hcms-page-style]'), null, 'no page style group')
  const bound = formHost.querySelectorAll('[data-hcms-path=""]')
  assert.equal(bound.length, 1, 'the root scalar is rendered once')
  assert.ok(bound[0].querySelector('[data-hcms-field]'), 'the root scalar carries its field')
})

test('a page-role field inside an inline template is not repeated in Page style', () => {
  const doc = setupDoc(
    '<template data-hcms-tpl="theme"><div><input data-hcms-field="accent"></div></template>',
    'style="--color-accent: #123456"'
  )
  const rules = { theme: { accent: 'html@--color-accent' } }
  const formHost = mountForm(doc, rules, { theme: { accent: '#123456' } })

  assert.equal(
    formHost.querySelectorAll('[data-hcms-path="theme.accent"]').length,
    1,
    'the inline template owns its field'
  )
  assert.equal(formHost.querySelector('[data-hcms-page-style]'), null, 'no page style group')
})

test('style fields come first inside a group', () => {
  const doc = setupDoc(FIXTURE_BODY, FIXTURE_HTML_ATTRS)
  const formHost = mountForm(doc, RULES, {
    theme: { accent: '#123456', body: "'Inter', ui-sans-serif, system-ui, sans-serif" },
    features: { heading: 'Features', layout: '2', intro: 'Intro', background: '#eeeeee' },
  })

  const group = formHost.querySelector('[data-hcms-path="features"]')
  assert.ok(group, 'features group rendered')
  assert.deepEqual(fieldPaths(group), [
    'features.layout',
    'features.background',
    'features.heading',
    'features.intro',
  ])
})

test('session: page style fields write the document root, content fields write their element', () => {
  if (isOpen()) close()
  const dom = loadPage(sessionFixture(JSON.stringify(RULES)))
  const doc = dom.window.document
  open({ pageRoot: doc })
  try {
    const control = doc.querySelector('.hcms-color[data-hcms-path="theme.accent"]')
    assert.ok(control, 'accent color control is mounted in the page style group')
    click(doc, control.querySelector('.hcms-color-current'))
    const swatch = Array.from(control.querySelectorAll('.hcms-color-swatch')).find(
      (b) => b.getAttribute('data-hcms-color') === SKY_600
    )
    assert.ok(swatch, 'sky-600 swatch is offered')
    click(doc, swatch)
    assert.equal(doc.documentElement.style.getPropertyValue('--color-accent').trim(), SKY_600)

    const heading = doc.querySelector('[data-hcms-path="features.heading"] [data-hcms-field="heading"]')
    assert.ok(heading, 'heading input is mounted')
    heading.value = 'Why us'
    input(doc, heading)
    change(doc, heading)
    assert.equal(doc.querySelector('#f h2').textContent, 'Why us')

    assert.match(doc.documentElement.style.getPropertyValue('--font-body'), /Inter/)
  } finally {
    close()
  }
  reset(dom)
})

test('a form with no style fields builds exactly as before', () => {
  const doc = setupDoc('<h1>Hello</h1><ul><li><span>One</span></li></ul>')
  const rules = { title: 'h1', items: ['li', { name: 'span' }] }
  const formHost = mountForm(doc, rules, { title: 'Hello', items: [{ name: 'One' }] })

  assert.equal(formHost.querySelector('[data-hcms-page-style]'), null, 'no page style group')
  const root = formHost.firstElementChild
  assert.deepEqual(fieldPaths(root), ['title', 'items'])
})

test('style fields come first inside every list card', () => {
  const doc = setupDoc(
    '<div class="card"><h3>A</h3></div><div class="card"><h3>B</h3></div>',
    `style="--color-tint: #111111"`
  )
  const rules = { cards: ['.card', { name: 'h3', tint: '@--color-tint' }] }
  const formHost = mountForm(doc, rules, {
    cards: [
      { name: 'A', tint: '#111111' },
      { name: 'B', tint: '#222222' },
    ],
  })

  const cards = Array.from(formHost.querySelectorAll('[data-hcms-card]'))
  assert.equal(cards.length, 2)
  assert.deepEqual(fieldPaths(cards[0], '.hcms-card-fields > [data-hcms-path]'), [
    'cards.0.tint',
    'cards.0.name',
  ])
  assert.deepEqual(fieldPaths(cards[1], '.hcms-card-fields > [data-hcms-path]'), [
    'cards.1.tint',
    'cards.1.name',
  ])
})
