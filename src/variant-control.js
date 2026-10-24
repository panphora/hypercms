import { VARIANT_ICONS } from './catalogs/variant-icons.js'
import { humanize } from './templates.js'

// "2:cols-2" → { value: '2', icon: 'cols-2' }; a bare "cards" → its own icon
// when one exists. Split on the first colon only, so a value never loses text.
export function parseVariantOptions(tokens) {
  return (tokens || []).map((token) => {
    const colon = token.indexOf(':')
    const value = colon === -1 ? token : token.slice(0, colon)
    const iconName = colon === -1 ? token : token.slice(colon + 1)
    const icon = VARIANT_ICONS[iconName] || null
    return { value, icon, label: icon ? icon.label : humanize(value) }
  })
}

// Build one native radio per option from the template's prototype row. The
// current value is prepended when it is not offered, so opening the editor
// never silently changes the page.
export function populateVariant(node, { tokens, value, name, doc }) {
  const options = parseVariantOptions(tokens)
  const current = value == null ? '' : String(value)
  if (current !== '' && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, icon: null, label: humanize(current) })
  }
  const proto = node.querySelector('.hcms-variant-option')
  if (!proto || !proto.parentNode) return options.length
  for (const o of options) {
    const row = proto.cloneNode(true)
    const input = row.querySelector('input[type="radio"]')
    if (input) {
      input.value = o.value
      input.name = name
    }
    const iconSlot = row.querySelector('.hcms-variant-icon')
    if (iconSlot) {
      if (o.icon) iconSlot.innerHTML = o.icon.svg
      else iconSlot.remove()
    }
    const label = row.querySelector('.hcms-variant-label')
    if (label) label.textContent = o.label
    row.setAttribute('title', o.label)
    proto.parentNode.insertBefore(row, proto)
  }
  proto.remove()
  return options.length
}
