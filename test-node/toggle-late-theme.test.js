import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

test('a bundle loaded after DOM ready styles the closed toggle with the shared Mirk theme', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/hypercms-bundle.js', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'hypercms',
    loader: { '.css': 'text' },
    write: false,
    logLevel: 'silent',
  })
  const warnings = []
  const console = new VirtualConsole()
  console.on('warn', (message) => warnings.push(message))
  const dom = new JSDOM('<!doctype html><html><head><script type="application/json" data-rules-name="cms" data-rules-version="1">{"title":"h1"}</script></head><body><h1>Hello</h1></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: console,
  })
  try {
    await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }))
    dom.window.__hyperclayEditMode = true
    dom.window.eval(result.outputFiles[0].text)
    await new Promise((resolve) => dom.window.queueMicrotask(resolve))
    const doc = dom.window.document
    assert.ok(doc.querySelector('[data-hcms-toggle-host].pixel-quiet'))
    assert.match(doc.querySelector('#hcms-shell-styles').textContent, /--mirk-bevel-bg/)
    assert.equal(doc.querySelector('[data-hcms-shell]'), null, 'the editor remains closed')
    assert.ok(!warnings.some((message) => String(message).includes('stylesheet not applied')))
  } finally {
    dom.window.close()
  }
})
