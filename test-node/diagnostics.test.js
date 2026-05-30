import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

function captureWarnings(fn) {
  const out = []
  const original = console.warn
  console.warn = (...args) => out.push(args.join(' '))
  try { fn() } finally { console.warn = original }
  return out
}

test('warns when template path does not match any rule', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="ghost.path"><div></div></template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
    <h1 class="title">x</h1>
  </body></html>`)
  const warnings = captureWarnings(() => open())
  try {
    assert.ok(
      warnings.some((w) => /\[hypercms\].*ghost\.path.*doesn't match any rule/.test(w)),
      `expected warning for unmatched template, got: ${JSON.stringify(warnings)}`
    )
  } finally {
    close()
    dom.window.close()
  }
})

test('warns when inline template field is not in rule shape', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="author">
      <div class="my">
        <input data-hcms-field="name"/>
        <input data-hcms-field="ghost"/>
      </div>
    </template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{ "author": { "name": ".n" } }</script>
    <div class="author"><span class="n">A</span></div>
  </body></html>`)
  const warnings = captureWarnings(() => open())
  try {
    assert.ok(
      warnings.some((w) => /\[hypercms\].*ghost.*not in the rule shape/.test(w)),
      `expected warning for inline ghost field, got: ${JSON.stringify(warnings)}`
    )
  } finally {
    close()
    dom.window.close()
  }
})
