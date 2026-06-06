import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { injectDefaults, injectComponentTemplate, findTemplate } from '../src/templates.js'

function setupDoc(html = '<!DOCTYPE html><html><head></head><body></body></html>') {
  return new JSDOM(html).window.document
}

function injectAndGet(doc, key) {
  injectComponentTemplate(doc, key)
  const tpl = findTemplate(doc, key)
  assert.ok(tpl, `expected ${key} template to be injected`)
  return tpl.content
}

test('@image: bound leaf is an <img data-hcms-field>', () => {
  const root = injectAndGet(setupDoc(), '@image')
  const leaf = root.querySelector('[data-hcms-field]')
  assert.ok(leaf, '@image has a bound leaf')
  assert.equal(leaf.tagName, 'IMG')
})

test('@file: bound leaf is an <a data-hcms-field>', () => {
  const root = injectAndGet(setupDoc(), '@file')
  const leaf = root.querySelector('[data-hcms-field]')
  assert.ok(leaf, '@file has a bound leaf')
  assert.equal(leaf.tagName, 'A')
})

test('upload picker carries data-hcms-upload, never a vendored .mirk-*__input', () => {
  for (const key of ['@file', '@image']) {
    const root = injectAndGet(setupDoc(), key)
    const picker = root.querySelector('input[type="file"]')
    assert.ok(picker, `${key} has a file picker`)
    assert.ok(picker.hasAttribute('data-hcms-upload'), `${key} picker is a data-hcms-upload hook`)
    assert.equal(
      root.querySelector('.mirk-file__input, .mirk-image__input'),
      null,
      `${key} must not collide with the vendored mirk input listener`,
    )
  }
})

test('clear-× carries data-hcms-action="clear-upload", never a vendored .mirk-*__remove', () => {
  for (const key of ['@file', '@image']) {
    const root = injectAndGet(setupDoc(), key)
    const clear = root.querySelector('[data-hcms-action="clear-upload"]')
    assert.ok(clear, `${key} has a clear-upload control`)
    assert.equal(
      root.querySelector('.mirk-file__remove, .mirk-image__remove'),
      null,
      `${key} must not collide with the vendored mirk remove listener`,
    )
  }
})

test('injectDefaults leaves the opt-in upload templates out (six only)', () => {
  const doc = setupDoc()
  injectDefaults(doc)
  assert.equal(doc.querySelectorAll('template[data-hcms-tpl]').length, 6)
  assert.equal(findTemplate(doc, '@file'), null)
  assert.equal(findTemplate(doc, '@image'), null)
})

test('injectComponentTemplate injects on demand and is idempotent', () => {
  const doc = setupDoc()
  assert.equal(findTemplate(doc, '@image'), null)
  const first = injectComponentTemplate(doc, '@image')
  assert.ok(first)
  assert.ok(findTemplate(doc, '@image'))
  const second = injectComponentTemplate(doc, '@image')
  assert.equal(first, second, 'second inject returns the same template, not a duplicate')
  assert.equal(doc.querySelectorAll('template[data-hcms-tpl="@image"]').length, 1)
})

test('injectComponentTemplate preserves an author-declared template', () => {
  const doc = setupDoc(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="@image"><div class="author-owned"></div></template>
  </head><body></body></html>`)
  const tpl = injectComponentTemplate(doc, '@image')
  assert.equal(doc.querySelectorAll('template[data-hcms-tpl="@image"]').length, 1)
  assert.ok(tpl.content.querySelector('.author-owned'), 'author markup is untouched')
})

test('injectComponentTemplate ignores unknown keys', () => {
  const doc = setupDoc()
  assert.equal(injectComponentTemplate(doc, '@not-a-component'), null)
  assert.equal(doc.querySelectorAll('template[data-hcms-tpl]').length, 0)
})
