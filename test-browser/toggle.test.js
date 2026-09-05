import { expect, fixture, html } from '@open-wc/testing'
import { engine } from 'hyper-html-api'
import { open, close, isOpen } from '../src/hypercms.js'
import { maybeInjectToggle } from '../src/toggle.js'
import { makeMutationShim, waitFor } from './_helpers.js'

// Floating edit-mode toggle, end to end in a real browser: injection gating,
// then a real open/close round-trip through the actual shell.
const PAGE = `
  <script type="application/json" data-rules-name="cms" data-rules-version="1">{ "title": "h1.page-title" }</script>
  <h1 class="page-title">Hyperclay</h1>`

function realApi() {
  return { open, close, isOpen, hasRules: (doc) => !!engine.findRules(doc, 'cms') }
}

// The remembered view outlives a spec: it is one localStorage entry for the
// whole origin, and a spec that seeds it would otherwise decide what the next
// one's first press does.
function cleanupToggle() {
  localStorage.removeItem('hcms.view')
  document.querySelector('[data-hcms-toggle-host]')?.remove()
  document.getElementById('hcms-toggle-style')?.remove()
  document.querySelector('[data-hcms-toggle-style]')?.remove()
  document.getElementById('hcms-hostile-css')?.remove()
  document.getElementById('hcms-theme-css')?.remove()
  for (const prop of ['color', 'background', '--hcms-toggle-shift', '--hcms-toggle-offset', '--hcms-toggle-bg']) {
    document.body.style.removeProperty(prop)
  }
  document.documentElement.removeAttribute('data-bs-theme')
}

// getComputedStyle serializes an opaque background as rgb(); assert a floor,
// never an exact colour, so tuning the two surface constants does not break the
// suite. 4.3 rather than 4.5 on purpose: 4.36:1 is the measured floor for the
// #0a0a0a / #fafafa pair over 1516 inks, and a 4.5 floor is only reachable with
// a surface that is black in all but name.
const CONTRAST_FLOOR = 4.3

// A computed colour keeps its authored space (oklch, lab, color()), so the
// measuring instrument needs the same canvas conversion the production code
// uses. Computed here rather than imported, so a broken normalizeColor cannot
// make the fixture agree with itself.
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

function rgb(value) {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (!match) {
    probe.globalCompositeOperation = 'copy'
    probe.fillStyle = value
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  }
  const parts = match[1].split(/[\s,/]+/).filter(Boolean)
  const channels = parts.slice(0, 3).map(Number)
  const rawAlpha = parts[3]
  const a = rawAlpha === undefined
    ? 1
    : (rawAlpha.endsWith('%') ? Number(rawAlpha.slice(0, -1)) / 100 : Number(rawAlpha))
  return { r: channels[0], g: channels[1], b: channels[2], a }
}

function over(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  }
}

