import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, refresh, api } from '../src/hypercms.js'
import { state } from '../src/session.js'
import { commit, extractFormData } from '../src/events.js'
import { stripReadOnly } from '../src/unresolved.js'

// Review round 3, finding F9 (plans/hypercms/make-malleable/track-3-review.md).
// A read-only projection sits BETWEEN two writable fields, because ordering is
// what exposes the partial write: engine.apply throws RuleTargetReadOnly
// part-way through its walk and the ordinary edit path does not snapshot.

const FIXTURE = `<!DOCTYPE html><html><head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  {
    "title": ".title",
    "width": ".box@offsetWidth",
    "body": ".body"
  }
  </script>
</head><body>
  <h1 class="title">old title</h1>
  <div class="box">boxy</div>
  <p class="body">old body</p>
  <p class="tail">old tail</p>
</body></html>`

function fresh() {
  if (isOpen()) close()
  return loadPage(FIXTURE)
}

function setField(ctx, path, value) {
  const field = ctx.formRoot.querySelector(
    `textarea[data-hcms-field="${path}"], input[data-hcms-field="${path}"], select[data-hcms-field="${path}"]`,
  )
  assert.ok(field, `the form has an editable field for "${path}"`)
  field.value = value
}

test('a commit writes both writable fields across a read-only projection', () => {
  const dom = fresh()
  open({ view: 'sidebar' })
  try {
    const ctx = state.ctx
    setField(ctx, 'title', 'NEW title')
    setField(ctx, 'body', 'NEW body')
    commit(extractFormData(ctx), { path: '', structural: false }, ctx)
    const doc = dom.window.document
    assert.equal(doc.querySelector('.title').textContent, 'NEW title')
    assert.equal(
      doc.querySelector('.body').textContent,
      'NEW body',
      'the write ordered after the read-only projection still landed',
    )
  } finally {
    close()
    reset(dom)
  }
})

test('that same commit succeeds instead of surfacing RuleTargetReadOnly', () => {
  const dom = fresh()
  open({ view: 'sidebar' })
  try {
    const ctx = state.ctx
    setField(ctx, 'title', 'NEW title')
    setField(ctx, 'body', 'NEW body')
    const result = commit(extractFormData(ctx), { path: '', structural: false }, ctx)
    assert.equal(result.ok, true)
    assert.equal(result.error, undefined)
    assert.notEqual(result.skipped, true, 'the commit ran rather than being fingerprint-skipped')
  } finally {
    close()
    reset(dom)
  }
})

test('the read-only field is still read, so the shape onChange sees is unchanged', () => {
  const dom = fresh()
  const seen = []
  open({ view: 'sidebar', onChange: (data) => seen.push(data) })
  try {
    const ctx = state.ctx
    assert.deepEqual(Object.keys(ctx.initialData), ['title', 'width', 'body'])
    assert.deepEqual(Object.keys(api.getData()), ['title', 'width', 'body'])
    setField(ctx, 'body', 'NEW body')
    commit(extractFormData(ctx), { path: 'body', structural: false }, ctx)
    assert.equal(seen.length, 1)
    assert.deepEqual(Object.keys(seen[0]), ['title', 'width', 'body'])
  } finally {
    close()
    reset(dom)
  }
})

test('the notice names the read-only field and says why, not that it stopped matching', () => {
  const dom = fresh()
  open({ view: 'sidebar' })
  try {
    const ctx = state.ctx
    assert.deepEqual(ctx.unresolved.readOnly, ['width'])
    assert.deepEqual(ctx.unresolved.missing, [], 'a read-only field is never also reported as missing')
    const notice = ctx.noticeEl
    assert.equal(notice.hidden, false)
    assert.equal(
      notice.textContent,
      '1 field reads a property the browser will not let anything write: width',
    )
  } finally {
    close()
    reset(dom)
  }
})

test('a refresh re-derives the write rules, so a field the rules tag gained still writes', () => {
  const dom = fresh()
  open({ view: 'sidebar' })
  try {
    const ctx = state.ctx
    const tag = dom.window.document.querySelector('script[data-rules-name="cms"]')
    tag.textContent = JSON.stringify({
      title: '.title',
      width: '.box@offsetWidth',
      body: '.body',
      tail: '.tail',
    })
    refresh()
    setField(ctx, 'title', 'NEW title')
    setField(ctx, 'body', 'NEW body')
    setField(ctx, 'tail', 'NEW tail')
    const result = commit(extractFormData(ctx), { path: '', structural: false }, ctx)
    assert.equal(result.ok, true)
    const doc = dom.window.document
    assert.equal(doc.querySelector('.title').textContent, 'NEW title')
    assert.equal(doc.querySelector('.body').textContent, 'NEW body')
    assert.equal(
      doc.querySelector('.tail').textContent,
      'NEW tail',
      'the write rules the refresh built include the field the tag gained',
    )
  } finally {
    close()
    reset(dom)
  }
})

