import { shapeKindOf, findTemplate, isInlineTemplate, componentForScalarRule } from './templates.js'

const TAG_PROP_MAP = {
  IMG: 'src',
  A: 'href',
}

export function fieldPropertyFor(el) {
  if (!el) return 'value'
  const tag = (el.tagName || '').toUpperCase()
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    if (type === 'checkbox') return 'checked'
    return 'value'
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT') return 'value'
  if (TAG_PROP_MAP[tag]) return TAG_PROP_MAP[tag]
  return null
}

// Tag-specific scalar field selector. Returns a selector that uniquely
// identifies the leaf input under data-hcms-field="key" — necessary because
// data-hcms-field is now stamped on every keyed node (containers + leaves),
// so a bare `[data-hcms-field="key"]` would match the wrapping container too.
export function fieldSelectorFor(el, key) {
  const tag = (el.tagName || '').toUpperCase()
  const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase()
  const prop = fieldPropertyFor(el)
  const tagSel = tagSelectorFor(tag, type)
  const fieldSel = `${tagSel}[data-hcms-field="${cssEscape(key)}"]`
  if (tag === 'INPUT' && type === 'radio') {
    return `${fieldSel}:checked@value`
  }
  if (prop) return `${fieldSel}@${prop}`
  return fieldSel
}

// Build a per-item leaf selector with no key qualifier — used by scalar-array
// rules where the leaf is scoped by the surrounding per-item context, so the
// data-hcms-field key isn't needed (and items don't have a stable key anyway).
function keylessFieldSelectorFor(el) {
  const tag = (el.tagName || '').toUpperCase()
  const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase()
  const prop = fieldPropertyFor(el)
  const tagSel = tagSelectorFor(tag, type)
  const base = `${tagSel}[data-hcms-field]`
  if (tag === 'INPUT' && type === 'radio') return `${base}:checked@value`
  if (prop) return `${base}@${prop}`
  return base
}

