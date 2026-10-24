import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'
import { injectDefaults, injectComponents } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'

// Two fields with the same last key in different groups (hero.background,
// features.background) used to read and write each other: the form found
// both by data-hcms-field alone, so an edit to one copied it into the other.

function rulesFor(rules) {
  const doc = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window.document
  injectDefaults(doc)
  injectComponents(doc, rules)
  return deriveFormRules(rules, doc)
}

test('duplicate keys: a repeated key is scoped by its path, a unique key stays bare', () => {
  const form = rulesFor({ a: { title: 'h1' }, b: { title: 'h2' }, intro: 'p' })
  assert.equal(form.a.title, '[data-hcms-path="a.title"] textarea[data-hcms-field="title"]@value')
  assert.equal(form.b.title, '[data-hcms-path="b.title"] textarea[data-hcms-field="title"]@value')
  assert.equal(form.intro, 'textarea[data-hcms-field="intro"]@value')
})

test('duplicate keys: inside a list row, a nested repeat is scoped by the path after the row', () => {
  const form = rulesFor({ cards: ['.card', { a: { title: 'h3' }, b: { title: 'h4' } }] })
  const item = form.cards[1]
  assert.equal(item.a.title, '[data-hcms-path$=".a.title"] textarea[data-hcms-field="title"]@value')
  assert.equal(item.b.title, '[data-hcms-path$=".b.title"] textarea[data-hcms-field="title"]@value')
})

test('duplicate keys: editing one group never writes into the other', () => {
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"a":{"title":"h1"},"b":{"title":"h2"}}</script>
    </head><body><h1>A</h1><h2>B</h2></body></html>`)
  open()
  try {
    const doc = dom.window.document
    const [first, second] = doc.querySelectorAll('[data-hcms-form-root] textarea[data-hcms-field="title"]')
    assert.equal(second.value, 'B', 'the second field shows its own value')
    first.value = 'A2'
    first.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelector('h1').textContent, 'A2')
    assert.equal(doc.querySelector('h2').textContent, 'B')
  } finally {
    close()
    reset(dom)
  }
})
