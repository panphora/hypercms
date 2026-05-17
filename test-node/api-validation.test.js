import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

test('setValue: rejects non-leaf object path', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "author": { "name": ".n", "bio": ".b" } }
    </script>
    <div class="author"><span class="n">A</span><span class="b">B</span></div>
  </body></html>`)
  open()
  try {
    assert.throws(() => api.setValue('author', { name: 'X' }), /not a leaf|no field element/)
  } finally {
    close()
    dom.window.close()
  }
})

test('setValue: rejects scalar-array path (not a leaf)', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">{ "tags": "li[]" }</script>
    <ul><li>a</li></ul>
  </body></html>`)
  open()
  try {
    assert.throws(() => api.setValue('tags', ['x']), /not a leaf/)
  } finally {
    close()
    dom.window.close()
  }
})

test('setValue: writes through to a checkbox field', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
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
    api.setValue('published', true)
    assert.strictEqual(api.getData().published, true)
    api.setValue('published', false)
    assert.strictEqual(api.getData().published, false)
  } finally {
    close()
    dom.window.close()
  }
})

test('setValue: writes through to img.src field', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "avatar": ".a@src" }
    </script>
    <template data-hcms-tpl="avatar">
      <label class="hcms-field" data-hcms-shape="scalar">
        <span data-hcms-label></span>
        <img data-hcms-field="avatar" src=""/>
      </label>
    </template>
    <img class="a" src="https://example.com/old.png"/>
  </body></html>`)
  open()
  try {
    api.setValue('avatar', 'https://example.com/new.png')
    assert.equal(document.querySelector('img.a').getAttribute('src'), 'https://example.com/new.png')
  } finally {
    close()
    dom.window.close()
  }
})
