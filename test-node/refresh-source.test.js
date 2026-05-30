import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// open() stores the resolved rules source on ctx; refresh re-resolves against
// it. An object source is reused verbatim; a token source is re-looked-up so a
// livesync-swapped tag is picked up.

test('refresh after a literal-source open reuses the literal rules', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head></head><body>
    <h1 class="title">Hello</h1>
    <p class="other">X</p>
  </body></html>`)
  open({ rules: { title: '.title' } })
  try {
    // Inject a cms-token tag with DIFFERENT rules after open. A token-source
    // refresh would re-resolve to it; a literal-source refresh must ignore it.
    const tag = document.createElement('script')
    tag.setAttribute('data-rules-name', 'cms')
    tag.setAttribute('data-rules-version', '1')
    tag.type = 'application/json'
    tag.textContent = '{ "other": ".other" }'
    document.head.appendChild(tag)
    api.refresh()
    assert.ok(document.querySelector('[data-hcms-path="title"]'), 'title field survives refresh')
    assert.equal(document.querySelector('[data-hcms-path="other"]'), null, 'cms tag ignored')
  } finally {
    close()
    dom.window.close()
  }
})

test('refresh after a token-source open re-resolves by token', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><head>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">{ "title": ".title" }</script>
  </head><body>
    <h1 class="title">Hello</h1>
    <p class="extra">E</p>
  </body></html>`)
  open()
  try {
    assert.equal(document.querySelector('[data-hcms-path="extra"]'), null)
    // Swap the tag body (as livesync would) and refresh; the new field appears.
    const tag = document.querySelector('script[data-rules-name~="cms"]')
    tag.textContent = JSON.stringify({ title: '.title', extra: '.extra' })
    api.refresh()
    assert.ok(document.querySelector('[data-hcms-path="extra"]'), 'extra field picked up')
  } finally {
    close()
    dom.window.close()
  }
})
