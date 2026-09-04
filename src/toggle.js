// Floating bottom-right button that toggles the CMS open/closed, so a page
// owner can reopen the CMS after closing it (the shell's X is the only other
// affordance, and nothing reopens it). Injected at page load only when the
// visitor is in edit mode AND the page actually has cms rules, so regular
// visitors and rules-less pages (hypercms rides in broad presets) never see it.
// Runtime-only chrome: no-save + snapshot-remove keep it out of every save and
// snapshot (a static no-save element written into the file would be stripped
// from disk on the first save), save-ignore keeps it out of autosave/undo,
// mirroring the shell's own attributes.
//
// The control is a <hypercms-toggle> host wrapping a real <button>. The host is
// an unregistered custom element on purpose: a host page's `button { ... }`
// reset cannot reach it, and that reset is the common way an injected control
// gets mangled. Only the structural facts that must survive a hostile
// `* { ... !important }` reset are pinned inline with !important; each reads a
// public custom property, so overriding still works. Everything cosmetic is a
// normal declaration selected by [data-hcms-toggle-host], which an author's own
// #hcms-toggle rule outranks on specificity.

const TOGGLE_ID = 'hcms-toggle'
const HOST_ATTR = 'data-hcms-toggle-host'
const STYLE_ID = 'hcms-toggle-style'
const STYLE_ATTR = 'data-hcms-toggle-style'

// The pill's surface is opaque and neutral, picked at inject time from the two
// values below by whichever has more contrast against the page's own ink. It is
// not a tint of currentColor: the button floats over a backdrop it cannot see,
// and a 10% tint over a dark hero measures 1.3:1. Opaque removes the backdrop
// from the question entirely. Measured floor for this pair is 4.36:1 across
// 1516 inks; a 4.5:1 floor needs #030303, which is black in all but name.
const SURFACE_LIGHT = '#fafafa'
const SURFACE_DARK = '#0a0a0a'

export const TOGGLE_STYLE = `
[${HOST_ATTR}] {
  all: unset;
  box-sizing: border-box;
  display: var(--hcms-toggle-display, inline-flex);
  --hcms-toggle-_surface: ${SURFACE_LIGHT};
}
[${HOST_ATTR}][data-hcms-surface="dark"] {
  --hcms-toggle-_surface: ${SURFACE_DARK};
}
[${HOST_ATTR}] .hcms-toggle__main {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  min-height: 40px;
  font-family: inherit;
  font-weight: 500;
  line-height: 1;
  font-size: clamp(12px, 0.85em, 15px);
  color: var(--hcms-toggle-color, currentColor);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 10px 28px -12px rgba(0, 0, 0, .35);
}
[${HOST_ATTR}] .hcms-toggle__main:hover {
  border-color: color-mix(in srgb, currentColor 45%, transparent);
  box-shadow: 0 12px 32px -12px rgba(0, 0, 0, .45);
}
[${HOST_ATTR}] .hcms-toggle__main:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -5px;
}
[${HOST_ATTR}] .hcms-toggle__close { display: none; }
body.hcms-open [${HOST_ATTR}] .hcms-toggle__open { display: none; }
body.hcms-open [${HOST_ATTR}] .hcms-toggle__close { display: inline; }
@media (pointer: coarse) {
  [${HOST_ATTR}] .hcms-toggle__main { min-height: 44px; }
}
`

// Mirrors hyperclayjs core/isAdminOfCurrentResource.js: an explicit
// ?editmode=true|false param wins, then the window.__hyperclayEditMode global
// (standalone opt-in), then the platform's isAdminOfCurrentResource cookie.
// Replicated here rather than read off window.hyperclay because the edit-mode
// module isn't part of the cms preset, so the global isn't reliably present.
export function detectEditMode({ search = '', cookie = '', forced = null } = {}) {
  const str = typeof search === 'string' ? search : ''
  const qIndex = str.indexOf('?')
  const query = qIndex === -1 ? str : str.slice(qIndex + 1)
  const param = new URLSearchParams(query).get('editmode')
  if (param) return param === 'true'
  if (forced != null) return Boolean(forced)
  return /(?:^|;\s*)isAdminOfCurrentResource=[^;]/.test(cookie)
}

// A computed `color` is not always an rgb() string: CSS Color 4 keeps the
// authored space, so Chrome returns oklch(), lab() and color() as written, and
// Tailwind v4's whole palette is oklch. rgb()/rgba() is still what the great
// majority of pages compute to, so parse that directly and let the canvas
// handle only the rest.
const colorContexts = new WeakMap()

function readCanvasColor(ctx, value) {
  try {
    // 'copy' replaces the pixel instead of blending, so alpha survives.
    ctx.globalCompositeOperation = 'copy'
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  } catch (_) {
    return null
  }
}

