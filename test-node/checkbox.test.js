import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// Engine extract stringifies @checked to "true" / "false". Without v0.2's
// coercion in extractFormData, the form-builder's Boolean("false") = true
// would flip unchecked to checked on commit.
test('checkbox: round-trip preserves true and false', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "published": ".p@data-pub" }
    </script>
    <template data-hcms-tpl="published">
      <label class="hcms-field" data-hcms-shape="scalar">
        <span data-hcms-label></span>
        <input type="checkbox" data-hcms-field="published"/>
      </label>
    </template>
    <div class="p" data-pub="true"></div>
  </body></html>`)
  open()
  try {
    const data = api.getData()
    assert.strictEqual(data.published, true, 'initial published is boolean true')
    // Uncheck
    const box = document.querySelector('[data-hcms-form-root] input[type="checkbox"]')
    box.checked = false
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    assert.strictEqual(api.getData().published, false, 'unchecked extracts as boolean false')
    // Re-check
    box.checked = true
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    assert.strictEqual(api.getData().published, true, 're-check extracts as boolean true')
  } finally {
    close()
    dom.window.close()
  }
})

// v0.3 fix #4 (Critical): engine.extract returns "true" / "false" strings for
// @checked rules. open() / refresh() must coerce before hydrating the form,
// otherwise writeValue's old Boolean("false")===true would flip an unchecked
// page state to checked at first open.
test('checkbox: page state "false" opens unchecked (pre-coerce on extract)', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "published": ".p@data-pub" }
    </script>
    <template data-hcms-tpl="published">
      <label class="hcms-field" data-hcms-shape="scalar">
        <span data-hcms-label></span>
        <input type="checkbox" data-hcms-field="published"/>
      </label>
    </template>
    <div class="p" data-pub="false"></div>
  </body></html>`)
  open()
  try {
    const box = document.querySelector('[data-hcms-form-root] input[type="checkbox"]')
    assert.strictEqual(box.checked, false, 'string "false" hydrates as unchecked')
    assert.strictEqual(api.getData().published, false)
  } finally {
    close()
    dom.window.close()
  }
})

test('checkbox: starts unchecked when data-pub absent', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "active": ".n@data-active" }
    </script>
    <template data-hcms-tpl="active">
      <label class="hcms-field" data-hcms-shape="scalar">
        <span data-hcms-label></span>
        <input type="checkbox" data-hcms-field="active"/>
      </label>
    </template>
    <span class="n"></span>
  </body></html>`)
  open()
  try {
    // Engine extracts empty data-active as "" — coercion keeps it falsy.
    assert.strictEqual(api.getData().active, false)
  } finally {
    close()
    dom.window.close()
  }
})
