import { expect, fixture, html } from '@open-wc/testing'
import { open, close } from '../src/hypercms.js'
import { makeMutationShim, waitFor } from './_helpers.js'
// Load the vendored mirk runtime so these specs prove our data-hcms-* hooks stay
// inert against it (it keys off .mirk-*__input / .mirk-*__remove, which our
// picker deliberately doesn't carry), mirroring upload-field.test.js.
import '../src/vendor/mirk.vendor.js'

// Crop-on-upload seam: an @image field with data-hcms-crop opts into the host's
// window.hyperclay.quickcrop between the file pick and the upload. These specs
// drive that seam end to end against the real built form, stubbing quickcrop +
// uploadFileBasic the way upload-field.test.js stubs uploadFileBasic.

const RULES = { x: 'img.x@src' }
const pageWith = (crop) => `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">${JSON.stringify(RULES)}</script>
  <div class="content">
    <img class="x"${crop == null ? '' : ` data-hcms-crop="${crop}"`} src="">
  </div>`

let page
let changes

async function setup(uploader, crop = '1:1') {
  page = await fixture(html`<div id="crop-page"></div>`)
  page.innerHTML = pageWith(crop)
  window.hyperclay = window.hyperclay || {}
  window.hyperclay.Mutation = makeMutationShim(page)
  if (uploader === undefined) delete window.hyperclay.uploadFileBasic
  else window.hyperclay.uploadFileBasic = uploader
  changes = []
  open({ pageRoot: page, onChange: (data, info) => changes.push({ data, info }) })
  return document.querySelector('[data-hcms-form-root]')
}

function teardown() {
  try { close() } catch {}
  if (window.hyperclay) {
    delete window.hyperclay.Mutation
    delete window.hyperclay.uploadFileBasic
    // Restore/delete the crop stub so other test files are unaffected.
    delete window.hyperclay.quickcrop
  }
}

const pickerFor = (formRoot) =>
  formRoot.querySelector('[data-hcms-path="x"] input[type="file"][data-hcms-upload]')

