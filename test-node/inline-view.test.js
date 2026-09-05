import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen, currentView, refresh, api } from '../src/hypercms.js'

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  {
    "title": ".title",
    "author": { "name": ".author-name" },
    "products": [".product", { "name": ".product-name", "price": ".product-price" }],
    "tags": "li.tag[]"
  }
  </script>
  <button id="page-button" type="button">Page button</button>
  <h1 class="title">Hello</h1>
  <section><span class="author-name">Ada</span></section>
  <div>
    <div class="product"><span class="product-name">P1</span><span class="product-price">10</span></div>
    <div class="product"><span class="product-name">P2</span><span class="product-price">20</span></div>
  </div>
  <ul>
    <li class="tag">a</li>
    <li class="tag">b</li>
  </ul>
</body></html>`

const SIDEBAR = '.hcms-panel'
const INLINE = 'hypercms-inline'

test('inline: open({ view: "inline" }) mounts a host carrying every never-persist marker', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open({ view: 'inline' })
  try {
    assert.equal(currentView(), 'inline')
    assert.equal(isOpen(), true)
    const host = dom.window.document.querySelector(INLINE)
    assert.ok(host, 'the inline host is in the document')
    for (const attr of ['data-hcms-shell', 'no-save', 'save-remove', 'snapshot-remove', 'no-watch']) {
      assert.equal(host.hasAttribute(attr), true, `host is missing [${attr}]`)
    }
  } finally {
    close()
  }
  reset(dom)
})

test('inline: the session reads the same data the sidebar does', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open()
  const fromSidebar = api.getData()
  close()
  open({ view: 'inline' })
  try {
    assert.deepEqual(api.getData(), fromSidebar)
  } finally {
    close()
  }
  reset(dom)
})

// [data-hcms-shell] is the engine's skip selector. Without it on the host, the
// CMS's own subtree becomes page content: the poison row below lands in the data.
test('inline: the engine does not read the inline host', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open({ view: 'inline' })
  try {
    const pop = dom.window.document.querySelector(INLINE + ' .hcms-inline-pop')
    assert.ok(pop, 'the popover container exists')
    const poison = dom.window.document.createElement('li')
    poison.className = 'tag'
    poison.textContent = 'POISON'
    pop.appendChild(poison)

    refresh()
    assert.deepEqual(api.getData().tags, ['a', 'b'], 'tags come from the page, not the editor')
  } finally {
    close()
  }
  reset(dom)
})

test('inline: reopening the inline view is a silent no-op, not a remount', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  const orig = console.warn
  let warned = false
  console.warn = (msg) => { if (/already open/.test(String(msg))) warned = true }
  open({ view: 'inline' })
  const firstHost = dom.window.document.querySelector(INLINE)
  open({ view: 'inline' })
  console.warn = orig
  try {
    assert.equal(warned, false)
    assert.equal(dom.window.document.querySelector(INLINE), firstHost, 'same host element')
    assert.equal(dom.window.document.querySelectorAll(INLINE).length, 1)
  } finally {
    close()
  }
  reset(dom)
})

test('inline: switching from the sidebar tears the sidebar down and mounts the host', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open()
  assert.ok(dom.window.document.querySelector(SIDEBAR), 'sidebar is up first')
  open({ view: 'inline' })
  try {
    assert.equal(dom.window.document.querySelector(SIDEBAR), null, 'the sidebar shell is gone')
    assert.equal(dom.window.document.querySelectorAll(INLINE).length, 1)
    assert.equal(currentView(), 'inline')
  } finally {
    close()
  }
  reset(dom)
})

// A switch is one continuous session, so it must not touch the URL. Only a real
// close rewrites cms=true to cms=false.
test('inline: a switch leaves ?cms=true alone; the close that follows rewrites it', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  dom.window.history.replaceState(null, '', '?cms=true')
  assert.equal(dom.window.location.search, '?cms=true')

  open()
  open({ view: 'inline' })
  assert.equal(dom.window.location.search, '?cms=true', 'the switch did not rewrite the URL')

  close()
  assert.equal(dom.window.location.search, '?cms=false')
  reset(dom)
})

test('inline: a switch carries the focus the first open captured', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  const button = dom.window.document.getElementById('page-button')
  button.focus()
  assert.equal(dom.window.document.activeElement, button)

  open()
  open({ view: 'inline' })
  close()
  assert.equal(
    dom.window.document.activeElement,
    button,
    'closing the second view returns focus to where the session started'
  )
  reset(dom)
})

test('inline: an unknown view name throws and leaves the open session untouched', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open()
  const shell = dom.window.document.querySelector(SIDEBAR)
  try {
    assert.throws(() => open({ view: 'nope' }), /unknown view "nope"/)
    assert.equal(isOpen(), true)
    assert.equal(currentView(), 'sidebar')
    assert.equal(dom.window.document.querySelector(SIDEBAR), shell, 'the same shell is still mounted')
    assert.deepEqual(api.getData().title, 'Hello', 'the session still works')
  } finally {
    close()
  }
  reset(dom)
})

test('inline: hcms:open carries view: "inline"', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  const seen = []
  dom.window.document.addEventListener('hcms:open', (e) => seen.push(e.detail))
  open({ view: 'inline' })
  try {
    assert.equal(seen.length, 1)
    assert.equal(seen[0].view, 'inline')
    assert.equal(seen[0].pageRoot, dom.window.document.body)
  } finally {
    close()
  }
  reset(dom)
})

test('inline: closing removes the host and clears currentView()', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open({ view: 'inline' })
  close()
  assert.equal(dom.window.document.querySelector(INLINE), null)
  assert.equal(currentView(), null)
  assert.equal(isOpen(), false)
  reset(dom)
})

// Same precondition as open-exception-safe.test.js: no mutation hub, so
// installObserver throws after the view has already mounted.
test('inline: a failed mount leaves nothing open and nothing mounted, and rethrows', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  delete dom.window.hyperclay.Mutation
  delete globalThis.hyperclay.Mutation

  assert.throws(() => open({ view: 'inline' }), /Mutation/)
  assert.equal(isOpen(), false)
  assert.equal(currentView(), null)
  assert.equal(dom.window.document.querySelector(INLINE), null, 'no orphan host remains')
  reset(dom)
})

// Without hcms-shell the popover's fields fall back to browser defaults, since
// every token and every mirk widget rule is scoped to it. Without hcms-inline
// the host picks up the docked panel geometry.
test('inline: the host joins the theme as a shell that is not a panel', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open({ view: 'inline' })
  try {
    const host = dom.window.document.querySelector(INLINE)
    assert.equal(host.className, 'hcms-shell pixel-quiet hcms-inline')
    assert.equal(host.classList.contains('hcms-panel'), false)
  } finally {
    close()
  }
  reset(dom)
})

test('inline: the theme option pins the host light or dark, same as the sidebar', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open({ view: 'inline', theme: 'dark' })
  try {
    assert.equal(dom.window.document.querySelector(INLINE).className, 'hcms-shell pixel-quiet hcms-inline dark')
  } finally {
    close()
  }
  reset(dom)
})

// A host calling open() to make sure the editor is up is not asking for the
// sidebar, and must not drag an inline session into one.
test('inline: a bare open() keeps the view that is already up', () => {
  if (isOpen()) close()
  const dom = loadPage(FIXTURE)
  open({ view: 'inline' })
  const host = dom.window.document.querySelector(INLINE)
  open()
  try {
    assert.equal(currentView(), 'inline')
    assert.equal(dom.window.document.querySelector(INLINE), host, 'the same host, never remounted')
    assert.equal(dom.window.document.querySelector(SIDEBAR), null, 'no sidebar appeared')
  } finally {
    close()
  }
  reset(dom)
})
