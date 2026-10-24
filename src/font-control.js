import { FONTS, FONT_GROUPS, SYSTEM_FONT, fontStack, fontFromStack, fontsHref } from './catalogs/fonts.js'

// The @font component: a menu of catalog families, each shown in its own face,
// writing one hidden field that the form commits like any other scalar.

const GROUP_LABELS = { sans: 'Sans', serif: 'Serif', display: 'Display', mono: 'Mono' }
const PREVIEW = 'link[data-hcms-font-preview]'

const OPEN = new WeakMap()

function openPanels(doc) {
  let set = OPEN.get(doc)
  if (!set) OPEN.set(doc, (set = new Set()))
  return set
}

function isSystemStack(stack) {
  return String(stack ?? '').trim() === SYSTEM_FONT.fallback
}

export function fontLabel(stack) {
  const text = String(stack ?? '').trim()
  if (!text) return 'Not set'
  if (isSystemStack(text)) return 'System'
  const font = fontFromStack(text)
  return font ? font.family : 'Current font'
}

export function parseFontOptions(tokens) {
  if (!tokens || tokens.length === 0) return { system: true, fonts: [...FONTS] }
  let system = false
  const picked = new Set()
  for (const token of tokens) {
    if (token === 'system') system = true
    else if (FONT_GROUPS.includes(token)) FONTS.filter((f) => f.group === token).forEach((f) => picked.add(f))
    else if (FONTS.some((f) => f.slug === token)) picked.add(FONTS.find((f) => f.slug === token))
    else console.warn(`[hypercms] font option "${token}" is not a catalog font, a group or "system"; ignoring it`)
  }
  return { system, fonts: FONTS.filter((f) => picked.has(f)) }
}

function option(doc, { value, label, family }) {
  const b = doc.createElement('button')
  b.type = 'button'
  b.className = 'hcms-font-option'
  b.setAttribute('role', 'option')
  b.setAttribute('data-hcms-action', 'font-pick')
  b.setAttribute('data-hcms-font', value)
  b.setAttribute('style', `font-family: ${family}`)
  b.textContent = label
  return b
}

export function setupFontControl(node, { value, tokens, path, doc }) {
  const { system, fonts } = parseFontOptions(tokens)
  const current = value == null ? '' : String(value).trim()
  node.setAttribute('data-hcms-font-path', path)
  const list = node.querySelector('.hcms-font-list')
  if (list) {
    const offered = new Set([...(system ? [SYSTEM_FONT.fallback] : []), ...fonts.map(fontStack)])
    if (current && !offered.has(current)) {
      list.appendChild(option(doc, { value: current, label: fontLabel(current), family: current }))
    }
    if (system) list.appendChild(option(doc, { value: SYSTEM_FONT.fallback, label: 'System', family: SYSTEM_FONT.fallback }))
    for (const group of FONT_GROUPS) {
      const members = fonts.filter((f) => f.group === group)
      if (!members.length) continue
      const heading = doc.createElement('div')
      heading.className = 'hcms-font-group'
      heading.textContent = GROUP_LABELS[group]
      list.appendChild(heading)
      for (const f of members) list.appendChild(option(doc, { value: fontStack(f), label: f.family, family: fontStack(f) }))
    }
  }
  setPanelOpen(node, openPanels(doc).has(path))
  paintFontControl(node, current)
}

export function paintFontControl(node, value) {
  const current = value == null ? '' : String(value).trim()
  const name = node.querySelector('.hcms-font-name')
  if (name) {
    name.textContent = fontLabel(current)
    if (current) name.setAttribute('style', `font-family: ${current}`)
    else name.removeAttribute('style')
  }
  node.querySelectorAll('.hcms-font-option').forEach((b) => {
    b.setAttribute('aria-selected', String(b.getAttribute('data-hcms-font') === current))
  })
}

function setPanelOpen(node, open) {
  const panel = node.querySelector('.hcms-font-panel')
  if (panel) panel.hidden = !open
  node.querySelector('.hcms-font-current')?.setAttribute('aria-expanded', String(open))
  if (open) ensurePreviewLink(node.ownerDocument)
}

// One editor-only stylesheet for every family name in its own face. It asks
// Google for just the letters of the names, so it stays a few kilobytes.
function ensurePreviewLink(doc) {
  const head = doc?.head
  if (!head || head.querySelector(PREVIEW)) return
  const href = fontsHref(FONTS.map(fontStack))
  const letters = [...new Set(FONTS.map((f) => f.family).join(''))].join('')
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = `${href}&text=${encodeURIComponent(letters)}`
  link.setAttribute('data-hcms-font-preview', '')
  for (const attr of ['editor-ui', 'no-save', 'save-remove', 'snapshot-remove']) link.setAttribute(attr, '')
  head.appendChild(link)
}

function controlOf(el) {
  return el?.closest ? el.closest('[data-hcms-font-path]') : null
}

export function toggleFontPanel(actionEl) {
  const node = controlOf(actionEl)
  if (!node) return
  const path = node.getAttribute('data-hcms-font-path')
  const panels = openPanels(node.ownerDocument)
  const open = !panels.has(path)
  if (open) panels.add(path)
  else panels.delete(path)
  setPanelOpen(node, open)
}

// Returns the hidden field to commit, or null when nothing changed.
export function pickFont(actionEl) {
  const node = controlOf(actionEl)
  if (!node) return null
  const field = node.querySelector('input[type="hidden"][data-hcms-field]')
  if (!field) return null
  openPanels(node.ownerDocument).delete(node.getAttribute('data-hcms-font-path'))
  setPanelOpen(node, false)
  const value = actionEl.getAttribute('data-hcms-font') || ''
  paintFontControl(node, value)
  if (field.value === value) return null
  field.value = value
  return field
}
