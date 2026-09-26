import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { loadPage, reset } from './_helpers.js'

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const workspace = path.dirname(root)
const hyperMorphSource = path.join(workspace, 'hyper-morph', 'src', 'hyper-morph.js')
const entry = path.join(root, 'test-node', 'fixtures', 'shared-runtime-entry.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function buildSharedRuntime() {
  const resolvedImporters = []
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    loader: { '.css': 'text' },
    plugins: [{
      name: 'corrected-hyper-morph-source',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^hyper-morph$/ }, (args) => {
          resolvedImporters.push(path.resolve(args.resolveDir, args.importer))
          return { path: hyperMorphSource }
        })
        buildApi.onLoad({ filter: /\.css$/ }, () => ({
          contents: ':root{}',
          loader: 'text',
        }))
      },
    }],
  })
  return { result, resolvedImporters }
}

test('inline ghost refresh stays silent in the actual mutation hub and undo, while Add stays undoable', async () => {
  const { result } = await buildSharedRuntime()
  const dom = loadPage('<ul><li>One</li><li>Two</li></ul>')
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#ghost`)
  window.clay.region = runtime.regionShape
  window.clay.Mutation = runtime.Mutation
  const scope = runtime.createScope({ scope: document.body, idleWindowMs: 10000 })
  window.clay.undo = scope
  const changes = []
  const off = runtime.Mutation.onAnyChange({ debounce: 0, require: 'observed' }, (batch) => changes.push(...batch))
  scope.start()
  try {
    runtime.cms.open({ view: 'inline', richText: false, rules: { items: 'li[]' } })
    await wait(180)
    scope.clear()
    changes.length = 0
    const ghost = document.querySelector('[data-hcms-ghost]')
    assert.ok(ghost)
    runtime.cms.refresh()
    await wait(300)
    scope.flush()
    assert.equal(document.querySelector('[data-hcms-ghost]'), ghost)
    assert.deepEqual(changes, [])
    assert.equal(scope.history.length, 0)
    ghost.querySelector('button').click()
    await wait(180)
    scope.flush()
    assert.equal(document.querySelectorAll('body > ul > li:not([data-hcms-ghost])').length, 3)
    assert.equal(document.querySelectorAll('[data-hcms-ghost]').length, 1)
    assert.equal(scope.history.length, 1)
    scope.undo()
    await wait(180)
    assert.deepEqual(runtime.cms.api.getData().items, ['One', 'Two'])
    assert.equal(document.querySelectorAll('body > ul > li:not([data-hcms-ghost])').length, 2)
    assert.equal(document.querySelectorAll('[data-hcms-ghost]').length, 1)
    scope.redo()
    await wait(180)
    assert.equal(document.querySelectorAll('body > ul > li:not([data-hcms-ghost])').length, 3)
    assert.equal(document.querySelectorAll('[data-hcms-ghost]').length, 1)
    runtime.cms.close()
    assert.equal(document.querySelector('[data-hcms-ghost]'), null)
  } finally {
    runtime.cms.close()
    off()
    scope.stop()
    runtime.Mutation._observer?.disconnect()
    reset(dom)
  }
})

