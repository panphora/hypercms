import { shapeKindOf, findTemplate, isInlineTemplate } from './templates.js'

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

export function fieldSelectorFor(el, key) {
  const tag = (el.tagName || '').toUpperCase()
  const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase()
  const prop = fieldPropertyFor(el)
  if (tag === 'INPUT' && type === 'radio') {
    return `[data-hcms-field="${key}"]:checked@value`
  }
  if (prop) return `[data-hcms-field="${key}"]@${prop}`
  return `[data-hcms-field="${key}"]`
}

export function deriveFormRules(pageRules, doc) {
  return derive(pageRules, [])

  function derive(rule, pathArr) {
    const kind = shapeKindOf(rule)
    if (kind === 'scalar') return scalarRule(rule, pathArr)
    if (kind === 'scalar-array') return scalarArrayRule(pathArr)
    if (kind === 'object-array') return objectArrayRule(rule, pathArr)
    if (kind === 'object') {
      const out = {}
      for (const [k, child] of Object.entries(rule)) {
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
    return `[data-hcms-field="${fieldKey}"]@value`
  }

  function scalarArrayRule(pathArr) {
    // The engine's "selector[]" form is text-only; for an editable form we need
    // per-item @value reads, so emit the [selector, shape] form with a scalar
    // shape that targets the inner field's value property.
    return ['[data-hcms-array-item]', '[data-hcms-field]@value']
  }

  function objectArrayRule(rule, pathArr) {
    const [, itemShape] = rule
    const itemPath = [...pathArr, '*']
    const itemSelector = '[data-hcms-card]'
    if (itemShape && typeof itemShape === 'object' && !Array.isArray(itemShape)) {
      const obj = {}
      for (const [k, child] of Object.entries(itemShape)) {
        obj[k] = derive(child, [...itemPath, k])
      }
      return [itemSelector, obj]
    }
    return [itemSelector, derive(itemShape, [...itemPath, 0])]
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
        content.querySelector(`[data-hcms-field="${fieldKey}"]`) ||
        content.querySelector('[data-hcms-field]')
      if (el) return el
    }
    return null
  }
}
