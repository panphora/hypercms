import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// _commit (the path the sortable callback uses) must restamp sibling indices
// before extracting + applying. Otherwise reorder leaves indices stale and
// the engine commits the old order.
test('reorder + _commit restamps indices contiguously', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script id="hyper-html-api" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div>
      <div class="product"><span class="n">A</span></div>
      <div class="product"><span class="n">B</span></div>
      <div class="product"><span class="n">C</span></div>
    </div>
  </body></html>`)
  open()
  try {
    const slot = document.querySelector('[data-hcms-form-root] .hcms-array-items')
    const cards = Array.from(slot.querySelectorAll(':scope > [data-hcms-card]'))
    // Manually reorder: move first to last (A,B,C → B,C,A)
    slot.appendChild(cards[0])
    api._commit()
    const newOrder = Array.from(slot.querySelectorAll(':scope > [data-hcms-card]'))
      .map((c) => c.getAttribute('data-hcms-path'))
    assert.deepEqual(newOrder, ['products.0', 'products.1', 'products.2'], 'indices restamped 0..2')
    const data = api.getData()
    assert.deepEqual(data.products.map((p) => p.name), ['B', 'C', 'A'])
    // Page also reflects new order
    const pageNames = Array.from(document.querySelectorAll('.product .n')).map((e) => e.textContent)
    assert.deepEqual(pageNames, ['B', 'C', 'A'])
  } finally {
    close()
    dom.window.close()
  }
})
