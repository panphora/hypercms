import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { componentForScalarRule, injectDefaults, injectComponents } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm } from '../src/form-builder.js'
import { bindEvents } from '../src/events.js'
import { parseFontOptions } from '../src/font-control.js'
import { FONTS, fontBySlug, fontStack, fontsHref, familyEntries, sameFamilies } from '../src/catalogs/fonts.js'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, refresh, api } from '../src/hypercms.js'

const INTER = fontStack(fontBySlug('inter'))
const LORA = fontStack(fontBySlug('lora'))
const FONTS_LINK = 'link[data-hcms-fonts]'
const PRECONNECT = 'link[data-hcms-fonts-preconnect]'
const PREVIEW = 'link[data-hcms-font-preview]'

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

function sessionFixture({ style = '', rules = '{}', head = '' } = {}) {
  return `<!DOCTYPE html><html${style ? ` style="${style}"` : ''}><head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  ${rules}
  </script>
  ${head}
  </head><body><h1 class="title">Hello</h1></body></html>`
}

// Clicking inside the open sidebar form: the control for one field path, one
// family by name. Two font fields both offer "Inter", so the path scopes it.
function pickIn(doc, path, family) {
  const control = doc.querySelector(`.hcms-font[data-hcms-path="${path}"]`)
  assert.ok(control, `font control for ${path} is mounted`)
  const option = Array.from(control.querySelectorAll('.hcms-font-option')).find(
    (b) => b.textContent === family
  )
  assert.ok(option, `option "${family}" is offered for ${path}`)
  click(doc, option)
}

test('parseFontOptions: catalog, group, explicit and unknown tokens', () => {
  const none = parseFontOptions(null)
  assert.equal(none.fonts.length, 40)
  assert.equal(none.system, true)

  const serif = parseFontOptions(['serif'])
  assert.equal(serif.fonts.length, 10)
  assert.equal(serif.system, false)

  const picked = parseFontOptions(['inter', 'lora', 'system'])
  assert.equal(picked.fonts.length, 2)
  assert.equal(picked.system, true)

  const warns = []
  const original = console.warn
  console.warn = (...args) => warns.push(args.join(' '))
  try {
    const bogus = parseFontOptions(['nope'])
    assert.equal(bogus.fonts.length, 0)
    assert.equal(warns.length, 1)
  } finally {
    console.warn = original
  }
})

test('inference: --font / --font-* custom properties and an explicit component', () => {
  const doc = setupDoc('<section id="s" data-face="Inter" data-hcms-component:data-face="font"></section>')
  assert.equal(componentForScalarRule('html@--font-heading', doc), '@font')
  assert.equal(componentForScalarRule('html@--font', doc), '@font')
  assert.equal(componentForScalarRule('html@--fontsize', doc), '@scalar')
  assert.equal(componentForScalarRule('html@--font-weight-heading', doc), '@scalar')
  assert.equal(componentForScalarRule('html@--font-size-base', doc), '@scalar')
  assert.equal(componentForScalarRule('html@--color-scheme', doc), '@scalar')
  assert.equal(componentForScalarRule('html@--color-accent', doc), '@color')
  assert.equal(componentForScalarRule('#s@data-face', doc), '@font')
})

test('a catalog stack renders the menu with System first, groups, and one selection', () => {
  const doc = setupDoc('', `style="--font-heading: ${INTER}"`)
  const rules = { theme: { heading: 'html@--font-heading' } }
  const formHost = mountForm(doc, rules, { theme: { heading: INTER } })

  const control = formHost.querySelector('.hcms-font')
  assert.ok(control, 'font control rendered')
  const hidden = formHost.querySelector('input[type="hidden"][data-hcms-field="heading"]')
  assert.ok(hidden, 'hidden field rendered')
  assert.equal(hidden.value, INTER)
  assert.equal(control.querySelector('.hcms-font-name').textContent, 'Inter')
  assert.equal(control.querySelectorAll('.hcms-font-option').length, 40 + 1)
  assert.equal(control.querySelectorAll('.hcms-font-group').length, 4)
  const selected = control.querySelectorAll('.hcms-font-option[aria-selected="true"]')
  assert.equal(selected.length, 1)
  assert.equal(selected[0].getAttribute('data-hcms-font'), INTER)
  assert.equal(control.querySelector('.hcms-font-panel').hidden, true)
  assert.equal(doc.querySelector(PREVIEW), null)
})

