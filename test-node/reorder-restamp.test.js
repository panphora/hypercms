import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage } from './_helpers.js'
import { open, close, isOpen, api } from '../src/hypercms.js'

// v0.3 fix #10 (Should-fix): keyboard users can reorder via the move-up /
// move-down buttons each item ships with. The buttons are sr-only (visible
// on focus), commit the new order via _commit, and the buttons at array
// boundaries are disabled.
test('keyboard move-down reorders items + restamps indices', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
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
    const cards = document.querySelectorAll('[data-hcms-form-root] [data-hcms-card]')
    // Click move-down on the first card → A swaps with B → B,A,C
    const moveDown = cards[0].querySelector('[data-hcms-action="move-down"]')
    assert.ok(moveDown, 'move-down button rendered on default item template')
    moveDown.click()
    const pageNames = Array.from(document.querySelectorAll('.product .n')).map((e) => e.textContent)
    assert.deepEqual(pageNames, ['B', 'A', 'C'], 'page reflects keyboard reorder')
    // Indices restamped contiguously after the swap.
    const stampedPaths = Array.from(
      document.querySelectorAll('[data-hcms-form-root] [data-hcms-card]')
    ).map((c) => c.getAttribute('data-hcms-path'))
    assert.deepEqual(stampedPaths, ['products.0', 'products.1', 'products.2'])
  } finally {
    close()
    dom.window.close()
  }
})

test('keyboard move buttons disabled at array boundaries', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
    { "products": [".product", { "name": ".n" }] }
    </script>
    <div>
      <div class="product"><span class="n">A</span></div>
      <div class="product"><span class="n">B</span></div>
    </div>
  </body></html>`)
  open()
  try {
    const cards = document.querySelectorAll('[data-hcms-form-root] [data-hcms-card]')
    const firstUp = cards[0].querySelector('[data-hcms-action="move-up"]')
    const lastDown = cards[cards.length - 1].querySelector('[data-hcms-action="move-down"]')
    assert.equal(firstUp.hidden, true, 'move-up hidden on the first card')
    assert.equal(lastDown.hidden, true, 'move-down hidden on the last card')
  } finally {
    close()
    dom.window.close()
  }
})

// _commit (the path the sortable callback uses) must restamp sibling indices
// before extracting + applying. Otherwise reorder leaves indices stale and
// the engine commits the old order.
test('reorder + _commit restamps indices contiguously', () => {
  if (isOpen()) close()
  const dom = loadPage(`<!DOCTYPE html><html><body>
    <script data-rules-name="cms" data-rules-version="1" type="application/json">
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
