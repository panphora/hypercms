import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'
import { shapeOf } from '../src/form-rules.js'

function field(doc, path) {
  return doc.querySelector(`[data-hcms-form-root] [data-hcms-path="${path}"] textarea`)
}

test('repeated keys: a nested list title never reads or writes the row title', () => {
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"cards":["#features .card",{"links":["a",{"title":"."}],"title":"h3"}]}</script>
    </head><body><section id="features"><div class="card"><h3>T1</h3><a href="#">L1</a></div></section></body></html>`)
  open()
  try {
    const doc = dom.window.document
    const card = field(doc, 'cards.0.title')
    const link = field(doc, 'cards.0.links.0.title')
    assert.equal(card.value, 'T1')
    assert.equal(link.value, 'L1')

    link.value = 'Link edited'
    link.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelector('h3').textContent, 'T1')
    assert.equal(doc.querySelector('a').textContent, 'Link edited')

    card.value = 'T2'
    card.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelector('h3').textContent, 'T2')
    assert.equal(doc.querySelector('a').textContent, 'Link edited')
  } finally {
    close()
    reset(dom)
  }
})

test('repeated keys: a nested object title never reads or writes the row title', () => {
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"cards":["#features .card",{"cta":{"title":"a"},"title":"h3"}]}</script>
    </head><body><section id="features"><div class="card"><h3>T1</h3><a href="#">L1</a></div></section></body></html>`)
  open()
  try {
    const doc = dom.window.document
    const card = field(doc, 'cards.0.title')
    const cta = field(doc, 'cards.0.cta.title')
    assert.equal(card.value, 'T1')
    assert.equal(cta.value, 'L1')

    cta.value = 'Link edited'
    cta.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelector('h3').textContent, 'T1')
    assert.equal(doc.querySelector('a').textContent, 'Link edited')

    card.value = 'T2'
    card.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelector('h3').textContent, 'T2')
    assert.equal(doc.querySelector('a').textContent, 'Link edited')
  } finally {
    close()
    reset(dom)
  }
})

test('repeated keys: a global template whose root is the input still reads and writes each field', () => {
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"a":{"title":"h1"},"b":{"title":"h2"},"intro":"p"}</script>
    </head><body>
    <template data-hcms-tpl="@scalar"><input data-hcms-field></template>
    <h1>One</h1><h2>Two</h2><p>Intro</p></body></html>`)
  open()
  try {
    const doc = dom.window.document
    const at = (path) => doc.querySelector(`[data-hcms-form-root] input[data-hcms-path="${path}"]`)
    assert.equal(at('a.title').value, 'One')
    assert.equal(at('b.title').value, 'Two')
    const intro = at('intro')
    assert.equal(intro.value, 'Intro')

    intro.value = 'Changed'
    intro.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelector('h1').textContent, 'One')
    assert.equal(doc.querySelector('h2').textContent, 'Two')
  } finally {
    close()
    reset(dom)
  }
})

test('repeated keys: an inline object template reads and writes its own title', () => {
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"a":{"title":"h1"},"b":{"title":"h2"}}</script>
    </head><body>
    <template data-hcms-tpl="a"><div><input data-hcms-field="title"></div></template>
    <template data-hcms-tpl="b"><div><input data-hcms-field="title"></div></template>
    <h1>One</h1><h2>Two</h2></body></html>`)
  open()
  try {
    const doc = dom.window.document
    const at = (path) => doc.querySelector(`[data-hcms-form-root] input[data-hcms-path="${path}"]`)
    const a = at('a.title')
    const b = at('b.title')
    assert.equal(a.value, 'One')
    assert.equal(b.value, 'Two')

    b.value = 'Two edited'
    b.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    assert.equal(doc.querySelector('h1').textContent, 'One')
    assert.equal(doc.querySelector('h2').textContent, 'Two edited')
  } finally {
    close()
    reset(dom)
  }
})

test('repeated keys: reordering rows keeps every path shape in step with its new path', () => {
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{"cards":["#features .card",{"title":"h3"}]}</script>
    </head><body><section id="features">
    <div class="card"><h3>T1</h3></div>
    <div class="card"><h3>T2</h3></div>
    </section></body></html>`)
  open()
  try {
    const doc = dom.window.document
    const cards = doc.querySelectorAll('[data-hcms-form-root] [data-hcms-card]')
    cards[0].querySelector('[data-hcms-action="move-down"]').click()
    const paths = [...doc.querySelectorAll('[data-hcms-form-root] [data-hcms-path]')]
    assert.ok(paths.length > 0)
    for (const el of paths) {
      assert.equal(el.getAttribute('data-hcms-path-shape'), shapeOf(el.getAttribute('data-hcms-path').split('.')))
    }
  } finally {
    close()
    reset(dom)
  }
})