function tagSelectorFor(tag, type) {
  if (tag === 'INPUT') {
    if (type) return `input[type="${type}"]`
    return 'input'
  }
  if (tag === 'TEXTAREA') return 'textarea'
  if (tag === 'SELECT') return 'select'
  if (tag === 'IMG') return 'img'
  if (tag === 'A') return 'a'
  // Custom/unknown element (e.g. contenteditable div) — match by attribute
  // and exclude every container shape (scalar wrapper too) so the wrapping
  // node never shadows the inner leaf. v0.3 stamps data-hcms-field on the
  // scalar wrapper as well, so omitting `scalar` here would otherwise match
  // the wrapper first and extract its full text instead of the leaf's.
  return ':not([data-hcms-shape="scalar"]):not([data-hcms-shape="object"]):not([data-hcms-shape="object-array"]):not([data-hcms-shape="scalar-array"])'
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function deriveFormRules(pageRules, doc) {
  return derive(pageRules, [])

  function derive(rule, pathArr) {
    const kind = shapeKindOf(rule)
    if (kind === 'scalar') return scalarRule(rule, pathArr)
    if (kind === 'scalar-array') return scalarArrayRule(pathArr)
    if (kind === 'object-array') return objectArrayRule(rule, pathArr)
    if (kind === 'object') {
      const out = Object.create(null)
      for (const [k, child] of Object.entries(rule)) {
        if (FORBIDDEN_KEYS.has(k)) {
          throw new Error(`hypercms: rule key "${k}" is forbidden at "${pathArr.join('.') || '<root>'}"`)
        }
        out[k] = derive(child, [...pathArr, k])
      }
      return out
    }
    return null
  }

  function scalarRule(rule, pathArr) {
    const key = pathArr.length ? pathArr[pathArr.length - 1] : null
    const fieldKey = typeof key === 'string' ? key : '__value'
    const inlineEl = findInlineFieldEl(pathArr, fieldKey)
    if (inlineEl) return fieldSelectorFor(inlineEl, fieldKey)
    // No path-bound override: resolve the component this rule opts into
    // (@scalar / @image / @file) and derive the selector from THAT template's
    // leaf tag, so an @image field reads img@src and an @file field reads
    // a@href, while a plain scalar still respects a global @scalar override
    // (e.g. a <textarea>) instead of assuming <input>.
    const shapeEl = findShapeFieldEl(componentForScalarRule(rule, doc), fieldKey)
    if (shapeEl) return fieldSelectorFor(shapeEl, fieldKey)
    return `input[data-hcms-field="${cssEscape(fieldKey)}"]@value`
  }

  function scalarArrayRule(pathArr) {
    // The engine's "selector[]" form is text-only; for an editable form we need
    // per-item @value reads, so emit the [selector, shape] form with a scalar
    // shape that targets the inner field's value property. If the site
    // overrides @scalar-array-item with a non-<input> leaf (textarea, etc.),
    // derive the inner-leaf selector from the override.
    const shapeEl = findShapeFieldEl('@scalar-array-item', null)
    const itemSel = shapeEl ? keylessFieldSelectorFor(shapeEl) : 'input[data-hcms-field]@value'
    return [itemSelectorFor(pathArr, '[data-hcms-array-item]'), itemSel]
  }

  function objectArrayRule(rule, pathArr) {
    const [, itemShape] = rule
    const itemPath = [...pathArr, '*']
    const itemSelector = itemSelectorFor(pathArr, '[data-hcms-card]')
    if (itemShape && typeof itemShape === 'object' && !Array.isArray(itemShape)) {
      const obj = Object.create(null)
      for (const [k, child] of Object.entries(itemShape)) {
        if (FORBIDDEN_KEYS.has(k)) {
          throw new Error(`hypercms: rule key "${k}" is forbidden at "${itemPath.join('.')}"`)
        }
        obj[k] = derive(child, [...itemPath, k])
      }
      return [itemSelector, obj]
    }
    return [itemSelector, derive(itemShape, [...itemPath, 0])]
  }

  // Build a selector that scopes item matching to the right array container.
  // Top-level paths use exact data-hcms-path match. Nested paths use the
  // stable data-hcms-field key (which the form-builder stamps on every keyed
  // container) — this disambiguates sibling arrays that share a terminal key
  // (e.g. products.*.primary.variants vs products.*.secondary.variants would
  // both have a `variants` array with the same last segment).
  function itemSelectorFor(pathArr, itemTag) {
    const lastKey = pathArr.length ? pathArr[pathArr.length - 1] : ''
    const hasWildcard = pathArr.some((s) => s === '*')
    const pathStr = pathArr.join('.')
    const containerSel = hasWildcard
      ? `[data-hcms-field="${cssEscape(lastKey)}"]`
      : `[data-hcms-path="${cssEscape(pathStr)}"]`
    return `${containerSel} > .hcms-array-items > ${itemTag}`
  }

  // Look up the field leaf inside a shape-default template (@scalar,
  // @scalar-array-item, etc.). Sites can override these globally, so the
  // selector emitted must reflect the actual leaf tag/type, not assume input.
  // Returns null if the template isn't found or has no [data-hcms-field].
  function findShapeFieldEl(shapeKey, fieldKey) {
    if (!doc) return null
    const tpl = findTemplate(doc, shapeKey)
    if (!tpl) return null
    const content = tpl.content || tpl
    if (fieldKey) {
      const keyed = content.querySelector(`[data-hcms-field="${cssEscape(fieldKey)}"]`)
      if (keyed) return keyed
    }
    return content.querySelector('[data-hcms-field]')
  }

  function findInlineFieldEl(pathArr, fieldKey) {
    if (!doc) return null
    const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
    const pathStr = pathArr.join('.')
    const candidates = [pathStr, wildcardKey]
    for (let i = pathArr.length - 1; i >= 0; i--) {
      const slice = pathArr.slice(0, i).map((s) => (typeof s === 'number' ? '*' : s))
      slice.push('*')
      candidates.push(slice.join('.'))
    }
    for (const key of candidates) {
      if (!key) continue
      const tpl = findTemplate(doc, key)
      if (!tpl || !isInlineTemplate(tpl)) continue
      const content = tpl.content || tpl
      const el =
        content.querySelector(`[data-hcms-field="${cssEscape(fieldKey)}"]`) ||
        content.querySelector('[data-hcms-field]')
      if (el) return el
    }
    return null
  }
}