// Per document, not per module: the context retains its canvas, which retains
// its ownerDocument, and hypercms can be driven into a preview iframe.
function colorContextFor(doc) {
  if (colorContexts.has(doc)) return colorContexts.get(doc)
  let ctx = null
  try {
    const canvas = doc.createElement('canvas')
    canvas.width = canvas.height = 1
    ctx = canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null
    // A browser that fuzzes canvas readback (Firefox's resistFingerprinting)
    // answers the same colour for everything, which would send every page to
    // one surface at about 1:1. Round-trip a known value once and refuse the
    // whole path if it does not come back exactly.
    if (ctx) {
      const probe = readCanvasColor(ctx, 'rgb(1, 2, 3)')
      if (!probe || probe.r !== 1 || probe.g !== 2 || probe.b !== 3 || probe.a !== 1) ctx = null
    }
  } catch (_) {
    ctx = null
  }
  colorContexts.set(doc, ctx)
  return ctx
}

function normalizeColor(value, doc) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return null
  const direct = parseRgb(raw)
  if (direct) return direct
  const win = doc && doc.defaultView
  // CSS.supports is the parse check AND the capability probe: jsdom has neither
  // it nor a 2d context, so this short-circuits without jsdom logging a "not
  // implemented" error for getContext. It matters because a rejected fillStyle
  // silently keeps its previous value, so an unguarded read would report the
  // last ink this page measured.
  if (!win || !win.CSS || typeof win.CSS.supports !== 'function') return null
  if (!win.CSS.supports('color', raw)) return null
  const ctx = colorContextFor(doc)
  return ctx ? readCanvasColor(ctx, raw) : null
}

export function parseRgb(value) {
  const match = /rgba?\(([^)]+)\)/.exec(String(value == null ? '' : value))
  if (!match) return null
  const parts = match[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const channels = parts.slice(0, 3).map(Number)
  if (channels.some(Number.isNaN)) return null
  const rawAlpha = parts[3]
  const alpha = rawAlpha === undefined
    ? 1
    : (rawAlpha.endsWith('%') ? Number(rawAlpha.slice(0, -1)) / 100 : Number(rawAlpha))
  return {
    r: channels[0], g: channels[1], b: channels[2],
    a: Number.isNaN(alpha) ? 1 : alpha,
  }
}

function relativeLuminance({ r, g, b }) {
  const channel = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const DARK_RGB = { r: 10, g: 10, b: 10 }
const LIGHT_RGB = { r: 250, g: 250, b: 250 }

// Source-over composite, because the label is painted ON the surface: a
// translucent ink's rendered colour depends on which surface it lands on, so
// each candidate has to be judged against its own composite.
function over(fg, bg) {
  const a = fg.a == null ? 1 : fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  }
}

// Which of the two surfaces the page's ink reads better on. Ties and unknown
// inks go light, which is the quieter result on the overwhelmingly common
// dark-ink-on-light-ground page. The 4.36:1 floor holds for opaque ink only:
// nothing can make `color: rgb(0 0 0 / 40%)` readable, and this picks the
// better of two bad options rather than pretending otherwise.
export function pickSurface(ink) {
  if (!ink) return 'light'
  const onDark = contrast(over(ink, DARK_RGB), DARK_RGB)
  const onLight = contrast(over(ink, LIGHT_RGB), LIGHT_RGB)
  return onDark > onLight ? 'dark' : 'light'
}

function pin(el, declarations) {
  for (const [property, value] of Object.entries(declarations)) {
    el.style.setProperty(property, value, 'important')
  }
}

function applySurface(host) {
  const win = host.ownerDocument && host.ownerDocument.defaultView
  const main = host.querySelector('.hcms-toggle__main')
  if (!win || !main || typeof win.getComputedStyle !== 'function') return
  const ink = normalizeColor(win.getComputedStyle(main).color, host.ownerDocument)
  host.setAttribute('data-hcms-surface', pickSurface(ink))
}

