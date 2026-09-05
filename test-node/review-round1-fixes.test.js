import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, refresh, api } from '../src/hypercms.js'
import { state } from '../src/session.js'
import { commit, requestRemove, extractFormData } from '../src/events.js'
import { resolveTargets } from '../src/targets.js'

// Review round 1, findings F2, F3, F4 and F11
// (plans/hypercms/make-malleable/track-3-review.md).

const FIXTURE = `<!DOCTYPE html><html><head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  {
    "title": ".title",
    "products": [".product", { "name": ".product-name" }]
  }
  </script>
</head><body>
  <h1 class="title">DECOY</h1>
  <section id="scope">
    <h1 class="title">Hello</h1>
    <p class="subtitle">Sub</p>
    <p class="sentinel-only">Sentinel</p>
    <div class="list">
      <div class="product"><span class="product-name">P1</span></div>
      <div class="product"><span class="product-name">P2</span></div>
    </div>
  </section>
  <section id="other">
    <h1 class="title">Other</h1>
    <p class="subtitle">Other sub</p>
    <p class="sentinel-only">Other sentinel</p>
    <div class="list">
      <div class="product"><span class="product-name">Q1</span></div>
    </div>
  </section>
</body></html>`

const tick = () => new Promise((r) => setTimeout(r, 0))

function fresh() {
  if (isOpen()) close()
  return loadPage(FIXTURE)
}

// --- F3: a view switch carries the session's options -------------------------

test('F3: switching views keeps the session pointed at the pageRoot it opened with', () => {
  const dom = fresh()
  const scope = dom.window.document.querySelector('#scope')
  open({ view: 'sidebar', pageRoot: scope })
  try {
    open({ view: 'inline' })
    assert.equal(state.ctx.pageRoot, scope, 'the switched session still targets the opening pageRoot')
    api.setValue('title', 'Changed')
    assert.equal(
      scope.querySelector('.title').textContent,
      'Changed',
      'the write landed inside the section the session was opened on',
    )
    assert.equal(
      dom.window.document.querySelector('body > .title').textContent,
      'DECOY',
      'nothing was written through document.body',
    )
  } finally {
    close()
    reset(dom)
  }
})

test('F3: switching views keeps calling the onChange it opened with', () => {
  const dom = fresh()
  const scope = dom.window.document.querySelector('#scope')
  const calls = []
  open({ view: 'sidebar', pageRoot: scope, onChange: (data, info) => calls.push(info) })
  try {
    open({ view: 'inline' })
    assert.equal(calls.length, 0, 'a switch is not itself a change')
    api.setValue('title', 'Changed')
    assert.equal(calls.length, 1, 'the opening onChange still fires after the switch')
    assert.equal(calls[0].path, 'title')
  } finally {
    close()
    reset(dom)
  }
})

test('F3: switching views keeps the explicit rules object it opened with', () => {
  const dom = fresh()
  const scope = dom.window.document.querySelector('#scope')
  open({ view: 'sidebar', pageRoot: scope, rules: { subtitle: '.subtitle' } })
  try {
    assert.deepEqual(api.getData(), { subtitle: 'Sub' })
    open({ view: 'inline' })
    assert.deepEqual(
      api.getData(),
      { subtitle: 'Sub' },
      'the switched session reads the caller rules, not the default cms tag',
    )
  } finally {
    close()
    reset(dom)
  }
})

test('F3: an option supplied on the switch wins over the one carried from the session', () => {
  const dom = fresh()
  const scope = dom.window.document.querySelector('#scope')
  const other = dom.window.document.querySelector('#other')
  open({ view: 'sidebar', pageRoot: scope })
  try {
    open({ view: 'inline', pageRoot: other })
    assert.equal(state.ctx.pageRoot, other, 'the explicitly supplied pageRoot wins')
    api.setValue('title', 'Retargeted')
    assert.equal(other.querySelector('.title').textContent, 'Retargeted')
    assert.equal(scope.querySelector('.title').textContent, 'Hello', 'the old pageRoot was left alone')
  } finally {
    close()
    reset(dom)
  }
})

// --- F4: refresh re-runs the view's rule preparation --------------------------

