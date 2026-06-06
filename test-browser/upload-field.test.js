import { expect, fixture, html } from '@open-wc/testing'
import { open, close } from '../src/hypercms.js'
import { makeMutationShim, waitFor } from './_helpers.js'
// Load the vendored mirk runtime so these specs ALSO prove our data-hcms-* hooks
// stay inert against it (it keys off .mirk-*__input / .mirk-*__remove, which our
// picker/clear deliberately don't carry). If it ever double-handled, the upload
// behavior below would break.
import '../src/vendor/mirk.vendor.js'

const RULES = { hero: 'img@src', resume: '.resume@href' }
const PAGE = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">${JSON.stringify(RULES)}</script>
  <div class="content">
    <img class="hero" src="">
    <a class="resume" data-hcms-component="file" href="">link</a>
  </div>`

let page
let changes

async function setup(uploader, pageHtml = PAGE) {
  page = await fixture(html`<div id="upl-page"></div>`)
  page.innerHTML = pageHtml
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
  }
}

const pickerFor = (formRoot, path) =>
  formRoot.querySelector(`[data-hcms-path="${path}"] input[type="file"][data-hcms-upload]`)

function pick(input, name, type) {
  const dt = new DataTransfer()
  dt.items.add(new File(['payload'], name, { type }))
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('hypercms upload widgets', () => {
  let formRoot
  afterEach(() => teardown())

  it('uploads an image, writes the URL to img.src, commits to the page, fires hcms:change', async () => {
    formRoot = await setup(async (f) => ({
      uploads: [{ name: f.name, nodeId: 'n1', url: '/u/cover.png' }],
      urls: ['/u/cover.png'],
    }))
    const img = formRoot.querySelector('img[data-hcms-field="hero"]')
    pick(pickerFor(formRoot, 'hero'), 'cover.png', 'image/png')

    await waitFor(() => img.getAttribute('src') === '/u/cover.png')
    expect(img.getAttribute('src')).to.equal('/u/cover.png')
    expect(page.querySelector('img.hero').getAttribute('src')).to.equal('/u/cover.png')
    expect(changes.some((c) => c.data.hero === '/u/cover.png')).to.equal(true)
  })

  it('drives the empty/filled chrome via :has() (button hidden, thumb shown once filled)', async () => {
    formRoot = await setup(async () => ({ uploads: [{ url: '/u/cover.png' }] }))
    const field = formRoot.querySelector('.hcms-upload--image')
    const upBtn = field.querySelector('.mirk-image__upload')
    const thumb = field.querySelector('.mirk-image__thumb')
    // Wait for the theme <link> to apply (empty state hides the thumb).
    await waitFor(() => getComputedStyle(thumb).display === 'none')
    expect(getComputedStyle(upBtn).display).to.not.equal('none')

    pick(pickerFor(formRoot, 'hero'), 'cover.png', 'image/png')
    await waitFor(() => getComputedStyle(thumb).display !== 'none')
    expect(getComputedStyle(upBtn).display).to.equal('none')
    expect(getComputedStyle(thumb).display).to.not.equal('none')
  })

  it('falls back to a local object-URL preview when no host uploader is present', async () => {
    formRoot = await setup(undefined)
    const img = formRoot.querySelector('img[data-hcms-field="hero"]')
    pick(pickerFor(formRoot, 'hero'), 'cover.png', 'image/png')

    await waitFor(() => (img.getAttribute('src') || '').startsWith('blob:'))
    expect(img.getAttribute('src').startsWith('blob:')).to.equal(true)
    expect(page.querySelector('img.hero').getAttribute('src').startsWith('blob:')).to.equal(true)
  })

  it('uploads a file, setting a@href plus the visible filename', async () => {
    formRoot = await setup(async (f) => ({ uploads: [{ name: f.name, url: '/uploads/resume.pdf' }] }))
    const a = formRoot.querySelector('a[data-hcms-field="resume"]')
    pick(pickerFor(formRoot, 'resume'), 'resume.pdf', 'application/pdf')

    await waitFor(() => a.getAttribute('href') === '/uploads/resume.pdf')
    expect(a.getAttribute('href')).to.equal('/uploads/resume.pdf')
    expect(a.textContent).to.equal('resume.pdf')
    expect(page.querySelector('a.resume').getAttribute('href')).to.equal('/uploads/resume.pdf')

    // Filled filename uses the bright foreground (token --mirk-bevel-fg), not the
    // dim placeholder color — driven by :has([href]), since data-filled is never set.
    const shell = document.querySelector('[data-hcms-shell]')
    const probe = document.createElement('span')
    probe.style.color = 'var(--mirk-bevel-fg)'
    shell.appendChild(probe)
    await waitFor(() => getComputedStyle(probe).color && getComputedStyle(probe).color !== 'rgb(0, 0, 0)')
    expect(getComputedStyle(a).color).to.equal(getComputedStyle(probe).color)
    probe.remove()
  })

  it('clear-upload resets the leaf and the page, returning the empty chrome', async () => {
    formRoot = await setup(async () => ({ uploads: [{ url: '/u/cover.png' }] }))
    const img = formRoot.querySelector('img[data-hcms-field="hero"]')
    pick(pickerFor(formRoot, 'hero'), 'cover.png', 'image/png')
    await waitFor(() => img.getAttribute('src') === '/u/cover.png')

    const clearBtn = formRoot.querySelector('[data-hcms-path="hero"] [data-hcms-action="clear-upload"]')
    clearBtn.click()

    await waitFor(() => (img.getAttribute('src') || '') === '')
    expect(img.getAttribute('src') || '').to.equal('')
    expect(page.querySelector('img.hero').getAttribute('src') || '').to.equal('')
    const upBtn = formRoot.querySelector('.hcms-upload--image .mirk-image__upload')
    const thumb = formRoot.querySelector('.hcms-upload--image .mirk-image__thumb')
    await waitFor(() => getComputedStyle(thumb).display === 'none')
    expect(getComputedStyle(upBtn).display).to.not.equal('none')
  })
})

const CARD_RULES = { gallery: ['.item', { photo: 'img@src', caption: '.cap' }] }
const CARD_PAGE = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">${JSON.stringify(CARD_RULES)}</script>
  <div class="gallery">
    <div class="item"><img src=""><span class="cap">one</span></div>
    <div class="item"><img src=""><span class="cap">two</span></div>
  </div>`

