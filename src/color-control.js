import { COLORS, HUES, SHADES } from './catalogs/colors.js'

// The @color component: swatches from the Tailwind palette plus an optional
// custom picker, all writing one hidden field that the form commits like any
// other scalar. Built here rather than in form-builder.js because the events
// side (pick, clear, panel, custom entry) needs the same helpers.

const INLINE_LIMIT = 12
const BY_ID = new Map(COLORS.map((c) => [c.id, c]))
const BY_VALUE = new Map(COLORS.map((c) => [c.value, c]))
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)$/i
const UNSAFE = /[;{}<>\\]|url\s*\(/i

// The form is rebuilt after every page change, so which panels are open is
// kept outside it: per document, by field path.
const OPEN = new WeakMap()

function openPanels(doc) {
  let set = OPEN.get(doc)
  if (!set) OPEN.set(doc, (set = new Set()))
  return set
}

// A value the custom picker may write. The browser's own parser decides when it
// is there; without one (node tests) a conservative shape check stands in.
export function isColorValue(value, doc) {
  const text = String(value ?? '').trim()
  if (!text || UNSAFE.test(text)) return false
  const css = doc?.defaultView?.CSS
  if (css && typeof css.supports === 'function') return css.supports('color', text)
  return HEX.test(text) || COLOR_FUNCTION.test(text) || /^[a-z]+$/i.test(text)
}

function humanColor(c) {
  return `${c.hue[0].toUpperCase()}${c.hue.slice(1)} ${c.shade}`
}

function toSwatch(c) {
  return { id: c.id, label: humanColor(c), value: c.value }
}

export function colorLabel(value) {
  const text = String(value ?? '').trim()
  const hit = BY_VALUE.get(text)
  return hit ? humanColor(hit) : text
}

export function parseColorOptions(tokens, doc) {
  if (!tokens || tokens.length === 0) {
    return { swatches: COLORS.map(toSwatch), custom: true, full: true }
  }
  const swatches = []
  const seen = new Set()
  let custom = false
  const add = (s) => {
    if (seen.has(s.value)) return
    seen.add(s.value)
    swatches.push(s)
  }
  for (const token of tokens) {
    if (token === 'custom') custom = true
    else if (BY_ID.has(token)) add(toSwatch(BY_ID.get(token)))
    else if (HUES.includes(token)) COLORS.filter((c) => c.hue === token).forEach((c) => add(toSwatch(c)))
    else if (SHADES.includes(token)) COLORS.filter((c) => c.shade === token).forEach((c) => add(toSwatch(c)))
    else if (isColorValue(token, doc)) add({ id: null, label: token, value: token })
    else console.warn(`[hypercms] color option "${token}" is not a Tailwind color, hue, shade, CSS color or "custom"; ignoring it`)
  }
  return { swatches, custom, full: false }
}

export function setupColorControl(node, { value, tokens, path, doc }) {
  const { swatches, custom, full } = parseColorOptions(tokens, doc)
  const current = value == null ? '' : String(value).trim()
  if (current && !swatches.some((s) => s.value === current)) {
    swatches.unshift({ id: null, label: colorLabel(current), value: current })
  }
  const inline = swatches.length <= INLINE_LIMIT
  node.setAttribute('data-hcms-color-path', path)
  node.classList.toggle('hcms-color--inline', inline)
  const grid = node.querySelector('.hcms-color-grid')
  if (grid) {
    grid.classList.toggle('hcms-color-grid--full', full)
    for (const s of swatches) {
      const b = doc.createElement('button')
      b.type = 'button'
      b.className = 'hcms-color-swatch'
      b.setAttribute('data-hcms-action', 'color-pick')
      b.setAttribute('data-hcms-color', s.value)
      b.setAttribute('aria-label', s.label)
      b.setAttribute('title', s.id || s.label)
      b.setAttribute('style', `--hcms-swatch: ${s.value}`)
      grid.appendChild(b)
    }
  }
  if (!custom) node.querySelector('.hcms-color-custom')?.remove()
  const toggle = node.querySelector('.hcms-color-current')
  if (inline && toggle) {
    toggle.removeAttribute('data-hcms-action')
    toggle.removeAttribute('aria-expanded')
  }
  setPanelOpen(node, inline || openPanels(doc).has(path))
  paintColorControl(node, current)
}

// Reflect a value in the control's own chrome: chip, name, pressed swatch,
// custom inputs. The hidden field is the value; this is only its picture.
export function paintColorControl(node, value) {
  const current = value == null ? '' : String(value).trim()
  node.toggleAttribute('data-hcms-color-empty', current === '')
  const chip = node.querySelector('.hcms-color-chip')
  if (chip) {
    if (current) chip.setAttribute('style', `--hcms-swatch: ${current}`)
    else chip.removeAttribute('style')
  }
  const name = node.querySelector('.hcms-color-name')
  if (name) name.textContent = current ? colorLabel(current) : 'Not set'
  node.querySelectorAll('.hcms-color-swatch').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-hcms-color') === current))
  })
  const text = node.querySelector('[data-hcms-color-input="text"]')
  if (text && text.ownerDocument?.activeElement !== text) text.value = current
  const native = node.querySelector('[data-hcms-color-input="native"]')
  if (native && /^#[0-9a-f]{6}$/i.test(current)) native.value = current.toLowerCase()
}

function setPanelOpen(node, open) {
  const panel = node.querySelector('.hcms-color-panel')
  if (panel) panel.hidden = !open
  const toggle = node.querySelector('.hcms-color-current[data-hcms-action]')
  if (toggle) toggle.setAttribute('aria-expanded', String(open))
}

function controlOf(el) {
  return el?.closest ? el.closest('[data-hcms-color-path]') : null
}

function hiddenField(node) {
  return node.querySelector('input[type="hidden"][data-hcms-field]')
}

function showColorError(node, message) {
  const slot = node.querySelector(':scope > .hcms-error')
  if (!slot) return
  slot.textContent = message || ''
  slot.hidden = !message
}

// Each of these returns the hidden field to commit, or null when nothing changed.
function setColor(node, value) {
  const field = hiddenField(node)
  if (!field) return null
  showColorError(node, null)
  paintColorControl(node, value)
  if (field.value === value) return null
  field.value = value
  return field
}

export function pickColor(actionEl) {
  const node = controlOf(actionEl)
  if (!node) return null
  if (!node.classList.contains('hcms-color--inline')) {
    openPanels(node.ownerDocument).delete(node.getAttribute('data-hcms-color-path'))
    setPanelOpen(node, false)
  }
  return setColor(node, actionEl.getAttribute('data-hcms-color') || '')
}

export function clearColor(actionEl) {
  const node = controlOf(actionEl)
  return node ? setColor(node, '') : null
}

export function toggleColorPanel(actionEl) {
  const node = controlOf(actionEl)
  if (!node) return
  const path = node.getAttribute('data-hcms-color-path')
  const panels = openPanels(node.ownerDocument)
  const open = !panels.has(path)
  if (open) panels.add(path)
  else panels.delete(path)
  setPanelOpen(node, open)
}

export function customColor(inputEl) {
  const node = controlOf(inputEl)
  if (!node) return null
  const value = String(inputEl.value || '').trim()
  if (value !== '' && !isColorValue(value, node.ownerDocument)) {
    showColorError(node, `"${value}" is not a CSS color`)
    return null
  }
  return setColor(node, value)
}
