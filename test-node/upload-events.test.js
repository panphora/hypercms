import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPage, reset } from './_helpers.js'
import { open, close } from '../src/hypercms.js'

const FIXTURE = `<!DOCTYPE html><html><head></head><body>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  { "hero": "img@src", "resume": ".resume@href" }
  </script>
  <div id="content">
    <img class="hero" src="">
    <a class="resume" data-hcms-component="file" href="">link</a>
  </div>
</body></html>`

function setup(uploader) {
  const dom = loadPage(FIXTURE)
  if (uploader !== undefined) {
    globalThis.window.hyperclay.uploadFileBasic = uploader
  }
  const content = document.getElementById('content')
  const changes = []
  open({ pageRoot: content, onChange: (data, info) => changes.push({ data, info }) })
  const formRoot = document.querySelector('[data-hcms-form-root]')
  return { dom, content, formRoot, changes }
}

function fileInput(formRoot, path) {
  return formRoot.querySelector(`[data-hcms-path="${path}"] input[type="file"][data-hcms-upload]`)
}

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

test('onUploadChange: reads res.uploads[0].url, writes img.src, applies to the page, fires onChange', async () => {
  let received = null
  const { dom, content, formRoot, changes } = setup(async (f) => {
    received = f
    return { msgType: 'ok', uploads: [{ name: f.name, nodeId: 'n1', url: '/u/cover.png' }], urls: ['/u/cover.png'] }
  })
  const input = fileInput(formRoot, 'hero')
  assert.ok(input, 'image picker exists')
  setFiles(input, [new window.File(['x'], 'cover.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  const img = formRoot.querySelector('img[data-hcms-field="hero"]')
  await flush(() => img.getAttribute('src') === '/u/cover.png')
  assert.equal(img.getAttribute('src'), '/u/cover.png', 'form img src updated')
  assert.equal(received && received.name, 'cover.png', 'the picked File was uploaded')
  assert.equal(content.querySelector('img.hero').getAttribute('src'), '/u/cover.png', 'page img committed')
  assert.ok(changes.some((c) => c.data.hero === '/u/cover.png'), 'onChange fired with the URL')

  close(); reset(dom)
})

test('onUploadChange: @file writes href + filename text and commits', async () => {
  const { dom, content, formRoot } = setup(async (f) => ({
    uploads: [{ name: f.name, url: '/uploads/resume.pdf' }],
  }))
  const input = fileInput(formRoot, 'resume')
  setFiles(input, [new window.File(['x'], 'resume.pdf', { type: 'application/pdf' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  const a = formRoot.querySelector('a[data-hcms-field="resume"]')
  await flush(() => a.getAttribute('href') === '/uploads/resume.pdf')
  assert.equal(a.getAttribute('href'), '/uploads/resume.pdf')
  assert.equal(a.textContent, 'resume.pdf', 'visible filename is the picked name')
  assert.equal(content.querySelector('a.resume').getAttribute('href'), '/uploads/resume.pdf', 'page committed')

  close(); reset(dom)
})

test('a file input never routes through onScalarChange (no C:\\fakepath leak)', async () => {
  const { dom, content, formRoot } = setup(async () => ({ uploads: [{ url: '/u/x.png' }] }))
  const input = fileInput(formRoot, 'hero')
  // The picker fires `input` in real browsers; its .value is the fake path. The
  // onInput guard must skip it so the fake path is never extracted/committed.
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(content.querySelector('img.hero').getAttribute('src'), '', 'no fake-path committed to the page')

  close(); reset(dom)
})

test('clear-upload: resets the bound leaf to empty and commits', async () => {
  const { dom, content, formRoot } = setup(async () => ({ uploads: [{ url: '/u/cover.png' }] }))
  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'cover.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  const img = formRoot.querySelector('img[data-hcms-field="hero"]')
  await flush(() => img.getAttribute('src') === '/u/cover.png')
  assert.equal(content.querySelector('img.hero').getAttribute('src'), '/u/cover.png')

  const clearBtn = formRoot.querySelector('[data-hcms-path="hero"] [data-hcms-action="clear-upload"]')
  assert.ok(clearBtn, 'clear button exists')
  clearBtn.dispatchEvent(new window.Event('click', { bubbles: true }))
  await flush(() => (img.getAttribute('src') || '') === '')
  assert.equal(img.getAttribute('src') || '', '', 'form img cleared')
  assert.equal(content.querySelector('img.hero').getAttribute('src') || '', '', 'page img cleared')

  close(); reset(dom)
})

test('closing the editor mid-upload aborts: no page mutation, no onChange after teardown', async () => {
  let resolveUpload
  const { dom, content, formRoot, changes } = setup(() => new Promise((r) => { resolveUpload = r }))
  content.querySelector('img.hero').setAttribute('src', '/orig.png')
  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'late.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true })) // onUploadChange now awaits the uploader
  await flush(() => typeof resolveUpload === 'function') // let it reach upload()

  close() // user abandons the edit before the upload resolves
  resolveUpload({ uploads: [{ url: '/u/late.png' }] })
  await new Promise((r) => setTimeout(r, 20))

  assert.equal(content.querySelector('img.hero').getAttribute('src'), '/orig.png', 'live page not mutated post-close')
  assert.ok(!changes.some((c) => c.data && c.data.hero === '/u/late.png'), 'no onChange fired after teardown')

  reset(dom)
})

test('onUploadChange: no uploader + no createObjectURL → no throw, no commit', async () => {
  // jsdom has no URL.createObjectURL, so the local-preview fallback yields no
  // URL; the handler must bail cleanly rather than throwing. (The real preview
  // path is covered in the browser tier.)
  const { dom, content, formRoot } = setup(undefined)
  delete globalThis.window.hyperclay.uploadFileBasic
  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'cover.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(content.querySelector('img.hero').getAttribute('src') || '', '', 'nothing committed without a URL')

  close(); reset(dom)
})