test('an unrecognized stack shows as Current font and is kept as an option, without touching the page', () => {
  const BRAND = "'Brand Sans', sans-serif"
  const doc = setupDoc('', `style="--font-heading: ${BRAND}"`)
  const rules = { theme: { heading: 'html@--font-heading' } }
  const formHost = mountForm(doc, rules, { theme: { heading: BRAND } })

  const control = formHost.querySelector('.hcms-font')
  assert.equal(control.querySelector('.hcms-font-name').textContent, 'Current font')
  const first = control.querySelector('.hcms-font-option')
  assert.equal(first.getAttribute('data-hcms-font'), BRAND)
  assert.equal(first.textContent, 'Current font')
  assert.equal(first.getAttribute('aria-selected'), 'true')
  assert.equal(control.querySelectorAll('.hcms-font-option[aria-selected="true"]').length, 1)
  assert.equal(doc.documentElement.getAttribute('style'), `--font-heading: ${BRAND}`)
})

test('narrowed options list only the requested group plus System', () => {
  const doc = setupDoc(
    '',
    `style="--font-heading: ${LORA}" data-hcms-options:--font-heading="serif system"`
  )
  const rules = { theme: { heading: 'html@--font-heading' } }
  const formHost = mountForm(doc, rules, { theme: { heading: LORA } })

  const control = formHost.querySelector('.hcms-font')
  assert.equal(control.querySelectorAll('.hcms-font-option').length, 11)
  assert.equal(control.querySelectorAll('.hcms-font-group').length, 1)
})

test('opening the menu shows the panel and adds exactly one preview stylesheet', () => {
  const doc = setupDoc('', `style="--font-heading: ${INTER}"`)
  const rules = { theme: { heading: 'html@--font-heading' } }
  const formHost = mountForm(doc, rules, { theme: { heading: INTER } })
  commitCtx(doc, rules, formHost)

  const control = formHost.querySelector('.hcms-font')
  const toggle = control.querySelector('.hcms-font-current')
  click(doc, toggle)
  assert.equal(control.querySelector('.hcms-font-panel').hidden, false)

  const previews = doc.querySelectorAll(PREVIEW)
  assert.equal(previews.length, 1)
  assert.match(previews[0].getAttribute('href'), /&text=/)
  assert.equal(previews[0].hasAttribute('editor-ui'), true)
  assert.equal(previews[0].hasAttribute('no-save'), true)

  click(doc, toggle)
  assert.equal(control.querySelector('.hcms-font-panel').hidden, true)
  click(doc, toggle)
  assert.equal(control.querySelector('.hcms-font-panel').hidden, false)
  assert.equal(doc.querySelectorAll(PREVIEW).length, 1)
})

test('session: picking fonts writes the stacks and keeps one fonts link in step', () => {
  if (isOpen()) close()
  const dom = loadPage(
    sessionFixture({
      rules: '{ "theme": { "heading": "html@--font-heading", "body": "html@--font-body" } }',
    })
  )
  const doc = dom.window.document
  open({ pageRoot: doc })
  try {
    assert.equal(doc.querySelectorAll(FONTS_LINK).length, 0, 'no link before a font is set')

    pickIn(doc, 'theme.heading', 'Lora')
    assert.match(doc.documentElement.getAttribute('style'), /--font-heading:/)
    assert.equal(doc.documentElement.style.getPropertyValue('--font-heading'), LORA)
    const links = doc.querySelectorAll(FONTS_LINK)
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), fontsHref([LORA]))
    assert.equal(links[0].hasAttribute('no-undo'), true)
    assert.equal(doc.querySelectorAll(PRECONNECT).length, 1)

    pickIn(doc, 'theme.body', 'Inter')
    assert.equal(doc.documentElement.style.getPropertyValue('--font-body'), INTER)
    const both = doc.querySelectorAll(FONTS_LINK)
    assert.equal(both.length, 1)
    assert.equal(both[0].getAttribute('href'), fontsHref([LORA, INTER]))

    doc.documentElement.setAttribute('style', '')
    refresh()
    assert.equal(doc.querySelectorAll(FONTS_LINK).length, 0)
    assert.equal(doc.querySelectorAll(PRECONNECT).length, 0)
  } finally {
    close()
  }
  reset(dom)
})

test('session: opening the CMS repairs a fonts link a page edit left behind', () => {
  if (isOpen()) close()
  const dom = loadPage(
    sessionFixture({
      style: `--font-heading: ${LORA}`,
      rules: '{ "theme": { "heading": "html@--font-heading" } }',
    })
  )
  const doc = dom.window.document
  assert.equal(doc.querySelectorAll(FONTS_LINK).length, 0)
  open({ pageRoot: doc })
  try {
    const links = doc.querySelectorAll(FONTS_LINK)
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), fontsHref([LORA]))
  } finally {
    close()
  }
  reset(dom)
})