test('actual ClayJS hub and HyperUndo use the corrected shared HyperMorph source', async () => {
  const { result, resolvedImporters } = await buildSharedRuntime()
  assert.ok(resolvedImporters.length > 0, 'the resolver saw at least one bare hyper-morph import')
  assert.ok(
    resolvedImporters.some((file) => file.endsWith(path.join('hypercms', 'src', 'morph.js'))),
    'the direct HyperCMS morph import resolved through the corrected source hook',
  )
  assert.ok(
    resolvedImporters.some((file) => file.endsWith(path.join('hyper-html-api', 'src', 'cms', 'morph.js'))),
    'the transitive hyper-html-api morph import resolved through the corrected source hook',
  )
  const inputs = Object.keys(result.metafile.inputs)
  const resolvedSources = inputs.filter((file) => path.resolve(file) === hyperMorphSource)
  assert.equal(resolvedSources.length, 1, 'the graph contains one HyperMorph implementation')

  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(hyperMorphSource)).digest('hex')
  assert.equal(sourceHash.length, 64)

  const dom = loadPage(`<!doctype html><html><head>
    <script type="application/json" data-rules-name="cms" data-rules-version="1">{"title":".title"}</script>
  </head><body><h1 class="title">Hello</h1></body></html>`)
  const bundleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  const runtime = await import(bundleUrl)
  const changes = []
  let off = null
  let raw = null
  let scope = null
  try {
    const resetAuthoredFixture = () => {
      document.head.innerHTML = `
        <script type="application/json" data-rules-name="cms" data-rules-version="1">{"title":".title"}</script>
      `
      document.body.innerHTML = '<h1 class="title">Hello</h1>'
      for (const pantry of document.querySelectorAll('html > div[hidden]')) pantry.remove()
    }

    document.body.innerHTML = '<main><section id="discard"><span id="keep">keep</span></section><article id="destination"></article></main>'
    let main = document.querySelector('main')
    let discarded = document.querySelector('#discard')
    const syncError = new Error('sync removal callback failed')
    let syncCaught = null
    try {
      runtime.HyperMorph.morph(
        main,
        '<article id="destination"><span id="keep">keep</span></article>',
        {
          morphStyle: 'innerHTML',
          callbacks: {
            beforeNodeRemoved(node) {
              if (node === discarded) throw syncError
            },
          },
        },
      )
    } catch (err) {
      syncCaught = err
    }
    const syncRestoredParent = discarded.parentNode
    const syncPantries = Array.from(document.querySelectorAll('html > div[hidden]'))
    for (const pantry of syncPantries) pantry.remove()
    assert.equal(syncCaught, syncError, 'the original synchronous callback error is rethrown')
    assert.equal(syncRestoredParent, main, 'a synchronous callback error restores still-staged authored content')
    assert.equal(syncPantries.length, 0, 'a synchronous callback error removes the pantry')

    document.head.innerHTML = ''
    document.body.innerHTML = '<main><section id="discard"><span id="keep">keep</span></section><article id="destination"></article></main>'
    main = document.querySelector('main')
    discarded = document.querySelector('#discard')
    const asyncError = new Error('async removal callback failed')
    const pending = runtime.HyperMorph.morph(
      document.documentElement,
      '<html><head><link rel="stylesheet" href="/shared-runtime.css"></head><body><main><article id="destination"><span id="keep">keep</span></article></main></body></html>',
      {
        head: { block: true },
        callbacks: {
          beforeNodeRemoved(node) {
            if (node === discarded) throw asyncError
          },
        },
      },
    )
    assert.ok(pending instanceof Promise, 'head blocking keeps the async return contract')
    document.querySelector('link[href="/shared-runtime.css"]').dispatchEvent(new window.Event('load'))
    await assert.rejects(pending, (err) => err === asyncError)
    assert.equal(discarded.parentNode, main, 'a post-wait callback error restores still-staged authored content')
    assert.equal(document.querySelectorAll('html > div[hidden]').length, 0, 'a post-wait callback error removes the pantry')

    resetAuthoredFixture()
    window.clay.region = runtime.regionShape
    window.clay.Mutation = runtime.Mutation
    scope = runtime.createScope({ scope: document.body, idleWindowMs: 10000 })
    window.clay.undo = scope
    scope.start()
    off = runtime.Mutation.onAnyChange(
      { debounce: 0, require: 'observed' },
      (batch) => changes.push(...batch),
    )
    raw = runtime.Mutation.subscribeRaw(() => {})

    runtime.cms.open({ view: 'sidebar', richText: false })
    assert.equal(runtime.cms.isOpen, true, 'CMS opened')
    const field = document.querySelector('textarea[data-hcms-field="title"], input[data-hcms-field="title"], select[data-hcms-field="title"]')
    assert.ok(field, 'the mapped title control exists')

    await wait(150)
    changes.length = 0
    scope.clear()
    document.querySelector('.title').textContent = 'Changed'
    await wait(180)
    assert.equal(field.value, 'Changed', 'a deliberate authored edit reached the form')
    scope.flush()
    assert.equal(scope.history.length, 1, 'the authored edit produced one undo action')
    scope.undo()
    await wait(180)
    assert.equal(document.querySelector('.title').textContent, 'Hello')
    assert.equal(field.value, 'Hello', 'undo refreshed the mapped form control')

    changes.length = 0
    scope.clear()
    runtime.cms.refresh()
    await wait(180)
    changes.length = 0
    await wait(300)
    assert.deepEqual(changes, [], 'an explicit maintenance refresh produces no continuing authored notifications')
    scope.flush()
    assert.equal(scope.history.length, 0, 'an explicit maintenance refresh creates no undo entry')

    runtime.cms.close()
    await wait(0)
    changes.length = 0
    scope.clear()

    main = document.createElement('main')
    main.innerHTML = '<section id="discard"><span id="keep">keep</span></section><article id="destination"></article>'
    document.body.appendChild(main)
    await wait(0)
    scope.clear()
    changes.length = 0

    discarded = main.querySelector('#discard')
    const kept = main.querySelector('#keep')
    const before = main.innerHTML
    const callbacks = []
    let pantry = null
    const pantryMoves = []
    const insertAdjacentElement = window.HTMLElement.prototype.insertAdjacentElement
    const insertBefore = window.Node.prototype.insertBefore
    window.HTMLElement.prototype.insertAdjacentElement = function (position, node) {
      const resultValue = insertAdjacentElement.call(this, position, node)
      if (this === document.body && position === 'afterend' && node.hidden) pantry = node
      return resultValue
    }
    window.Node.prototype.insertBefore = function (node, sibling) {
      if (this === pantry) pantryMoves.push(node.id || node.nodeName)
      return insertBefore.call(this, node, sibling)
    }
    try {
      runtime.HyperMorph.morph(
        main,
        '<article id="destination"><span id="keep">keep</span></article>',
        {
          morphStyle: 'innerHTML',
          callbacks: {
            beforeNodeRemoved: (node) => callbacks.push(`before:${node.id || node.nodeName}`),
            afterNodeRemoved: (node) => callbacks.push(`after:${node.id || node.nodeName}`),
          },
        },
      )
    } finally {
      window.Node.prototype.insertBefore = insertBefore
      window.HTMLElement.prototype.insertAdjacentElement = insertAdjacentElement
    }
    await wait(0)
    scope.flush()
    assert.ok(pantryMoves.length > 0, 'the fixture exercised actual staging')
    assert.equal(main.querySelector('#keep'), kept, 'the retained child kept identity')
    assert.ok(
      changes.some((change) => change.type === 'remove' && change.element === discarded),
      'the authored discarded parent removal remained observable',
    )
    const after = main.innerHTML
    scope.undo()
    assert.equal(main.innerHTML, before, 'undo restored the exact authored structure')
    scope.redo()
    assert.equal(main.innerHTML, after, 'redo restored the exact morphed structure')
    assert.deepEqual(callbacks, ['before:discard', 'after:discard'])
  } finally {
    try { runtime.cms.close() } catch {}
    raw?.unsubscribe()
    off?.()
    scope?.stop()
    runtime.Mutation._observer?.disconnect()
    reset(dom)
  }
})