function pick(input, name, type) {
  const dt = new DataTransfer()
  dt.items.add(new File(['payload'], name, { type }))
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('hypercms @image crop-on-upload', () => {
  let formRoot
  afterEach(() => teardown())

  it('crops a 1:1 image, uploads the cropped webp File, writes the served URL to img.src', async () => {
    let cropArgs = null
    let uploadedFile = null
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.quickcrop = async (file, opts) => {
      cropArgs = { file, opts }
      return { blob: new Blob(['x'], { type: 'image/webp' }), dataURL: 'data:image/webp;base64,AA==', width: 10, height: 10 }
    }
    formRoot = await setup(async (f) => {
      uploadedFile = f
      return { uploads: [{ name: f.name, url: '/u/cropped.png' }], urls: ['/u/cropped.png'] }
    })

    const img = formRoot.querySelector('[data-hcms-path="x"] img[data-hcms-field="x"]')
    pick(pickerFor(formRoot), 'cover.png', 'image/png')

    await waitFor(() => img.getAttribute('src') === '/u/cropped.png')
    // quickcrop received the 1:1 aspect and a File.
    expect(cropArgs).to.exist
    expect(cropArgs.opts.aspect).to.equal(1)
    expect(cropArgs.file instanceof File).to.equal(true)
    // uploadFileBasic received a File whose name ends '.webp' (blobToFile rewrote
    // the extension to match the encoded image/webp mime).
    expect(uploadedFile instanceof File).to.equal(true)
    expect(uploadedFile.name.endsWith('.webp')).to.equal(true)
    // The page img.src becomes the uploaded URL.
    expect(page.querySelector('img.x').getAttribute('src')).to.equal('/u/cropped.png')
    expect(img.getAttribute('src')).to.equal('/u/cropped.png')
    expect(changes.some((c) => c.data.x === '/u/cropped.png')).to.equal(true)
  })

  it('uses the crop dataURL as the live thumbnail when no host uploader is present', async () => {
    // The dataURL is the at-upload-time preview: with a host uploader the served
    // URL is written to the leaf, so the dataURL is visibly consumed only when
    // there is no uploader (its documented preview fallback path).
    let cropArgs = null
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.quickcrop = async (file, opts) => {
      cropArgs = { file, opts }
      return { blob: new Blob(['x'], { type: 'image/webp' }), dataURL: 'data:image/webp;base64,AA==', width: 10, height: 10 }
    }
    formRoot = await setup(undefined)

    const img = formRoot.querySelector('[data-hcms-path="x"] img[data-hcms-field="x"]')
    pick(pickerFor(formRoot), 'cover.png', 'image/png')

    await waitFor(() => img.getAttribute('src') === 'data:image/webp;base64,AA==')
    expect(cropArgs.opts.aspect).to.equal(1)
    expect(img.getAttribute('src')).to.equal('data:image/webp;base64,AA==')
    expect(page.querySelector('img.x').getAttribute('src')).to.equal('data:image/webp;base64,AA==')
  })

  it('cancel (quickcrop resolves null) aborts: no upload, page src unchanged, picker reset', async () => {
    let uploadCalled = false
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.quickcrop = async () => null
    formRoot = await setup(async (f) => { uploadCalled = true; return { uploads: [{ url: '/u/x.png' }] } })

    const img = formRoot.querySelector('[data-hcms-path="x"] img[data-hcms-field="x"]')
    const input = pickerFor(formRoot)
    pick(input, 'cover.png', 'image/png')

    // Let the async maybeCrop -> abort settle.
    await new Promise((r) => setTimeout(r, 80))
    expect(uploadCalled).to.equal(false)
    expect(img.getAttribute('src') || '').to.equal('')
    expect(page.querySelector('img.x').getAttribute('src') || '').to.equal('')
    expect(input.value).to.equal('')
  })

  it('crop failure (quickcrop rejects) surfaces an inline error and skips upload + commit', async () => {
    let uploadCalled = false
    const changeCountBefore = () => changes.length
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.quickcrop = async () => { throw new Error('boom') }
    formRoot = await setup(async (f) => { uploadCalled = true; return { uploads: [{ url: '/u/x.png' }] } })

    const field = formRoot.querySelector('[data-hcms-path="x"]')
    const img = field.querySelector('img[data-hcms-field="x"]')
    const before = changeCountBefore()
    pick(pickerFor(formRoot), 'cover.png', 'image/png')

    const errSlot = field.querySelector(':scope > .hcms-error')
    await waitFor(() => errSlot && errSlot.hidden === false)
    expect(errSlot.hidden).to.equal(false)
    expect(errSlot.textContent).to.contain('boom')
    expect(uploadCalled).to.equal(false)
    expect(img.getAttribute('src') || '').to.equal('')
    expect(changes.length).to.equal(before)
  })

  it('no data-hcms-crop attr: quickcrop is NOT called, the raw file uploads unchanged', async () => {
    let cropCalled = false
    let uploadedFile = null
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.quickcrop = async () => { cropCalled = true; return null }
    formRoot = await setup(async (f) => {
      uploadedFile = f
      return { uploads: [{ name: f.name, url: '/u/raw.png' }] }
    }, null)

    const img = formRoot.querySelector('[data-hcms-path="x"] img[data-hcms-field="x"]')
    pick(pickerFor(formRoot), 'cover.png', 'image/png')

    await waitFor(() => img.getAttribute('src') === '/u/raw.png')
    expect(cropCalled).to.equal(false)
    // The original, uncropped file uploads: name + type unchanged (no webp rewrite).
    expect(uploadedFile.name).to.equal('cover.png')
    expect(uploadedFile.type).to.equal('image/png')
    expect(page.querySelector('img.x').getAttribute('src')).to.equal('/u/raw.png')
  })

  it('data-hcms-crop="free" calls quickcrop with aspect null (freeform)', async () => {
    let cropArgs = null
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.quickcrop = async (file, opts) => {
      cropArgs = { file, opts }
      return { blob: new Blob(['x'], { type: 'image/webp' }), dataURL: 'data:image/webp;base64,AA==' }
    }
    formRoot = await setup(async (f) => ({ uploads: [{ name: f.name, url: '/u/free.png' }] }), 'free')

    const img = formRoot.querySelector('[data-hcms-path="x"] img[data-hcms-field="x"]')
    pick(pickerFor(formRoot), 'cover.png', 'image/png')

    await waitFor(() => img.getAttribute('src') === '/u/free.png')
    expect(cropArgs).to.exist
    expect(cropArgs.opts.aspect).to.equal(null)
  })
})