test('F4: refresh re-prepares the rules through the view seam, not a hardcoded upgrade', () => {
  const dom = fresh()
  const scope = dom.window.document.querySelector('#scope')
  open({ view: 'sidebar', pageRoot: scope })
  try {
    const sentinel = { title: '.title', sentinel: '.sentinel-only' }
    state.ctx.view.prepareRules = () => sentinel
    refresh()
    assert.equal(state.ctx.pageRules, sentinel, 'refresh took the rules the view prepared')
    assert.equal(
      state.ctx.pageRules.sentinel,
      '.sentinel-only',
      'the view-only rule survived the refresh',
    )
  } finally {
    close()
    reset(dom)
  }
})

// --- F11: a field inside <fieldset disabled> is not an editable control --------

test('F11: an input inside <fieldset disabled> resolves to a handle, not a native control', () => {
  const dom = loadPage(
    `<!DOCTYPE html><html><body>
      <fieldset disabled><input class="locked" value="x"></fieldset>
      <input class="free" value="y">
    </body></html>`,
  )
  try {
    const { targets } = resolveTargets(dom.window.document.body, {
      locked: 'input.locked@value',
      free: 'input.free@value',
    })
    const byPath = Object.fromEntries(targets.map((t) => [t.path.join('.'), t.kind]))
    assert.equal(byPath.locked, 'handle', 'an input the browser will not let anyone type in gets a handle')
    assert.equal(byPath.free, 'native', 'the same input outside the fieldset keeps its own control')
  } finally {
    reset(dom)
  }
})

// --- F2: a deferred confirmation never reaches a torn-down session -------------

function openWithPendingRemove(dom) {
  const scope = dom.window.document.querySelector('#scope')
  let allow
  dom.window.hyperclay.consent = () => new Promise((res) => { allow = res })
  open({ view: 'sidebar', pageRoot: scope })
  const ctx = state.ctx
  const formRoot = ctx.formRoot
  const card = formRoot.querySelector('[data-hcms-card]')
  assert.ok(card, 'the object-array rendered a card to remove')
  requestRemove(card, ctx)
  // Another writer changes the page while the confirm is on screen, so the form
  // held by the pending continuation is now stale in a way that shows.
  scope.querySelector('.title').textContent = 'Changed while the dialog was up'
  return { scope, formRoot, allow: () => allow() }
}

test('F2: a confirmation resolving after close() touches neither the page nor the session', async () => {
  const dom = fresh()
  try {
    const { scope, formRoot, allow } = openWithPendingRemove(dom)
    close()
    allow()
    await tick()
    assert.equal(scope.querySelectorAll('.product').length, 2, 'the page still has both products')
    assert.equal(
      scope.querySelector('.title').textContent,
      'Changed while the dialog was up',
      'the stale form was never applied over the live page',
    )
    assert.equal(
      formRoot.querySelectorAll('[data-hcms-card]').length,
      2,
      'the continuation returned before onRemove ran at all',
    )
  } finally {
    if (isOpen()) close()
    reset(dom)
  }
})

test('F2: a confirmation resolving after a view switch touches neither the page nor the old session', async () => {
  const dom = fresh()
  try {
    const { scope, formRoot, allow } = openWithPendingRemove(dom)
    open({ view: 'inline' })
    allow()
    await tick()
    assert.equal(scope.querySelectorAll('.product').length, 2, 'the page still has both products')
    assert.equal(
      scope.querySelector('.title').textContent,
      'Changed while the dialog was up',
      'the torn-down sidebar form was never applied over the live page',
    )
    assert.equal(
      formRoot.querySelectorAll('[data-hcms-card]').length,
      2,
      'the continuation returned before onRemove ran at all',
    )
  } finally {
    if (isOpen()) close()
    reset(dom)
  }
})

test('F2: commit on a closed session reports failure and writes nothing', () => {
  const dom = fresh()
  const scope = dom.window.document.querySelector('#scope')
  open({ view: 'sidebar', pageRoot: scope })
  const ctx = state.ctx
  const data = extractFormData(ctx)
  close()
  try {
    const stale = { ...data, title: 'Applied after close' }
    const result = commit(stale, { path: 'title', structural: false }, ctx)
    assert.equal(result.ok, false, 'ok:false keeps the phantom entry off the undo stack')
    assert.equal(result.closed, true)
    assert.equal(scope.querySelector('.title').textContent, 'Hello', 'the page was not written')
  } finally {
    if (isOpen()) close()
    reset(dom)
  }
})
