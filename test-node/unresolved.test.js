import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'
import { findUnresolved, InvalidRuleSelector } from '../src/unresolved.js'

function pageWith(rules, body) {
  return loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">${JSON.stringify(rules)}</script>
    ${body}
  </body></html>`)
}

function unresolvedFor(rules, body) {
  const dom = pageWith(rules, body)
  try {
    return findUnresolved(dom.window.document.body, rules)
  } finally {
    dom.window.close()
  }
}

function captureWarnings(fn) {
  const out = []
  const original = console.warn
  console.warn = (...args) => out.push(args.join(' '))
  try { fn() } finally { console.warn = original }
  return out
}

function noticeText(dom) {
  const el = dom.window.document.querySelector('.hcms-shell-notice')
  return el && !el.hidden ? el.textContent : null
}

test('reports a scalar whose selector matches nothing', () => {
  const { missing } = unresolvedFor({ title: 'h1.headline' }, '<h2>nope</h2>')
  assert.deepEqual(missing, ['title'])
})

test('does not report an element that is present but empty', () => {
  const { missing } = unresolvedFor({ title: 'h1' }, '<h1></h1>')
  assert.deepEqual(missing, [])
})

test('does not report a present element whose attribute is blank', () => {
  // The cry-wolf case: extract returns null for a blank attribute exactly as it
  // does for a missing element, but this field saves perfectly.
  const { missing } = unresolvedFor({ link: 'a.contact@href' }, '<a class="contact" href="">x</a>')
  assert.deepEqual(missing, [])
})

test('reports an attribute rule whose element is gone', () => {
  const { missing } = unresolvedFor({ link: 'a.contact@href' }, '<a class="other" href="/x">x</a>')
  assert.deepEqual(missing, ['link'])
})

test('never reports "." or a leading-@ rule, which read the context node', () => {
  const { missing } = unresolvedFor({ self: '.', id: '@data-id' }, '<p>x</p>')
  assert.deepEqual(missing, [])
})

test('a scalar matching two elements is a twin, not a missing field', () => {
  const { missing, twins } = unresolvedFor({ title: 'h1' }, '<h1>a</h1><h1>b</h1>')
  assert.deepEqual(missing, [])
  assert.deepEqual(twins, [{ path: 'title', count: 2 }])
})

test('reports a list whose item selector matches nothing and has no seed', () => {
  const { missing } = unresolvedFor({ items: ['li.row', { name: '.n' }] }, '<ul></ul>')
  assert.deepEqual(missing, ['items'])
})

test('does not report an empty list that still holds a [cms-template] seed', () => {
  const { missing } = unresolvedFor(
    { items: ['li.row', { name: '.n' }] },
    '<ul><li class="row" cms-template><span class="n"></span></li></ul>'
  )
  assert.deepEqual(missing, [])
})

test('reports an item field once, not once per row', () => {
  const { missing } = unresolvedFor(
    { items: ['li.row', { name: '.n', note: '.gone' }] },
    '<ul><li class="row"><span class="n">a</span></li><li class="row"><span class="n">b</span></li></ul>'
  )
  assert.deepEqual(missing, ['items.*.note'])
})

test('reports a dead scalar array, but not an empty one with a seed', () => {
  assert.deepEqual(unresolvedFor({ tags: 'li.tag[]' }, '<ul></ul>').missing, ['tags'])
  assert.deepEqual(
    unresolvedFor({ tags: 'li.tag[]' }, '<ul><li class="tag" cms-template></li></ul>').missing,
    []
  )
})

test('an invalid selector names its field instead of throwing a bare SyntaxError', () => {
  const dom = pageWith({ hero: { title: 'h1[' } }, '<h1>x</h1>')
  try {
    assert.throws(
      () => findUnresolved(dom.window.document.body, { hero: { title: 'h1[' } }),
      (err) => err instanceof InvalidRuleSelector && err.path === 'hero.title'
    )
  } finally {
    dom.window.close()
  }
})

test('the sidebar notice names the broken fields and hides when there are none', () => {
  if (isOpen()) close()
  const dom = pageWith(
    { title: 'h1', tagline: 'p.tagline' },
    '<h1>Real</h1>'
  )
  open()
  try {
    assert.equal(noticeText(dom), '1 field no longer matches this page: tagline')
  } finally {
    close()
    dom.window.close()
  }

  const clean = pageWith({ title: 'h1' }, '<h1>Real</h1>')
  open()
  try {
    assert.equal(noticeText(clean), null)
  } finally {
    close()
    clean.window.close()
  }
})

test('twins are warned to the console, not shown in the notice', () => {
  if (isOpen()) close()
  const dom = pageWith({ title: 'h1' }, '<h1>a</h1><h1>b</h1>')
  const warnings = captureWarnings(() => open())
  try {
    assert.equal(noticeText(dom), null)
    assert.ok(
      warnings.some((w) => /"title" matches 2 elements/.test(w)),
      `expected a twin warning, got: ${JSON.stringify(warnings)}`
    )
  } finally {
    close()
    dom.window.close()
  }
})
