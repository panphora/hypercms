// Google Fonts offered by the font control. Each request string is the exact
// axis fragment Google's CSS2 API accepts for that family (verified against
// fonts.googleapis.com on 2026-10-24), so a page never asks for a weight the
// family does not have.
export const FONT_GROUPS = ['sans', 'serif', 'display', 'mono']

const SANS = 'ui-sans-serif, system-ui, sans-serif'
const SERIF = 'ui-serif, Georgia, serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const FONTS = Object.freeze([
  { slug: 'inter', family: 'Inter', group: 'sans', fallback: SANS, request: 'ital,wght@0,100..900;1,100..900' },
  { slug: 'roboto', family: 'Roboto', group: 'sans', fallback: SANS, request: 'ital,wght@0,100..900;1,100..900' },
  { slug: 'open-sans', family: 'Open Sans', group: 'sans', fallback: SANS, request: 'ital,wght@0,300..800;1,300..800' },
  { slug: 'lato', family: 'Lato', group: 'sans', fallback: SANS, request: 'ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900' },
  { slug: 'montserrat', family: 'Montserrat', group: 'sans', fallback: SANS, request: 'ital,wght@0,100..900;1,100..900' },
  { slug: 'poppins', family: 'Poppins', group: 'sans', fallback: SANS, request: 'ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { slug: 'nunito', family: 'Nunito', group: 'sans', fallback: SANS, request: 'ital,wght@0,200..1000;1,200..1000' },
  { slug: 'raleway', family: 'Raleway', group: 'sans', fallback: SANS, request: 'ital,wght@0,100..900;1,100..900' },
  { slug: 'dm-sans', family: 'DM Sans', group: 'sans', fallback: SANS, request: 'ital,wght@0,100..1000;1,100..1000' },
  { slug: 'work-sans', family: 'Work Sans', group: 'sans', fallback: SANS, request: 'ital,wght@0,100..900;1,100..900' },
  { slug: 'source-sans-3', family: 'Source Sans 3', group: 'sans', fallback: SANS, request: 'ital,wght@0,200..900;1,200..900' },
  { slug: 'noto-sans', family: 'Noto Sans', group: 'sans', fallback: SANS, request: 'ital,wght@0,100..900;1,100..900' },
  { slug: 'plus-jakarta-sans', family: 'Plus Jakarta Sans', group: 'sans', fallback: SANS, request: 'ital,wght@0,200..800;1,200..800' },
  { slug: 'manrope', family: 'Manrope', group: 'sans', fallback: SANS, request: 'wght@200..800' },
  { slug: 'outfit', family: 'Outfit', group: 'sans', fallback: SANS, request: 'wght@100..900' },
  { slug: 'space-grotesk', family: 'Space Grotesk', group: 'sans', fallback: SANS, request: 'wght@300..700' },
  { slug: 'rubik', family: 'Rubik', group: 'sans', fallback: SANS, request: 'ital,wght@0,300..900;1,300..900' },
  { slug: 'ubuntu', family: 'Ubuntu', group: 'sans', fallback: SANS, request: 'ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700' },
  { slug: 'merriweather', family: 'Merriweather', group: 'serif', fallback: SERIF, request: 'ital,wght@0,300..900;1,300..900' },
  { slug: 'lora', family: 'Lora', group: 'serif', fallback: SERIF, request: 'ital,wght@0,400..700;1,400..700' },
  { slug: 'playfair-display', family: 'Playfair Display', group: 'serif', fallback: SERIF, request: 'ital,wght@0,400..900;1,400..900' },
  { slug: 'libre-baskerville', family: 'Libre Baskerville', group: 'serif', fallback: SERIF, request: 'ital,wght@0,400..700;1,400..700' },
  { slug: 'source-serif-4', family: 'Source Serif 4', group: 'serif', fallback: SERIF, request: 'ital,wght@0,200..900;1,200..900' },
  { slug: 'pt-serif', family: 'PT Serif', group: 'serif', fallback: SERIF, request: 'ital,wght@0,400;0,700;1,400;1,700' },
  { slug: 'noto-serif', family: 'Noto Serif', group: 'serif', fallback: SERIF, request: 'ital,wght@0,100..900;1,100..900' },
  { slug: 'crimson-pro', family: 'Crimson Pro', group: 'serif', fallback: SERIF, request: 'ital,wght@0,200..900;1,200..900' },
  { slug: 'eb-garamond', family: 'EB Garamond', group: 'serif', fallback: SERIF, request: 'ital,wght@0,400..800;1,400..800' },
  { slug: 'cormorant-garamond', family: 'Cormorant Garamond', group: 'serif', fallback: SERIF, request: 'ital,wght@0,300..700;1,300..700' },
  { slug: 'bebas-neue', family: 'Bebas Neue', group: 'display', fallback: SANS, request: 'wght@400' },
  { slug: 'oswald', family: 'Oswald', group: 'display', fallback: SANS, request: 'wght@200..700' },
  { slug: 'anton', family: 'Anton', group: 'display', fallback: SANS, request: 'wght@400' },
  { slug: 'abril-fatface', family: 'Abril Fatface', group: 'display', fallback: SERIF, request: 'wght@400' },
  { slug: 'lobster', family: 'Lobster', group: 'display', fallback: 'cursive', request: 'wght@400' },
  { slug: 'bungee', family: 'Bungee', group: 'display', fallback: SANS, request: 'wght@400' },
  { slug: 'roboto-mono', family: 'Roboto Mono', group: 'mono', fallback: MONO, request: 'ital,wght@0,100..700;1,100..700' },
  { slug: 'jetbrains-mono', family: 'JetBrains Mono', group: 'mono', fallback: MONO, request: 'ital,wght@0,100..800;1,100..800' },
  { slug: 'fira-code', family: 'Fira Code', group: 'mono', fallback: MONO, request: 'wght@300..700' },
  { slug: 'source-code-pro', family: 'Source Code Pro', group: 'mono', fallback: MONO, request: 'ital,wght@0,200..900;1,200..900' },
  { slug: 'ibm-plex-mono', family: 'IBM Plex Mono', group: 'mono', fallback: MONO, request: 'ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700' },
  { slug: 'space-mono', family: 'Space Mono', group: 'mono', fallback: MONO, request: 'ital,wght@0,400;0,700;1,400;1,700' },
])