test('session: rules without a font field leave an existing fonts link alone', () => {
  if (isOpen()) close()
  const existing = 'https://fonts.googleapis.com/css2?family=Merriweather&display=swap'
  const dom = loadPage(
    sessionFixture({
      rules: '{ "title": ".title" }',
      head: `<link rel="stylesheet" data-hcms-fonts href="${existing}" />`,
    })
  )
  const doc = dom.window.document
  open({ pageRoot: doc })
  try {
    let links = doc.querySelectorAll(FONTS_LINK)
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), existing)

    api.setValue('title', 'Changed')
    links = doc.querySelectorAll(FONTS_LINK)
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), existing)

    refresh()
    links = doc.querySelectorAll(FONTS_LINK)
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), existing)
  } finally {
    close()
  }
  reset(dom)
})

test('session: an author\'s own font link survives picking, syncing and clearing', () => {
  if (isOpen()) close()
  const author = 'https://fonts.googleapis.com/css2?family=Roboto'
  const dom = loadPage(
    sessionFixture({
      rules: '{ "theme": { "heading": "html@--font-heading", "body": "html@--font-body" } }',
      head: `<link rel="stylesheet" href="${author}" />`,
    })
  )
  const doc = dom.window.document
  const authorLink = () => doc.querySelector(`link[href="${author}"]`)
  open({ pageRoot: doc })
  try {
    assert.ok(authorLink(), 'author link present at open')

    pickIn(doc, 'theme.heading', 'Lora')
    assert.ok(authorLink(), 'author link survives a pick')
    pickIn(doc, 'theme.body', 'Inter')
    assert.equal(doc.querySelectorAll(FONTS_LINK).length, 1)
    assert.ok(authorLink(), 'author link survives the second pick')

    doc.documentElement.setAttribute('style', '')
    refresh()
    assert.equal(doc.querySelectorAll(FONTS_LINK).length, 0)
    assert.ok(authorLink(), 'author link survives the refresh that removes ours')
  } finally {
    close()
  }
  reset(dom)
})

test('fonts link: a hand-written link keeps a family the catalog does not know', () => {
  if (isOpen()) close()
  const fraunces = "family=Fraunces:opsz,wght@9..144,400..700"
  const href = `https://fonts.googleapis.com/css2?${fraunces}&family=Inter:wght@400..700&display=swap`
  const dom = loadPage(
    sessionFixture({
      style: `--font-heading: 'Fraunces', ui-serif, serif; --font-body: ${INTER}`,
      rules: '{ "theme": { "heading": "html@--font-heading", "body": "html@--font-body" } }',
      head: `<link rel="stylesheet" data-hcms-fonts href="${href}" />`,
    })
  )
  const doc = dom.window.document
  open({ pageRoot: doc })
  try {
    const links = doc.querySelectorAll(FONTS_LINK)
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), href, 'opening the editor leaves an equivalent link alone')

    pickIn(doc, 'theme.body', 'Lora')
    const after = links[0].getAttribute('href')
    assert.ok(after.includes(fraunces), 'the hand-written family entry is kept verbatim')
    assert.ok(after.includes('family=Lora:'), 'the picked catalog family is loaded')
    assert.ok(!after.includes('family=Inter'), 'the replaced catalog family is gone')
    assert.equal(links[0].hasAttribute('no-undo'), true, 'the CMS link is never an undo step')
  } finally {
    close()
  }
  reset(dom)
})

test('fonts link: a hand link for a catalog family is not rewritten on open', () => {
  if (isOpen()) close()
  const href = 'https://fonts.googleapis.com/css2?family=Inter&display=swap'
  const dom = loadPage(
    sessionFixture({
      style: `--font-body: ${INTER}`,
      rules: '{ "theme": { "body": "html@--font-body" } }',
      head: `<link rel="stylesheet" data-hcms-fonts href="${href}" />`,
    })
  )
  const doc = dom.window.document
  open({ pageRoot: doc })
  try {
    const links = doc.querySelectorAll(FONTS_LINK)
    assert.equal(links.length, 1)
    assert.equal(links[0].getAttribute('href'), href)
  } finally {
    close()
  }
  reset(dom)
})

test('fontsHref keeps only families the page already loads, and family entries compare by name', () => {
  assert.equal(fontsHref(["'Unknown Face', serif"], null), null)
  assert.equal(familyEntries('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400&display=swap').get('open sans'), 'family=Open+Sans:wght@400')
  assert.equal(sameFamilies('https://x/css2?family=Inter:wght@400', 'https://x/css2?family=Inter:ital,wght@0,100..900;1,100..900'), true)
  assert.equal(sameFamilies('https://x/css2?family=Inter:wght@400', 'https://x/css2?family=Lora:wght@400'), false)
})
