import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'

import { loadPage, reset } from './_helpers.js'
import { buildClayjs, buildStandalone } from '../scripts/build-js.js'
import { assertSharedHyperMorph } from '../scripts/shared-hyper-morph.js'

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const workspace = path.dirname(root)
const morphRoot = path.join(workspace, 'hyper-morph')
const morphSource = path.join(morphRoot, 'src', 'hyper-morph.js')
const morphVendor = path.join(workspace, 'clayjs', 'src', 'vendor', 'hyper-morph.vendor.js')

function fixtureHtml() {
  return `<!doctype html><html><head>
    <script type="application/json" data-rules-name="cms" data-rules-version="1">{"title":".title"}</script>
  </head><body><h1 class="title">Hello</h1></body></html>`
}

test('ClayJS ESM build externalizes one verified HyperMorph module and preserves its namespace', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercms-esm-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const cmsVendor = path.join(temporary, 'hypercms.vendor.js')
  fs.copyFileSync(morphVendor, path.join(temporary, 'hyper-morph.vendor.js'))

  const { result, resolvedImporters, provenance } = await buildClayjs({ outfile: cmsVendor })
  assert.ok(resolvedImporters.length > 0, 'the shared resolver saw HyperMorph imports')
  assert.deepEqual(
    new Set(provenance.importerPackages),
    new Set(['@panphora/hyper-cms', 'hyper-html-api']),
    'every reachable importing package was checked',
  )
  const externalImports = Object.values(result.metafile.inputs)
    .flatMap((input) => input.imports)
    .filter((entry) => entry.external && entry.path === './hyper-morph.vendor.js')
  assert.ok(externalImports.length > 0, 'the ESM graph contains a nonzero shared import')
  assert.equal(
    Object.keys(result.metafile.inputs).filter((file) => path.resolve(file) === morphSource).length,
    0,
    'the CMS ESM artifact embeds no HyperMorph source implementation',
  )

  const dom = loadPage(fixtureHtml(), { virtualConsole: new VirtualConsole() })
  try {
    window.__hyperclayNoAutoExport = true
    const module = await import(`${pathToFileURL(cmsVendor).href}?suppressed=${Date.now()}`)
    assert.equal(typeof module.cms.open, 'function')
    assert.equal(module.default.cms, module.cms)
    assert.equal(module.default.default.cms, module.cms)
    assert.equal(window.hyperclay.hypercms, undefined, 'the loader suppression guard remains effective')

    module.cms.open({ view: 'sidebar', richText: false })
    assert.equal(module.cms.isOpen, true)
    assert.ok(document.querySelector('textarea[data-hcms-field="title"]'))
    module.cms.close()

    window.__hyperclayNoAutoExport = false
    const globalModule = await import(`${pathToFileURL(cmsVendor).href}?global=${Date.now()}`)
    assert.equal(window.hyperclay.hypercms, globalModule.cms, 'the convenience global keeps the flat CMS API')
  } finally {
    reset(dom)
  }
})

test('corrected standalone build contains one HyperMorph implementation and starts as an IIFE', async () => {
  const { result, resolvedImporters } = await buildStandalone({
    outfile: path.join(os.tmpdir(), 'hypercms-corrected-test.js'),
    hyperMorphSource: morphSource,
    write: false,
  })
  assert.ok(resolvedImporters.length > 0, 'the corrected resolver saw HyperMorph imports')
  const implementations = Object.entries(result.metafile.inputs)
    .filter(([file]) => path.resolve(file) === morphSource)
  assert.equal(implementations.length, 1)
  assert.ok(implementations[0][1].bytes > 1000, 'the standalone graph contains nonzero implementation bytes')

  const virtualConsole = new VirtualConsole()
  const dom = new JSDOM(fixtureHtml(), {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    virtualConsole,
  })
  dom.window.hyperclay = {
    Mutation: {
      onAnyChange: () => () => {},
      onAddOrRemove: () => () => {},
      onAddElement: () => () => {},
      onRemoveElement: () => () => {},
      onAttribute: () => () => {},
    },
  }
  dom.window.eval(result.outputFiles[0].text)
  try {
    assert.equal(typeof dom.window.hypercms.cms.open, 'function')
    dom.window.hypercms.cms.open({ view: 'sidebar', richText: false })
    assert.equal(dom.window.hypercms.cms.isOpen, true)
    assert.ok(dom.window.document.querySelector('textarea[data-hcms-field="title"]'))
    dom.window.hypercms.cms.close()
  } finally {
    dom.window.close()
  }
})

test('ClayJS standalone graph contains one nonempty shared HyperMorph implementation', async () => {
  const result = await build({
    entryPoints: [path.join(workspace, 'clayjs', 'src', 'standalone.js')],
    bundle: true,
    format: 'iife',
    write: false,
    metafile: true,
    external: ['https://*'],
    logOverride: { 'commonjs-variable-in-esm': 'silent' },
  })
  const implementations = Object.entries(result.metafile.inputs)
    .filter(([file]) => file.endsWith(path.join('clayjs', 'src', 'vendor', 'hyper-morph.vendor.js')))
  assert.equal(implementations.length, 1)
  assert.ok(implementations[0][1].bytes > 1000, 'the ClayJS standalone graph contains implementation bytes')
  assert.ok(result.outputFiles[0].contents.byteLength > implementations[0][1].bytes)
})

test('shared HyperMorph guard fails closed for empty, stale, missing, and incompatible inputs', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercms-guard-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const directImporter = path.join(root, 'src', 'morph.js')
  const actualDist = path.join(morphRoot, 'dist', 'hyper-morph.min.js')

  await assert.rejects(
    assertSharedHyperMorph({ rootDir: root, resolvedImporters: [] }),
    /resolved zero hyper-morph imports/,
  )

  const staleDist = path.join(temporary, 'stale.js')
  fs.writeFileSync(staleDist, `${fs.readFileSync(actualDist, 'utf8')}stale`)
  await assert.rejects(
    assertSharedHyperMorph({
      rootDir: root,
      resolvedImporters: [directImporter],
      distFile: staleDist,
    }),
    /distribution is stale/,
  )

  await assert.rejects(
    assertSharedHyperMorph({
      rootDir: root,
      resolvedImporters: [directImporter],
      vendorFile: path.join(temporary, 'missing.js'),
    }),
    /vendor is unreadable/,
  )

  const incompatibleRoot = path.join(temporary, 'incompatible')
  fs.mkdirSync(incompatibleRoot)
  fs.writeFileSync(path.join(incompatibleRoot, 'package.json'), JSON.stringify({
    name: 'incompatible-importer',
    dependencies: { 'hyper-morph': '^0.6.0' },
  }))
  const incompatibleImporter = path.join(incompatibleRoot, 'index.js')
  fs.writeFileSync(incompatibleImporter, 'import HyperMorph from "hyper-morph"\n')
  await assert.rejects(
    assertSharedHyperMorph({
      rootDir: root,
      resolvedImporters: [incompatibleImporter],
    }),
    /does not satisfy incompatible-importer range/,
  )
})