// The system choice: no download, the platform's own UI face.
export const SYSTEM_FONT = Object.freeze({ slug: 'system', family: null, group: 'sans', fallback: 'system-ui, sans-serif' })

const BY_FAMILY = new Map(FONTS.map((f) => [f.family.toLowerCase(), f]))
const BY_SLUG = new Map(FONTS.map((f) => [f.slug, f]))

export function fontBySlug(slug) {
  return BY_SLUG.get(String(slug)) || null
}

// The CSS value a font field stores: the family quoted, then its fallback.
export function fontStack(font) {
  if (!font || font.slug === 'system') return SYSTEM_FONT.fallback
  return `'${font.family}', ${font.fallback}`
}

// Which catalog font a stored stack starts with, or null when the first family
// is not one of ours (an author's own stack, or the system choice).
export function fontFromStack(stack) {
  if (stack == null) return null
  const first = String(stack).split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  return BY_FAMILY.get(first.toLowerCase()) || null
}

// The one stylesheet URL for every catalog family in use: deduplicated, sorted
// by family, display=swap. Null when none of the stacks names a catalog font,
// which tells the caller to remove its link.
export function fontsHref(stacks) {
  const fonts = new Map()
  for (const stack of stacks || []) {
    const font = fontFromStack(stack)
    if (font) fonts.set(font.family, font)
  }
  if (fonts.size === 0) return null
  const families = [...fonts.values()]
    .sort((a, b) => a.family.localeCompare(b.family))
    .map((f) => `family=${f.family.replace(/ /g, '+')}:${f.request}`)
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}