describe('hypercms upload widgets inside object-array cards', () => {
  let formRoot
  afterEach(() => teardown())

  it('uploads into one card without touching its siblings or their page nodes', async () => {
    formRoot = await setup(async (f) => ({ uploads: [{ name: f.name, url: '/u/one.png' }] }), CARD_PAGE)
    const img0 = formRoot.querySelector('[data-hcms-path="gallery.0.photo"] img[data-hcms-field="photo"]')
    const img1 = formRoot.querySelector('[data-hcms-path="gallery.1.photo"] img[data-hcms-field="photo"]')
    pick(pickerFor(formRoot, 'gallery.0.photo'), 'one.png', 'image/png')

    await waitFor(() => img0.getAttribute('src') === '/u/one.png')
    expect(img1.getAttribute('src') || '').to.equal('')
    const pageImgs = page.querySelectorAll('.item img')
    expect(pageImgs[0].getAttribute('src')).to.equal('/u/one.png')
    expect(pageImgs[1].getAttribute('src') || '').to.equal('')
  })

  it('a freshly added card resolves @image and its picker wires up', async () => {
    formRoot = await setup(async (f) => ({ uploads: [{ name: f.name, url: '/u/new.png' }] }), CARD_PAGE)
    formRoot.querySelector('[data-hcms-path="gallery"] [data-hcms-action="add"]').click()
    await waitFor(() => formRoot.querySelectorAll('[data-hcms-card]').length === 3)
    const newImg = formRoot.querySelector('[data-hcms-path="gallery.2.photo"] img[data-hcms-field="photo"]')
    expect(newImg, 'new card has an @image widget').to.exist
    pick(pickerFor(formRoot, 'gallery.2.photo'), 'new.png', 'image/png')

    await waitFor(() => newImg.getAttribute('src') === '/u/new.png')
    expect(newImg.getAttribute('src')).to.equal('/u/new.png')
    expect(page.querySelectorAll('.item img')[2].getAttribute('src')).to.equal('/u/new.png')
  })
})