// The ink is read from the live cascade, so it is only final once the page's
// own stylesheets have applied, and it changes again whenever the page switches
// theme. A dark-mode toggle that flips <html> or <body> would otherwise leave a
// near-white label on the near-white surface picked at load. Two elements, no
// subtree, rAF-collapsed, and it unhooks itself once the host is gone.
function scheduleSurface(host) {
  applySurface(host)
  const doc = host.ownerDocument
  const win = doc && doc.defaultView
  if (!win) return

  let frame = 0
  const recompute = () => {
    if (frame) return
    if (typeof win.requestAnimationFrame !== 'function') {
      if (!host.isConnected) return stop()
      return applySurface(host)
    }
    frame = win.requestAnimationFrame(() => {
      frame = 0
      if (!host.isConnected) return stop()
      applySurface(host)
    })
  }

  if (typeof win.requestAnimationFrame === 'function') recompute()
  if (doc.readyState !== 'complete') win.addEventListener('load', recompute, { once: true })

  const observer = typeof win.MutationObserver === 'function' ? new win.MutationObserver(recompute) : null
  if (observer) {
    // No attributeFilter. Theme togglers write whatever attribute they like:
    // Bootstrap 5.3 uses data-bs-theme, Primer uses data-color-mode, plenty use
    // a class or an inline style. An allowlist is a guess about other people's
    // markup and it was already wrong twice. Two elements, no subtree, and the
    // callback collapses into one animation frame, so watching every attribute
    // costs nothing measurable.
    observer.observe(doc.documentElement, { attributes: true })
    if (doc.body) observer.observe(doc.body, { attributes: true })
  }

  const scheme = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null
  if (scheme && typeof scheme.addEventListener === 'function') scheme.addEventListener('change', recompute)

  // Self-disconnecting: any attribute write on <html> or <body> schedules a
  // recompute, which stops the watcher once the host has left the document.
  // Round 2 added an explicit sweep at injection time as well; it was dead
  // code, because injectToggle runs once per page. The residual is a single
  // observer surviving on a page that removes our host and then never touches
  // an attribute on <html> or <body> again, which is clutter on a page that
  // has already thrown the control away.
  function stop() {
    if (observer) observer.disconnect()
    if (scheme && typeof scheme.removeEventListener === 'function') scheme.removeEventListener('change', recompute)
  }
}

export function injectToggle({ open, close, isOpen }, doc = document) {
  const existing = doc.querySelector(`[${HOST_ATTR}]`)
  if (existing) return existing

  if (!doc.querySelector(`[${STYLE_ATTR}]`)) {
    const style = doc.createElement('style')
    style.setAttribute(STYLE_ATTR, '')
    if (!doc.getElementById(STYLE_ID)) style.id = STYLE_ID
    style.setAttribute('no-save', '')
    style.setAttribute('snapshot-remove', '')
    style.setAttribute('save-ignore', '')
    style.textContent = TOGGLE_STYLE
    // Prepended, not appended: an author who overrides with a selector no
    // stronger than ours then wins the tie on document order.
    doc.head.insertBefore(style, doc.head.firstChild)
  }

  const host = doc.createElement('hypercms-toggle')
  // The id is the documented override handle, but it is the page's namespace:
  // if the page already owns it, go without rather than shadow their element.
  if (!doc.getElementById(TOGGLE_ID)) host.id = TOGGLE_ID
  host.setAttribute(HOST_ATTR, '')
  host.setAttribute('no-save', '')
  host.setAttribute('snapshot-remove', '')
  host.setAttribute('save-ignore', '')
  host.innerHTML =
    '<button type="button" class="hcms-toggle__main">' +
    '<span class="hcms-toggle__open">Edit content</span>' +
    '<span class="hcms-toggle__close">Close editor</span>' +
    '</button>'

  // The only declarations a page's `* { ... !important }` reset can take from
  // us and leave the control broken rather than merely ugly. Each reads its
  // public custom property first, so an author override still lands.
  pin(host, {
    position: 'fixed',
    right: 'calc(var(--hcms-toggle-offset, 16px) + var(--hcms-toggle-shift, 0px))',
    bottom: 'calc(var(--hcms-toggle-offset, 16px) + env(safe-area-inset-bottom, 0px))',
    'z-index': 'var(--hcms-toggle-z, 2147482900)',
  })
  pin(host.firstElementChild, {
    background: 'var(--hcms-toggle-bg, var(--hcms-toggle-_surface))',
  })

  // Delegated, so both a real click on the inner button and a programmatic
  // host.click() fire exactly once.
  host.addEventListener('click', async () => {
    try {
      if (isOpen()) close()
      else await open()
    } catch (err) {
      console.warn('hypercms: toggle failed to open the CMS', err)
    }
  })

  doc.body.appendChild(host)
  scheduleSurface(host)
  return host
}

// Inject at page load when in edit mode and the page has cms rules. DOM-ready
// deferral matters when the module evaluates while the document is still
// parsing (the rules tag or <body> may not exist yet).
export function maybeInjectToggle(api) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const forced = window.__hyperclayEditMode != null ? window.__hyperclayEditMode : null
  if (!detectEditMode({ search: window.location.search, cookie: document.cookie, forced })) return
  const run = () => { if (document.body && api.hasRules(document)) injectToggle(api) }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
}