test('stripReadOnly narrows only the write side', () => {
  assert.deepEqual(
    stripReadOnly({ rows: ['.row', { w: '.x@offsetWidth' }] }),
    { rows: ['.row', {}] },
    'an object-array whose every field is read-only keeps its selector so rows still apply',
  )
  assert.deepEqual(
    stripReadOnly({ widths: ['.row', '.x@offsetWidth'] }),
    { widths: ['.row', undefined] },
    'an array whose item shape strips to nothing keeps the selector rows are added and removed by',
  )
  const writable = { a: '.a', b: ['.b', { c: '.c@href' }], d: '@innerHTML', e: '.e[]' }
  assert.deepEqual(stripReadOnly(writable), writable, 'a writable tree is returned unchanged')
})

// Review round 7. A list whose only field is a read-only projection stripped to
// nothing at all, taking the selector engine.apply adds, removes and reorders
// rows by with it: every structural operation reported success while the page
// did not change.

const LIST_FIXTURE = `<!DOCTYPE html><html><head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  {
    "title": ".title",
    "widths": [".row", ".w@offsetWidth"]
  }
  </script>
</head><body>
  <h1 class="title">old title</h1>
  <ul>
    <li class="row"><span class="w">one</span></li>
    <li class="row"><span class="w">two</span></li>
  </ul>
</body></html>`

function freshList() {
  if (isOpen()) close()
  return loadPage(LIST_FIXTURE)
}

function rowCount(dom) {
  return dom.window.document.querySelectorAll('.row').length
}

test('adding to a list whose only field is read-only adds a row to the PAGE', () => {
  const dom = freshList()
  const errors = []
  open({ view: 'sidebar', onError: (err) => errors.push(err) })
  try {
    assert.equal(rowCount(dom), 2)
    api.addItem('widths')
    assert.equal(rowCount(dom), 3, 'the page grew, not just the form')
    assert.deepEqual(errors, [], 'no RuleTargetReadOnly on the way')
    assert.equal(state.ctx.lastErrors, null)
  } finally {
    close()
    reset(dom)
  }
})

test('removing from that same list removes a row from the PAGE', () => {
  const dom = freshList()
  const errors = []
  open({ view: 'sidebar', onError: (err) => errors.push(err) })
  try {
    assert.equal(rowCount(dom), 2)
    api.removeItem('widths.0')
    assert.equal(rowCount(dom), 1, 'the page shrank, not just the form')
    assert.deepEqual(errors, [], 'no RuleTargetReadOnly on the way')
    assert.equal(state.ctx.lastErrors, null)
  } finally {
    close()
    reset(dom)
  }
})

test('that list keeps its selector on the write side', () => {
  const dom = freshList()
  open({ view: 'sidebar' })
  try {
    assert.deepEqual(state.ctx.writeRules, { title: '.title', widths: ['.row', undefined] })
  } finally {
    close()
    reset(dom)
  }
})

// A rules tree that is nothing BUT a read-only projection strips to undefined,
// which is a legitimate write-rule value: engine.apply writes nothing. A falsy
// check read it as "no write rules were derived" and fell back to the unstripped
// tree, which is the one that throws.

const ROOT_READ_ONLY_FIXTURE = `<!DOCTYPE html><html><head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">".box@offsetWidth"</script>
</head><body>
  <div class="box">boxy</div>
</body></html>`

test('a commit against a wholly read-only rules tree succeeds and writes nothing', () => {
  if (isOpen()) close()
  const dom = loadPage(ROOT_READ_ONLY_FIXTURE)
  open({ view: 'sidebar' })
  try {
    const ctx = state.ctx
    assert.equal(ctx.writeRules, undefined, 'the whole tree stripped away')
    const before = dom.window.document.querySelector('.box').outerHTML
    const result = commit('CHANGED', { path: '', structural: false }, ctx)
    assert.equal(result.ok, true)
    assert.equal(result.error, undefined)
    assert.notEqual(result.skipped, true, 'the commit ran rather than being fingerprint-skipped')
    assert.equal(
      dom.window.document.querySelector('.box').outerHTML,
      before,
      'nothing was written to the page',
    )
  } finally {
    close()
    reset(dom)
  }
})

// findUnresolved runs before the first extract precisely so an invalid selector
// names its field. A read-only rule must not skip that resolution, or the raw
// SyntaxError escapes from the extract below it instead.

const INVALID_READ_ONLY_FIXTURE = `<!DOCTYPE html><html><head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "w": "div]@offsetWidth" }
  </script>
</head><body>
  <div class="box">boxy</div>
</body></html>`

test('an invalid selector on a read-only rule is still named, not thrown raw', () => {
  if (isOpen()) close()
  const dom = loadPage(INVALID_READ_ONLY_FIXTURE)
  try {
    assert.throws(
      () => open({ view: 'sidebar' }),
      (err) => {
        assert.equal(err.name, 'InvalidRuleSelector')
        assert.equal(err.path, 'w')
        assert.equal(err.selector, 'div]')
        return true
      },
    )
  } finally {
    if (isOpen()) close()
    reset(dom)
  }
})
