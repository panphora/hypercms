import { expect, fixture, html } from '@open-wc/testing'
import { open, close } from '../src/hypercms.js'
import { undo } from '../../hyper-undo/src/index.js'

export { expect }

// A two-item object-array is enough to exercise focus, morph, add/remove and undo.
export const PAGE_HTML = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "products": [".product", { "name": ".product-name" }] }</script>
  <div id="products">
    <div class="product"><span class="product-name">P1</span></div>
    <div class="product"><span class="product-name">P2</span></div>
  </div>`

// hypercms requires window.hyperclay.Mutation (installObserver throws without it).
// This is a minimal but REAL MutationObserver double scoped to the page element,
// so the specs exercise the genuine observer -> refreshForm -> morphForm path.
// Scoping to the page (not document.body) keeps form-side morphs from feeding
// back into a refresh loop. The platform ships hyperclayjs's batched Mutation
// (covered by its own suite); hypercms only needs onAnyChange(opts, cb)->unsub.
export function makeMutationShim(target) {
  return {
    onAnyChange(_opts, cb) {
      const mo = new MutationObserver(() => cb())
      mo.observe(target, { childList: true, subtree: true, characterData: true, attributes: true })
      return () => mo.disconnect()
    },
    pause() {},
    resume() {},
  }
}

export async function setupCms() {
  const page = await fixture(html`<div id="page"></div>`)
  page.innerHTML = PAGE_HTML
  window.hyperclay = window.hyperclay || {}
  window.hyperclay.Mutation = makeMutationShim(page)
  window.hyperclay.undo = undo
  open({ pageRoot: page })
  const formRoot = document.querySelector('[data-hcms-form-root]')
  // Start recording AFTER open() so the shell mount isn't part of the history.
  undo.start({ scope: page, bindKeys: false, idleWindowMs: 50 })
  undo.clear() // guarantee an empty history per test (the undo singleton is shared)
  return { page, formRoot }
}

export function teardownCms() {
  try { undo.stop() } catch {}
  try { close() } catch {}
  if (window.hyperclay) {
    delete window.hyperclay.undo
    delete window.hyperclay.Mutation
  }
}

export const field = (formRoot, path) => formRoot.querySelector(`[data-hcms-path="${path}"] input`)
export const cardCount = (formRoot) => formRoot.querySelectorAll('[data-hcms-card]').length
export const productCount = (page) => page.querySelectorAll('.product').length
export const pageName = (page, i) => page.querySelectorAll('.product .product-name')[i]?.textContent

export const waitFor = async (pred, tries = 80, step = 10) => {
  for (let i = 0; i < tries; i++) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, step))
  }
  return pred()
}
