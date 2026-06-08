import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'
import { injectDefaults, injectComponents } from '../src/templates.js'
import { deriveFormRules } from '../src/form-rules.js'
import { JSDOM } from 'jsdom'

test('card fields recurse through the component seam: photo→img@src (image), link→plain @value', () => {
  const doc = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window.document
  const rules = { products: ['.product', { photo: 'img@src', link: 'a@href', name: '.n' }] }
  injectDefaults(doc)
  injectComponents(doc, rules)
  const formRules = deriveFormRules(rules, doc)
  const [, itemShape] = formRules.products
  assert.equal(itemShape.photo, 'img[data-hcms-field="photo"]@src') // image inferred in cards
  assert.equal(itemShape.link, 'input[data-hcms-field="link"]@value') // a@href stays a plain URL field
  assert.equal(itemShape.name, 'input[data-hcms-field="name"]@value')
})

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "products": [".product", { "photo": "img@src", "name": ".name" }] }
  </script>
  <div id="content">
    <div class="product"><img src=""><span class="name">A</span></div>
    <div class="product"><img src=""><span class="name">B</span></div>
  </div>
</body></html>`

function setFiles(input, files) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
}
async function flush(pred, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 4))
  }
  return pred()
}

test('uploading into one card updates only that card and its page product', async () => {
  const dom = loadPage(FIXTURE)
  globalThis.window.hyperclay.uploadFileBasic = async (f) => ({ uploads: [{ name: f.name, url: '/u/a.png' }] })
  const content = document.getElementById('content')
  open({ pageRoot: content })
  const formRoot = document.querySelector('[data-hcms-form-root]')

  const input0 = formRoot.querySelector('[data-hcms-path="products.0.photo"] input[type="file"][data-hcms-upload]')
  assert.ok(input0, 'card 0 photo picker exists')
  setFiles(input0, [new window.File(['x'], 'a.png', { type: 'image/png' })])
  input0.dispatchEvent(new window.Event('change', { bubbles: true }))

  const img0 = formRoot.querySelector('[data-hcms-path="products.0.photo"] img[data-hcms-field="photo"]')
  const img1 = formRoot.querySelector('[data-hcms-path="products.1.photo"] img[data-hcms-field="photo"]')
  await flush(() => img0.getAttribute('src') === '/u/a.png')
  assert.equal(img0.getAttribute('src'), '/u/a.png', 'card 0 form img updated')
  assert.equal(img1.getAttribute('src') || '', '', 'card 1 form img untouched')

  const pageImgs = content.querySelectorAll('.product img')
  assert.equal(pageImgs[0].getAttribute('src'), '/u/a.png', 'page product 0 committed')
  assert.equal(pageImgs[1].getAttribute('src') || '', '', 'page product 1 untouched')

  close()
  reset(dom)
})