function contrastRatio(a, b) {
  const lum = (c) => {
    const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
  }
  const la = lum(a), lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe('hypercms floating toggle', () => {
  let page

  async function mountPage() {
    page = await fixture(html`<div id="toggle-page"></div>`)
    page.innerHTML = PAGE
    document.body.appendChild(page)
    window.hyperclay = window.hyperclay || {}
    window.hyperclay.Mutation = makeMutationShim(page)
  }

  // page is moved OUT of open-wc's fixture wrapper (document.body.appendChild),
  // so fixtureCleanup can't remove it — remove it here or its rules tag leaks
  // into the next spec's document-scoped findRules.
  afterEach(() => {
    try { close() } catch {}
    cleanupToggle()
    page?.remove()
    page = undefined
    delete window.__hyperclayEditMode
    if (window.hyperclay) delete window.hyperclay.Mutation
  })

  it('injects in edit mode on a rules page, with the strip attributes', async () => {
    await mountPage()
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const btn = document.querySelector('[data-hcms-toggle-host]')
    expect(btn).to.exist
    expect(btn.tagName.toLowerCase()).to.equal('hypercms-toggle')
    expect(btn.hasAttribute('no-save')).to.equal(true)
    expect(btn.hasAttribute('snapshot-remove')).to.equal(true)
    expect(btn.hasAttribute('save-ignore')).to.equal(true)
    expect(btn.hasAttribute('aria-label')).to.equal(false)
    // The inner button is the element that carries the accessible name, so it
    // is the one an aria-label would override (WCAG 2.5.3). Asserting only the
    // host would let the defect back in unnoticed.
    expect(btn.querySelector('.hcms-toggle__main').hasAttribute('aria-label')).to.equal(false)
    expect(btn.querySelector('button.hcms-toggle__main')).to.exist
    expect(document.getElementById('hcms-toggle-style')).to.exist
  })

  // Absence checks compare a boolean, never the element: a failing assertion
  // whose `actual` is a DOM node wedges the whole WTR session while it tries
  // to serialize the error (verified empirically — the session reports 0/0
  // and times out).
  it('does not inject when not in edit mode', async () => {
    await mountPage()
    maybeInjectToggle(realApi())
    expect(document.getElementById('hcms-toggle') === null).to.equal(true)
  })

  it('does not inject on a page without cms rules', async () => {
    page = await fixture(html`<div id="toggle-page-norules"><h1>Hi</h1></div>`)
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    expect(document.getElementById('hcms-toggle') === null).to.equal(true)
  })

  it('click opens the real shell, click again closes it', async () => {
    await mountPage()
    // A remembered view, so the press opens it. On a first run with both views
    // available the same press opens the menu instead, which is its own spec.
    localStorage.setItem('hcms.view', 'sidebar')
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const btn = document.querySelector('[data-hcms-toggle-host]')

    btn.click()
    await waitFor(() => isOpen())
    expect(isOpen()).to.equal(true)
    expect(document.body.classList.contains('hcms-open')).to.equal(true)
    expect(document.querySelector('[data-hcms-shell]')).to.exist

    btn.click()
    await waitFor(() => !isOpen())
    expect(isOpen()).to.equal(false)
    expect(document.querySelector('[data-hcms-shell]') === null).to.equal(true)
    expect(document.querySelector('[data-hcms-toggle-host]'), 'toggle survives close').to.exist
  })

  // The label swap is CSS keyed to an attribute the toggle writes, and only a
  // real cascade can tell the two halves are wired to each other. An inline
  // session is the case that separates it from the old body.hcms-open rule:
  // nothing lands on <body> at all.
  it('reads "Close editor" over an inline session, which sets no body class', async () => {
    await mountPage()
    localStorage.setItem('hcms.view', 'inline')
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const host = document.querySelector('[data-hcms-toggle-host]')
    const label = (name) => getComputedStyle(host.querySelector(`.hcms-toggle__${name}`)).display

    expect(label('open')).to.not.equal('none')
    expect(label('close')).to.equal('none')

    host.querySelector('.hcms-toggle__main').click()
    await waitFor(() => isOpen())
    expect(document.body.classList.contains('hcms-open')).to.equal(false)
    expect(label('open')).to.equal('none')
    expect(label('close')).to.not.equal('none')

    host.querySelector('.hcms-toggle__main').click()
    await waitFor(() => !isOpen())
    expect(label('open')).to.not.equal('none')
    expect(label('close')).to.equal('none')
  })

  it('keeps the label legible on every ink, including a page fighting itself', async () => {
    for (const [ink, ground] of [
      ['#2B241B', '#FAF7F2'],
      ['#ECEAF2', '#14161f'],
      ['#ffffff', '#ffffff'],
      ['#6b7280', '#ffffff'],
      ['oklch(0.929 0.013 255.508)', 'oklch(0.21 0.034 264.665)'],   // tailwind v4 dark
      ['lab(92 -1 -5)', '#14161f'],
      ['color(srgb 1 1 1)', '#ffffff'],
    ]) {
      await mountPage()
      document.body.style.color = ink
      document.body.style.background = ground
      window.__hyperclayEditMode = true
      maybeInjectToggle(realApi())
      const main = document.querySelector('[data-hcms-toggle-host] .hcms-toggle__main')
      const cs = getComputedStyle(main)
      const surface = rgb(cs.backgroundColor)
      const label = over(rgb(cs.color), surface)
      expect(surface.a, `${ink}: surface is opaque`).to.equal(1)
      expect(contrastRatio(label, surface), `${ink} on ${ground}`).to.be.greaterThan(CONTRAST_FLOOR)
      cleanupToggle()
      page?.remove()
    }
  })

  it('repicks the surface when the page changes theme after load', async () => {
    await mountPage()
    // The ink moves with the attribute, through a stylesheet, the way a real
    // theme toggler works. Writing document.body.style.color instead would
    // mutate the `style` attribute, which the old allowlist watched, and the
    // spec would stay green with that allowlist restored.
    const theme = document.createElement('style')
    theme.id = 'hcms-theme-css'
    theme.textContent = 'body { color: #2B241B; } html[data-bs-theme="dark"] body { color: #ECEAF2; }'
    document.head.appendChild(theme)
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const host = document.querySelector('[data-hcms-toggle-host]')
    await waitFor(() => host.getAttribute('data-hcms-surface') === 'light')
    // Drain the recompute injection schedules for the next frame. Without this
    // it lands after the flip below and reports the new ink, so the spec stays
    // green with no observer at all.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(host.getAttribute('data-hcms-surface')).to.equal('light')

    // data-bs-theme is Bootstrap 5.3's own toggler, and it is deliberately NOT
    // a name the observer could have been told about in advance.
    document.documentElement.setAttribute('data-bs-theme', 'dark')
    await waitFor(() => host.getAttribute('data-hcms-surface') === 'dark')
    expect(host.getAttribute('data-hcms-surface')).to.equal('dark')
    document.documentElement.removeAttribute('data-bs-theme')
  })

  it('composites a CSS Color 4 ink with alpha, rather than reading it as opaque', async () => {
    await mountPage()
    // Half-transparent red only reaches pickSurface through the canvas, and it
    // is the ink where compositing changes the answer: composited it reads 2.40
    // on the light surface against 1.90 on the dark, while treating it as
    // opaque picks dark. The opacity modifiers of every modern framework
    // compute to exactly this shape.
    document.body.style.color = 'color(srgb 1 0 0 / 0.5)'
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const host = document.querySelector('[data-hcms-toggle-host]')
    await waitFor(() => host.hasAttribute('data-hcms-surface'))
    expect(host.getAttribute('data-hcms-surface')).to.equal('light')
  })

  it('survives a page that resets everything with !important', async () => {
    await mountPage()
    const hostile = document.createElement('style')
    hostile.id = 'hcms-hostile-css'
    hostile.textContent = '@layer base { * { background: none !important; position: static !important; } button { font: inherit !important; } }'
    document.head.appendChild(hostile)
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const host = document.querySelector('[data-hcms-toggle-host]')
    const main = host.querySelector('.hcms-toggle__main')
    expect(getComputedStyle(host).position).to.equal('fixed')
    expect(rgb(getComputedStyle(main).backgroundColor).a).to.equal(1)
    // The arrow and the menu are the same kind of target: `background: none`
    // makes an arrow that is not there, and `position: static` drops the menu
    // into the flow and shoves the page.
    const arrow = host.querySelector('.hcms-toggle__arrow')
    const menu = host.querySelector('.hcms-toggle__menu')
    expect(rgb(getComputedStyle(arrow).backgroundColor).a).to.equal(1)
    expect(getComputedStyle(menu).position).to.equal('absolute')
    expect(getComputedStyle(menu).display).to.equal('none')
    arrow.click()
    expect(getComputedStyle(menu).display).to.equal('block')
  })

  it('composes the offset and the shift into one right edge', async () => {
    await mountPage()
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const host = document.querySelector('[data-hcms-toggle-host]')
    expect(getComputedStyle(host).right).to.equal('16px')
    document.body.style.setProperty('--hcms-toggle-shift', '380px')
    expect(getComputedStyle(host).right).to.equal('396px')
    document.body.style.setProperty('--hcms-toggle-offset', '64px')
    expect(getComputedStyle(host).right).to.equal('444px')
  })

  it('publishes the shift from the real theme when the shell opens', async () => {
    await mountPage()
    localStorage.setItem('hcms.view', 'sidebar')
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const host = document.querySelector('[data-hcms-toggle-host]')
    expect(getComputedStyle(host).right).to.equal('16px')
    document.querySelector('[data-hcms-toggle-host] .hcms-toggle__main').click()
    await waitFor(() => isOpen())
    const shell = document.querySelector('[data-hcms-shell]')
    // The theme arrives as a <link>, so the shell can be mounted before its
    // width is known. Wait for the stylesheet to have taken effect, not for the
    // element to exist, or this spec passes only when another spec ran first.
    await waitFor(() => Math.round(shell.getBoundingClientRect().width) > 0
      && getComputedStyle(host).right !== '16px')
    const shellWidth = Math.round(shell.getBoundingClientRect().width)
    // Whatever the shell is actually wide, the button clears it by the offset.
    expect(getComputedStyle(host).right).to.equal(`${shellWidth + 16}px`)
  })

  it('honours --hcms-toggle-bg over the picked surface', async () => {
    await mountPage()
    document.body.style.setProperty('--hcms-toggle-bg', 'rebeccapurple')
    window.__hyperclayEditMode = true
    maybeInjectToggle(realApi())
    const main = document.querySelector('[data-hcms-toggle-host] .hcms-toggle__main')
    expect(getComputedStyle(main).backgroundColor).to.equal('rgb(102, 51, 153)')
  })
})
