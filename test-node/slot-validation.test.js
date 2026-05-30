import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

test('slotted object template missing .hcms-object-fields throws', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="author">
      <section class="author"><h3 data-hcms-label></h3></section>
    </template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "author": { "name": ".n" } }
    </script>
    <div class="author"><span class="n">A</span></div>
  </body></html>`)
  try {
    assert.throws(() => open(), /slotted mode but has no .hcms-object-fields/)
  } finally {
    if (isOpen()) close()
    dom.window.close()
  }
})

// v0.3 fix #7 (Should-fix): array templates missing .hcms-array-items must
// throw — the silent fallback (use the template root) hid author bugs.
test('object-array template missing .hcms-array-items throws', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="products">
      <section class="bag"></section>
    </template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div><div class="product"><span class="n">a</span></div></div>
  </body></html>`)
  try {
    assert.throws(() => open(), /\.hcms-array-items/)
  } finally {
    if (isOpen()) close()
    dom.window.close()
  }
})

test('slotted card template missing .hcms-card-fields throws', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <template data-hcms-tpl="products.*">
      <article class="hcms-card"><header><button type="button" data-hcms-action="remove">x</button></header></article>
    </template>
  </head><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div><div class="product"><span class="n">a</span></div></div>
  </body></html>`)
  try {
    assert.throws(() => open(), /slotted mode but has no .hcms-card-fields/)
  } finally {
    if (isOpen()) close()
    dom.window.close()
  }
})
