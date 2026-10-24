import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { COLORS } from '../src/catalogs/colors.js'
import { fontBySlug, fontStack } from '../src/catalogs/fonts.js'
import { loadPage, reset } from './_helpers.js'
import { open, close, isOpen } from '../src/hypercms.js'

const SKY_600 = COLORS.find((c) => c.id === 'sky-600').value
const LORA = fontStack(fontBySlug('lora'))

const PAGE = `<!DOCTYPE html>
<html lang="en" style="--color-accent: #0284c7; --color-bg: #f8fafc; --font-heading: 'Playfair Display', ui-serif, Georgia, serif; --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif">
<head>
  <script data-rules-name="cms" data-rules-version="1" type="application/json">
  {
    "theme": {
      "accent": "html@--color-accent",
      "background": "html@--color-bg",
      "heading": "html@--font-heading",
      "body": "html@--font-body"
    },
    "hero": { "title": ".hero h1", "intro": ".hero p" },
    "features": {
      "layout": "#features@data-layout",
      "cardStyle": "#features@data-card-style",
      "items": ["#features .card", { "title": "h3", "text": "p" }]
    }
  }
  </script>
</head>
<body>
<div class="hero">
  <h1>A page that dresses itself</h1>
  <p>Pick a color, a typeface and a layout.</p>
</div>
<section id="features" data-layout="3" data-card-style="raised"
  data-hcms-component:data-layout="variant"
  data-hcms-options:data-layout="1:cols-1 2:cols-2 3:cols-3"
  data-hcms-component:data-card-style="variant"
  data-hcms-options:data-card-style="flat:card-flat raised:card-raised">
  <div class="card"><h3>One property each</h3><p>Colors and fonts write one custom property.</p></div>
  <div class="card"><h3>Layout in your CSS</h3><p>A variant choice writes only the attribute.</p></div>
</section>
</body></html>`

const click = (doc, el) => el.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }))
const change = (doc, el) => el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))

test('a themed page saves with its theme intact and no editor chrome', () => {
  if (isOpen()) close()
  const dom = loadPage(PAGE)
  const doc = dom.window.document
  open()
  try {
    const color = doc.querySelector('.hcms-color[data-hcms-path="theme.accent"]')
    assert.ok(color, 'theme.accent color control is mounted in the sidebar')
    click(doc, color.querySelector('.hcms-color-current'))
    const swatch = Array.from(color.querySelectorAll('.hcms-color-swatch')).find(
      (b) => b.getAttribute('data-hcms-color') === SKY_600
    )
    assert.ok(swatch, 'sky-600 swatch is offered')
    click(doc, swatch)
    assert.equal(doc.documentElement.style.getPropertyValue('--color-accent').trim(), SKY_600)

    const fontControl = doc.querySelector('.hcms-font[data-hcms-path="theme.heading"]')
    assert.ok(fontControl, 'theme.heading font control is mounted in the sidebar')
    const lora = Array.from(fontControl.querySelectorAll('.hcms-font-option')).find(
      (b) => b.getAttribute('data-hcms-font') === LORA
    )
    assert.ok(lora, 'the Lora stack is offered')
    click(doc, lora)
    assert.equal(doc.documentElement.style.getPropertyValue('--font-heading').trim(), LORA)

    const radio = doc.querySelector('[data-hcms-path="features.layout"] input[type="radio"][value="2"]')
    assert.ok(radio, 'the columns-2 variant radio is mounted')
    click(doc, radio)
    change(doc, radio)
    assert.equal(doc.querySelector('#features').getAttribute('data-layout'), '2')
  } finally {
    close()
  }

  const saved = doc.documentElement.outerHTML
  const roundTrip = new JSDOM(`<!DOCTYPE html>${saved}`)
  const out = roundTrip.window.document
  for (const script of Array.from(out.querySelectorAll('script'))) script.remove()

  const rootStyle = out.documentElement.getAttribute('style') || ''
  assert.match(rootStyle, /--color-accent:\s*oklch\(/, 'accent is a Tailwind oklch value')
  assert.match(rootStyle, /--color-bg:\s*#f8fafc/, 'background survives')
  assert.match(rootStyle, /--font-body:\s*'Inter'/, 'body font survives')
  assert.match(rootStyle, /--font-heading:\s*'Lora'/, 'heading holds the picked font')

  const features = out.querySelector('#features')
  assert.equal(features.getAttribute('data-layout'), '2')
  assert.equal(features.getAttribute('data-card-style'), 'raised')

  const links = out.querySelectorAll('link[data-hcms-fonts]')
  assert.equal(links.length, 1, 'exactly one managed fonts link')
  const href = links[0].getAttribute('href')
  assert.match(href, /Lora/)
  assert.match(href, /Inter/)
  assert.doesNotMatch(href, /Playfair/)

  for (const selector of [
    '[data-hcms-shell]',
    '[data-hcms-form-root]',
    'hypercms-inline',
    'link[data-hcms-font-preview]',
    '#hcms-toggle',
    '.hcms-color-panel',
  ]) {
    assert.equal(out.querySelector(selector), null, `no editor chrome: ${selector}`)
  }

  reset(dom)
  reset(roundTrip)
})
