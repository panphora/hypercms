import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PALETTE_SOURCE,
  SHADES,
  HUES,
  COLORS,
  FONT_GROUPS,
  FONTS,
  fontBySlug,
  fontStack,
  fontFromStack,
  fontsHref,
} from '../src/catalogs/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

test('COLORS is the full 26-hue x 11-shade Tailwind grid', () => {
  assert.equal(HUES.length, 26)
  assert.equal(COLORS.length, 286)
  for (const hue of ['mauve', 'olive', 'mist', 'taupe']) {
    assert.ok(HUES.includes(hue), `expected hue ${hue}`)
  }
  const ids = new Set()
  for (const color of COLORS) {
    assert.ok(!ids.has(color.id), `duplicate id ${color.id}`)
    ids.add(color.id)
  }
  for (const hue of HUES) {
    for (const shade of SHADES) {
      const color = COLORS.find((c) => c.id === `${hue}-${shade}`)
      assert.ok(color, `missing ${hue}-${shade}`)
      assert.equal(color.hue, hue)
      assert.equal(color.shade, shade)
      assert.ok(color.value.startsWith('oklch('), `${color.id} value is an oklch color`)
    }
  }
  assert.ok(!ids.has('black'))
  assert.ok(!ids.has('white'))
})

test('FONTS is 40 unique families grouped by kind', () => {
  assert.equal(FONTS.length, 40)
  assert.equal(new Set(FONTS.map((f) => f.slug)).size, 40)
  assert.equal(new Set(FONTS.map((f) => f.family)).size, 40)
  for (const font of FONTS) {
    assert.ok(FONT_GROUPS.includes(font.group), `${font.slug} group is a known group`)
  }
  const counts = {}
  for (const group of FONT_GROUPS) counts[group] = FONTS.filter((f) => f.group === group).length
  assert.deepEqual(counts, { sans: 18, serif: 10, display: 6, mono: 6 })
})

test('fontStack quotes the family and appends its fallback', () => {
  assert.equal(fontStack(fontBySlug('inter')), "'Inter', ui-sans-serif, system-ui, sans-serif")
})

test('fontFromStack reads the catalog font from a stored stack', () => {
  assert.equal(fontFromStack("'Playfair Display', ui-serif, Georgia, serif").slug, 'playfair-display')
  assert.equal(fontFromStack('"Inter", sans-serif').slug, 'inter')
  assert.equal(fontFromStack('Georgia, serif'), null)
  assert.equal(fontFromStack(null), null)
})

test('fontsHref builds one deduplicated, sorted stylesheet URL', () => {
  assert.equal(
    fontsHref(["'Lora', ui-serif", "'Inter', ui-sans-serif", "'Inter', x", 'Georgia']),
    'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&family=Lora:ital,wght@0,400..700;1,400..700&display=swap'
  )
  assert.equal(fontsHref(['Georgia, serif']), null)
  assert.equal(fontsHref([]), null)
  const href = fontsHref(["'Playfair Display', ui-serif"])
  assert.ok(href.includes('family=Playfair+Display:ital,wght@0,400..900;1,400..900'), href)
})

test('the palette file is generated, not hand-edited', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'catalogs', 'colors.js'), 'utf8')
  const firstLine = source.split('\n')[0]
  assert.ok(firstLine.includes('scripts/build-palette.js'), firstLine)
  assert.equal(PALETTE_SOURCE, 'tailwindcss@4.3.3')
})
