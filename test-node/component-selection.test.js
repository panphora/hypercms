import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import {
  componentForScalarRule,
  injectDefaults,
  injectComponents,
  findTemplate,
  buildTemplateMap,
} from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { buildForm, fileNameFromUrl } from '../src/form-builder.js'

function setupDoc(bodyHtml = '') {
  return new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`).window.document
}

// A page with a file-opted-in anchor (.cv) and a plain link (.link). File upload
// is opt-in only now, so tests force it via data-hcms-component on the page node.
const FILE_BODY = `<a class="cv" data-hcms-component="file" href=""></a><a class="link" href=""></a>`

// Mirror open(): inject the shape defaults + the upload components this page
// selects, before deriving rules / building the form.
function prepare(doc, rules) {
  injectDefaults(doc)
  injectComponents(doc, rules)
}

test('componentForScalarRule: @src suffix → @image; @href is a plain URL field, NOT a file', () => {
  const doc = setupDoc()
  assert.equal(componentForScalarRule('img@src', doc), '@image')
  assert.equal(componentForScalarRule('.hero@src', doc), '@image')
  // Linking is far more common than uploading, so @href stays a plain scalar.
  assert.equal(componentForScalarRule('a@href', doc), '@scalar')
  assert.equal(componentForScalarRule('.cta@href', doc), '@scalar')
})

test('componentForScalarRule: plain scalar / non-string → @scalar', () => {
  const doc = setupDoc()
  assert.equal(componentForScalarRule('.title', doc), '@scalar')
  assert.equal(componentForScalarRule('h1', doc), '@scalar')
  assert.equal(componentForScalarRule(['.x', { a: '.a' }], doc), '@scalar')
  assert.equal(componentForScalarRule({ a: '.a' }, doc), '@scalar')
})

test('componentForScalarRule: data-hcms-component opts a field into a widget (file is opt-in only)', () => {
  const doc = setupDoc(`<div class="avatar" data-hcms-component="image" data-url=""></div>
    <a class="resume" data-hcms-component="file" href=""></a>
    <a class="plain" href=""></a>`)
  assert.equal(componentForScalarRule('.avatar@data-url', doc), '@image')
  // The ONLY way to get a file widget: explicit opt-in, even on an a@href rule.
  assert.equal(componentForScalarRule('.resume@href', doc), '@file')
  // A bare link with no opt-in stays a plain URL field.
  assert.equal(componentForScalarRule('.plain@href', doc), '@scalar')
})

test('componentForScalarRule: a bad selector never throws', () => {
  const doc = setupDoc()
  assert.equal(componentForScalarRule('::::@data-x', doc), '@scalar')
})

test('injectComponents: injects only the components the rules select', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  injectComponents(doc, { title: '.title', hero: 'img@src' })
  assert.ok(findTemplate(doc, '@image'), '@image injected (a rule selects it)')
  assert.equal(findTemplate(doc, '@file'), null, '@file not injected (no rule selects it)')
})

test('injectComponents: descends into object + object-array card fields', () => {
  const doc = setupDoc(`<a class="cv" data-hcms-component="file" href=""></a>`)
  injectDefaults(doc)
  injectComponents(doc, {
    cv: '.cv@href',
    meta: { logo: 'img@src' },
    products: ['.product', { photo: 'img@src', name: '.n' }],
  })
  assert.ok(findTemplate(doc, '@image'))
  assert.ok(findTemplate(doc, '@file'))
})

test('deriveFormRules: img@src reads img@src; a@href stays @value; data-hcms-component="file" reads a@href', () => {
  const doc = setupDoc(FILE_BODY)
  const rules = { hero: 'img@src', link: '.link@href', cv: '.cv@href', name: '.name' }
  prepare(doc, rules)
  const formRules = deriveFormRules(rules, doc)
  assert.equal(formRules.hero, 'img[data-hcms-field="hero"]@src')
  assert.equal(formRules.link, 'textarea[data-hcms-field="link"]@value') // plain scalar field by default
  assert.equal(formRules.cv, 'a[data-hcms-field="cv"]@href')           // opted into file
  assert.equal(formRules.name, 'textarea[data-hcms-field="name"]@value')
})

test('buildForm: @image clones the image widget and writes the URL to img.src', () => {
  const doc = setupDoc()
  const rules = { hero: 'img@src' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { hero: '/u/cover.png' }, doc })
  const field = frag.querySelector('.hcms-upload--image')
  assert.ok(field, 'image widget cloned')
  const img = field.querySelector('img[data-hcms-field="hero"]')
  assert.ok(img)
  assert.equal(img.getAttribute('src'), '/u/cover.png')
})

test('buildForm: a data-hcms-component="file" field clones the file widget, sets href + filename text', () => {
  const doc = setupDoc(`<a class="cv" data-hcms-component="file" href=""></a>`)
  const rules = { cv: '.cv@href' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { cv: '/uploads/My%20CV.pdf' }, doc })
  const field = frag.querySelector('.hcms-upload--file')
  assert.ok(field, 'file widget cloned')
  const a = field.querySelector('a[data-hcms-field="cv"]')
  assert.equal(a.getAttribute('href'), '/uploads/My%20CV.pdf')
  assert.equal(a.textContent, 'My CV.pdf', 'visible text is the decoded basename')
})

test('buildForm: empty file value leaves the anchor empty for the :empty placeholder', () => {
  const doc = setupDoc(`<a class="cv" data-hcms-component="file" href=""></a>`)
  const rules = { cv: '.cv@href' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: {}, doc })
  const a = frag.querySelector('.hcms-upload--file a[data-hcms-field="cv"]')
  assert.equal(a.getAttribute('href') || '', '')
  assert.equal(a.textContent, '')
})

test('buildForm: a bare a@href is a plain URL input, not a file widget', () => {
  const doc = setupDoc()
  const rules = { link: 'a@href' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { link: 'https://example.com' }, doc })
  assert.equal(frag.querySelector('.hcms-upload'), null, 'no upload widget for a plain link')
  const input = frag.querySelector('textarea[data-hcms-field="link"]')
  assert.equal(input.value, 'https://example.com')
})

test('buildForm: plain scalar still clones @scalar (no widget)', () => {
  const doc = setupDoc()
  const rules = { name: '.name' }
  prepare(doc, rules)
  const frag = buildForm({ pageRules: rules, formRules: null, data: { name: 'Ada' }, doc })
  assert.equal(frag.querySelector('.hcms-upload'), null)
  const input = frag.querySelector('textarea[data-hcms-field="name"]')
  assert.equal(input.value, 'Ada')
})

test('buildForm: card photo field clones @image inside its card', () => {
  const doc = setupDoc()
  const rules = { products: ['.product', { photo: 'img@src', name: '.n' }] }
  prepare(doc, rules)
  const data = { products: [{ photo: '/u/a.png', name: 'A' }, { photo: '', name: 'B' }] }
  const frag = buildForm({ pageRules: rules, formRules: null, data, doc })
  const cards = frag.querySelectorAll('[data-hcms-card]')
  assert.equal(cards.length, 2)
  const img0 = cards[0].querySelector('.hcms-upload--image img[data-hcms-field="photo"]')
  assert.equal(img0.getAttribute('src'), '/u/a.png')
  assert.ok(cards[0].querySelector('textarea[data-hcms-field="name"]'), 'sibling scalar still a plain textarea')
})

test('buildTemplateMap: scalar component selection parity (image inferred, href plain, file opt-in)', () => {
  const doc = setupDoc(FILE_BODY)
  const rules = { hero: 'img@src', link: '.link@href', cv: '.cv@href', name: '.name' }
  prepare(doc, rules)
  const map = buildTemplateMap(rules, doc)
  assert.equal(map.get('hero').getAttribute('data-hcms-tpl'), '@image')
  assert.equal(map.get('link').getAttribute('data-hcms-tpl'), '@scalar')
  assert.equal(map.get('cv').getAttribute('data-hcms-tpl'), '@file')
  assert.equal(map.get('name').getAttribute('data-hcms-tpl'), '@scalar')
})

test('fileNameFromUrl: basename, query-stripped, decoded', () => {
  assert.equal(fileNameFromUrl('/uploads/2026/report.pdf'), 'report.pdf')
  assert.equal(fileNameFromUrl('/u/a%20b.png?v=3'), 'a b.png')
  assert.equal(fileNameFromUrl(''), '')
  assert.equal(fileNameFromUrl(null), '')
})
