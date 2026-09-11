import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadPage, reset } from './_helpers.js'
import { createInlineGhosts } from '../src/views/inline-ghosts.js'
import { createContentView } from '../src/lib/content-dom.js'
import { resolveTargets } from '../src/targets.js'
import { applyWithRollback } from '../src/apply-loop.js'
import { cms } from '../src/hypercms.js'
import { captureSnapshot, captureForSave } from '../../clayjs/src/core/snapshot.js'

function fixture(html = '<ul><li>One</li><li>Two</li></ul>') {
  const realm = loadPage(html, { runScripts: 'outside-only' })
  const doc = realm.window.document
  const container = doc.querySelector('ul, tbody')
  const items = [...container.children]
  items.forEach((el, i) => {
    el.getBoundingClientRect = () => ({ width: 200 + 40 * i, height: 60 + 20 * i })
  })
  const list = { container, items, path: ['items'] }
  const additions = []
  const ghosts = createInlineGhosts({ doc, onAdd: (fresh) => additions.push(fresh) })
  ghosts.setLists([list])
  return { realm, doc, container, items, list, additions, ghosts, ghost: container.lastElementChild }
}

test('ghost row: averages real rows, keeps its identity, and cleans up', () => {
  const t = fixture()
  try {
    assert.equal(t.ghost.tagName, 'LI')
    assert.equal(t.ghost.style.width, '220px')
    assert.equal(t.ghost.style.height, '70px')
    assert.equal(t.ghost.previousElementSibling, t.items[1])
    for (const attr of ['no-watch', 'no-save', 'snapshot-remove', 'data-hcms-shell']) assert.ok(t.ghost.hasAttribute(attr))
    const next = { ...t.list, path: ['renamed'] }
    t.ghosts.setLists([t.list])
    assert.equal(t.container.lastElementChild, t.ghost)
    t.ghosts.setLists([next])
    t.container.querySelector('button').click()
    assert.equal(t.additions[0], next)
    t.ghosts.setHidden(true)
    assert.equal(t.container.lastElementChild.hidden, true)
    t.ghosts.destroy()
    assert.equal(t.doc.querySelector('[data-hcms-ghost]'), null)
    assert.deepEqual([...t.container.children], t.items)
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('ghost row: preserves empty-list dimensions and creates valid table cells', () => {
  const t = fixture('<table><tbody><tr><td>A</td><td>B</td></tr><tr><td colspan="2">C</td></tr></tbody></table>')
  try {
    assert.equal(t.ghost.tagName, 'TR')
    assert.equal(t.ghost.firstElementChild.tagName, 'TD')
    assert.equal(t.ghost.firstElementChild.colSpan, 2)
    t.items.forEach((el) => el.remove())
    t.ghosts.setLists([{ ...t.list, items: [] }])
    assert.equal(t.container.lastElementChild, t.ghost)
    assert.equal(t.ghost.style.width, '220px')
    assert.equal(t.ghost.firstElementChild.style.height, '70px')
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('ghost row: restricted content models get an adjacent placeholder, not invalid children', () => {
  const realm = loadPage('<main><select><option>A</option></select><svg><g><circle r="5" /></g></svg></main>')
  const doc = realm.window.document
  const ghosts = createInlineGhosts({ doc, onAdd() {} })
  try {
    ghosts.setLists([
      { container: doc.querySelector('select'), items: [doc.querySelector('option')], path: ['options'] },
      { container: doc.querySelector('g'), items: [doc.querySelector('circle')], path: ['shapes'] },
    ])
    assert.equal(doc.querySelector('select').children.length, 1)
    assert.equal(doc.querySelector('main > svg').querySelector('[data-hcms-ghost]'), null)
    assert.ok(doc.querySelector('select').nextElementSibling.hasAttribute('data-hcms-ghost'))
    assert.ok(doc.querySelector('main > svg').nextElementSibling.hasAttribute('data-hcms-ghost'))
    assert.equal(doc.querySelectorAll('[data-hcms-ghost]').length, 2)
  } finally { ghosts.destroy(); reset(realm) }
})

test('ghost row: page reads retain structural selectors and ancestor HTML without losing focus', () => {
  const t = fixture()
  try {
    const button = t.ghost.querySelector('button')
    button.focus()
    const view = createContentView(t.container)
    const data = {
      last: view.query('li:last-child')[0].textContent,
      html: view.html(),
    }
    assert.equal(data.last, 'Two')
    assert.equal(data.html, '<li>One</li><li>Two</li>')
    assert.equal(t.doc.activeElement, button)
    assert.equal(t.container.lastElementChild, t.ghost)
    assert.deepEqual(resolveTargets(t.doc.body, { last: 'li:last-child' }).targets.map((target) => target.el), [t.items[1]])
    assert.equal(t.container.lastElementChild, t.ghost)
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('ghost row: nested editor nodes are not cloned into new page rows', () => {
  const t = fixture('<section><article><h2>One</h2><ul><li>A</li><li>B</li></ul></article></section>')
  try {
    const rules = { groups: ['article', { title: 'h2', items: 'li[]' }] }
    const result = applyWithRollback(t.doc.body, rules, { groups: [
      { title: 'One', items: ['A', 'B'] },
      { title: 'Two', items: ['C', 'D'] },
    ] }, { structural: true, structuralPath: 'groups' })
    assert.equal(result.ok, true)
    assert.equal(t.doc.querySelectorAll('article').length, 2)
    assert.equal(t.doc.querySelectorAll('[data-hcms-ghost]').length, 1)
    assert.equal(t.doc.querySelectorAll('article')[1].querySelector('[data-hcms-ghost]'), null)
    assert.equal(t.ghost.isConnected, true)
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('ghost row: failed structural apply restores authored rows without ghost copies', () => {
  const t = fixture()
  try {
    const result = applyWithRollback(t.doc.body, { items: 'li[]', missing: ['.missing', { label: '.' }] },
      { items: ['Changed'], missing: [{ label: 'Fail' }] }, { structural: true, structuralPath: 'items' })
    assert.equal(result.ok, false)
    assert.equal(t.doc.querySelectorAll('[data-hcms-ghost]').length, 1)
    assert.equal(t.ghost.isConnected, true)
    assert.equal(t.doc.querySelector('[data-hcms-ghost]'), t.ghost)
    assert.equal(createContentView(t.container).html(), '<li>One</li><li>Two</li>')
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('failed structural apply restores the original editor UI node and listener', () => {
  const realm = loadPage('<ul><li><span>A</span><button editor-ui>Tool</button></li></ul><aside></aside>')
  const doc = realm.window.document
  const button = doc.querySelector('button')
  let clicks = 0
  button.addEventListener('click', () => { clicks++ })
  try {
    const result = applyWithRollback(doc.body,
      { rows: ['li', { value: 'span' }], missing: ['aside > article', { value: '.' }] },
      { rows: [{ value: 'Changed' }], missing: [{ value: 'Fail' }] },
      { structural: true, structuralPath: 'rows' })
    assert.equal(result.ok, false)
    assert.equal(doc.querySelector('button'), button)
    button.click()
    assert.equal(clicks, 1)
  } finally { reset(realm) }
})

test('ghost row: replacing its parent leaves exactly one connected working Add control', () => {
  const t = fixture()
  try {
    const replacement = t.container.cloneNode(true)
    t.container.replaceWith(replacement)
    const items = [...replacement.children].filter((node) => !node.hasAttribute('data-hcms-ghost'))
    const next = { container: replacement, items, path: ['items'] }
    t.ghosts.setLists([next])
    assert.equal(t.doc.querySelectorAll('[data-hcms-ghost]').length, 1)
    const ghost = t.doc.querySelector('[data-hcms-ghost]')
    assert.equal(ghost.isConnected, true)
    ghost.querySelector('button').click()
    assert.deepEqual(t.additions, [next])
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('ghost row: real snapshot and save pipelines omit it without removing it from the page', () => {
  const t = fixture()
  try {
    assert.equal(captureSnapshot().querySelector('[data-hcms-ghost]'), null)
    const saved = captureForSave({ emitForSync: false })
    assert.ok(!saved.includes('data-hcms-ghost'))
    assert.ok(saved.includes('<li>One</li><li>Two</li>'))
    assert.equal(t.container.lastElementChild, t.ghost)
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('ghost row: actual Sortable excludes it and restores the original selector on close', () => {
  const t = fixture()
  try {
    t.realm.window.eval(fs.readFileSync(new URL('../../clayjs/src/vendor/Sortable.vendor.js', import.meta.url), 'utf8'))
    const Sortable = t.realm.window.Sortable
    const sortable = Sortable.create(t.container)
    const original = sortable.option('draggable')
    t.ghosts.update()
    const selector = sortable.option('draggable')
    assert.equal(Sortable.utils.closest(t.ghost, selector, t.container), null)
    assert.equal(Sortable.utils.closest(t.items[0], selector, t.container), t.items[0])
    t.ghosts.destroy()
    assert.equal(sortable.option('draggable'), original)
    sortable.destroy()
  } finally { t.ghosts.destroy(); reset(t.realm) }
})

test('ghost row: CMS Add and refresh never include the placeholder in data', () => {
  const realm = loadPage('<ul><li>One</li><li>Two</li></ul>')
  try {
    cms.open({ view: 'inline', richText: false, rules: { items: 'li[]', html: 'ul@innerHTML' } })
    const doc = realm.window.document
    const ghost = doc.querySelector('[data-hcms-ghost]')
    cms.refresh()
    assert.equal(cms.api.getData().html, '<li>One</li><li>Two</li>')
    assert.deepEqual(cms.api.getData().items, ['One', 'Two'])
    assert.equal(doc.querySelector('[data-hcms-ghost]'), ghost)
    cms.close()
    cms.open({ view: 'inline', richText: false, rules: { items: 'li[]' } })
    doc.querySelector('[data-hcms-ghost] button').click()
    assert.equal(doc.querySelectorAll('body > ul > li:not([data-hcms-ghost])').length, 3)
    assert.equal(doc.querySelectorAll('[data-hcms-ghost]').length, 1)
    cms.close()
    assert.equal(doc.querySelector('[data-hcms-ghost]'), null)
  } finally { cms.close(); reset(realm) }
})
