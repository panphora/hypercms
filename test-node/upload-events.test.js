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

test('onUploadChange: no client at all → embeds the file as a data: URL', async () => {
  // A bare HTML file with the CMS dropped in. There is nowhere to put a file, so
  // embedding is the right answer, and it must be data: rather than blob:, which
  // is dead the moment the page reloads.
  const { dom, content, formRoot } = setup(undefined)
  delete globalThis.window.hyperclay.uploadFileBasic
  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'cover.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  const img = content.querySelector('img.hero')
  await flush(() => (img.getAttribute('src') || '').startsWith('data:'))
  assert.match(img.getAttribute('src'), /^data:image\/png;base64,/, 'embedded as a data: URL')

  close(); reset(dom)
})

test('onUploadChange: a refused upload writes NOTHING and says why', async () => {
  // The whole point of the capability: a file the host refused for size must not
  // land in the document as a data: URL. That is the disease, not the fallback.
  const { dom, content, formRoot } = setup(() => {
    const err = new Error('That file is larger than this host accepts')
    err.status = 413
    err.response = JSON.stringify({ code: 'too-large', msg: 'That file is larger than this host accepts' })
    return Promise.reject(err)
  })
  content.querySelector('img.hero').setAttribute('src', '/orig.png')
  const fieldEl = formRoot.querySelector('[data-hcms-path="hero"]')
  const slot = fieldEl.querySelector(':scope > .hcms-error')

  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'huge.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  await flush(() => slot.hidden === false)
  assert.equal(slot.hidden, false, 'the refusal is shown')
  assert.match(slot.textContent, /larger than this host accepts/)
  assert.equal(slot.classList.contains('hcms-error--info'), false, 'a refusal is not an informational note')
  assert.equal(content.querySelector('img.hero').getAttribute('src'), '/orig.png', 'the page keeps the picture it had')

  close(); reset(dom)
})

test('onUploadChange: payment-required embeds AND explains', async () => {
  const { dom, content, formRoot } = setup(() => {
    const err = new Error('Uploads need a paid plan')
    err.status = 402
    err.response = JSON.stringify({ code: 'payment-required', msg: 'Uploads need a paid plan' })
    return Promise.reject(err)
  })
  const fieldEl = formRoot.querySelector('[data-hcms-path="hero"]')
  const slot = fieldEl.querySelector(':scope > .hcms-error')

  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'cover.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  const img = content.querySelector('img.hero')
  await flush(() => (img.getAttribute('src') || '').startsWith('data:'))
  assert.match(img.getAttribute('src'), /^data:image\/png;base64,/, 'the file still lands, in the page')
  assert.equal(slot.hidden, false, 'and the reason is on screen')
  assert.match(slot.textContent, /stored in the page/)
  assert.equal(slot.classList.contains('hcms-error--info'), true, 'shown as a note, not a failure')

  close(); reset(dom)
})

test('onUploadChange: an unannounced host embeds silently', async () => {
  // clay.upload answers `unsupported` rather than rejecting: the host does not
  // store files, which is not a failure and gets no error slot.
  const { dom, content, formRoot } = setup(undefined)
  delete globalThis.window.hyperclay.uploadFileBasic
  globalThis.window.clay = {
    upload: async () => ({ ok: false, msg: 'This host does not store uploaded files', msgType: 'skipped', code: 'unsupported', uploads: [] }),
  }
  const fieldEl = formRoot.querySelector('[data-hcms-path="hero"]')
  const slot = fieldEl.querySelector(':scope > .hcms-error')

  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'cover.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  const img = content.querySelector('img.hero')
  await flush(() => (img.getAttribute('src') || '').startsWith('data:'))
  assert.equal(slot.hidden, true, 'nothing to tell the person')

  delete globalThis.window.clay
  close(); reset(dom)
})

test('onUploadChange: progress drives the field attribute, and it is cleared after', async () => {
  let report
  let done
  const { dom, formRoot } = setup((f, opts) => new Promise((resolve) => {
    report = (percent) => opts.onProgress(percent)
    done = () => resolve({ uploads: [{ name: f.name, url: '/u/cover.png' }] })
  }))
  const fieldEl = formRoot.querySelector('[data-hcms-path="hero"]')
  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'cover.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  await flush(() => typeof report === 'function')
  report(40)
  assert.equal(fieldEl.hasAttribute('data-hcms-uploading'), true, 'the field is marked in flight')
  assert.equal(fieldEl.style.getPropertyValue('--hcms-upload-progress'), '40%', 'percent reaches the chrome')

  done()
  const img = formRoot.querySelector('img[data-hcms-field="hero"]')
  await flush(() => img.getAttribute('src') === '/u/cover.png')
  assert.equal(fieldEl.hasAttribute('data-hcms-uploading'), false, 'cleared when the upload settles')

  close(); reset(dom)
})

test('closing the editor aborts the in-flight upload', async () => {
  // Against clay.upload, which takes a signal. The legacy uploader has no
  // cancellation at all, so there the same close() only discards the result;
  // that outcome is covered by the mid-upload test above.
  let sawAbort = false
  const { dom, formRoot } = setup(undefined)
  delete globalThis.window.hyperclay.uploadFileBasic
  globalThis.window.clay = {
    upload: (f, opts) => new Promise((resolve) => {
      opts.signal?.addEventListener('abort', () => { sawAbort = true })
      setTimeout(() => resolve({ ok: true, uploads: [{ url: '/u/late.png' }] }), 50)
    }),
  }
  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'late.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  await flush(() => formRoot.querySelector('[data-hcms-path="hero"]').hasAttribute('data-hcms-uploading'))

  close()
  assert.equal(sawAbort, true, 'the request is torn down, not just ignored')

  delete globalThis.window.clay
  reset(dom)
})

test('onUploadChange: a fresh pick clears a stale inline error before running', async () => {
  const { dom, formRoot } = setup(async (f) => ({
    uploads: [{ name: f.name, nodeId: 'n1', url: '/u/new.png' }],
  }))
  const fieldEl = formRoot.querySelector('[data-hcms-path="hero"]')
  const slot = fieldEl.querySelector(':scope > .hcms-error')
  slot.textContent = 'quickcrop: already open'
  slot.hidden = false

  const input = fileInput(formRoot, 'hero')
  setFiles(input, [new window.File(['x'], 'next.png', { type: 'image/png' })])
  input.dispatchEvent(new window.Event('change', { bubbles: true }))

  await flush(() => slot.hidden)
  assert.equal(slot.hidden, true, 'stale error cleared by the new attempt')
  assert.equal(slot.textContent, '', 'stale message wiped')

  close(); reset(dom)
})
