import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engine } from 'hyper-html-api'
import { loadPage, reset } from './_helpers.js'

// Protects the engine behavior the whole inline text path rests on: applying
// unchanged data must be a genuine no-op, not a rewrite of the same value.
// Without the compare-before-write guard, assigning innerHTML tears down and
// rebuilds every rich-text region on the page, and the CMS re-applies the whole
// page on each keystroke — so every keystroke loses the caret and restarts any
// embedded media. Attribute rules have the same problem in miniature: setting an
// attribute to the value it already holds still emits a mutation record, which
// reaches undo and live sync. Asserted against the installed engine, so a
// dependency that regressed to the old behavior fails here.

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
  <h1 class="title">Hello <em>there</em></h1>
  <div class="badge" data-kind="new">Badge</div>
</body></html>`

function observe(win, root) {
  const observer = new win.MutationObserver(() => {})
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })
  return observer
}

test('re-applying an unchanged @innerHTML leaves the existing child nodes alone', () => {
  const dom = loadPage(FIXTURE)
  try {
    const win = dom.window
    const root = win.document.body
    const rules = { title: '.title@innerHTML' }
    const data = engine.extract(root, rules)
    assert.equal(data.title, 'Hello <em>there</em>')

    const emBefore = root.querySelector('em')
    const observer = observe(win, root)
    engine.apply(root, rules, data)
    const records = observer.takeRecords()
    observer.disconnect()

    assert.equal(emBefore, root.querySelector('em'), 'the child element was not rebuilt')
    assert.deepEqual(records, [], 'an unchanged innerHTML emitted no mutation records')
  } finally {
    reset(dom)
  }
})

test('re-applying an unchanged attribute emits no mutation record', () => {
  const dom = loadPage(FIXTURE)
  try {
    const win = dom.window
    const root = win.document.body
    const rules = { kind: '.badge@data-kind' }
    const data = engine.extract(root, rules)
    assert.equal(data.kind, 'new')

    const observer = observe(win, root)
    engine.apply(root, rules, data)
    const records = observer.takeRecords()
    observer.disconnect()

    assert.deepEqual(records, [], 'an unchanged attribute emitted no mutation records')
  } finally {
    reset(dom)
  }
})
