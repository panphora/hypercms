import { getRuleAtPath } from './path.js'

export function humanize(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

// The default templates emit real mirk-interface markup so the generated form
// renders in the Pixel Quiet look out of the box. Every data-hcms-* hook
// (shape, label, field, action, the .hcms-array-items / .hcms-card-fields slots,
// the .hcms-error inline slots) is preserved exactly, so the engine, events,
// add/remove/reorder, and inline-error placement bind unchanged. The CSS that
// dresses these lives in src/theme.generated.css (scoped mirk + pixel-quiet).
const SORTABLE_GRIP = `<div class="hcms-drag-handle mirk-sortable__grip" aria-hidden="true"><div class="mirk-sortable__dots"><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span><span class="mirk-sortable__dot"></span></div></div>`

const DEFAULT_TEMPLATES = {
  '@scalar': `
    <label class="hcms-field" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <input class="mirk-input" data-hcms-field />
      <div class="hcms-error" hidden></div>
    </label>
  `,
  '@object': `
    <section class="hcms-object" data-hcms-shape="object">
      <h3 class="hcms-object-title" data-hcms-label></h3>
      <div class="hcms-object-fields"></div>
      <div class="hcms-error" hidden></div>
    </section>
  `,
  '@scalar-array': `
    <section class="hcms-array hcms-scalar-array" data-hcms-shape="scalar-array">
      <header class="hcms-array-header">
        <h3 class="hcms-array-title" data-hcms-label></h3>
      </header>
      <ul class="hcms-array-items"></ul>
      <div class="hcms-error" hidden></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
    </section>
  `,
  '@scalar-array-item': `
    <li class="hcms-array-item" draggable="true">
      <input class="mirk-input" data-hcms-field />
      <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">↑</button>
      <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">↓</button>
      <button type="button" class="hcms-remove" data-hcms-action="remove" aria-label="Remove">×</button>
      <div class="hcms-error" hidden></div>
    </li>
  `,
  '@object-array': `
    <section class="hcms-array hcms-object-array hcms-array--cards" data-hcms-shape="object-array">
      <header class="hcms-array-header">
        <h3 class="hcms-array-title" data-hcms-label></h3>
      </header>
      <div class="hcms-array-items"></div>
      <div class="hcms-error" hidden></div>
      <button type="button" class="hcms-add mirk-button mirk-button--small" data-hcms-action="add"><span class="mirk-button__label">+ Add</span></button>
    </section>
  `,
  '@object-array-item': `
    <article class="hcms-card mirk-sortable__item" draggable="true">
      ${SORTABLE_GRIP}
      <div class="hcms-card-body mirk-sortable__body">
        <div class="hcms-card-fields"></div>
        <div class="hcms-card-controls">
          <button type="button" class="hcms-move hcms-move-up hcms-sr-only" data-hcms-action="move-up" aria-label="Move up">↑</button>
          <button type="button" class="hcms-move hcms-move-down hcms-sr-only" data-hcms-action="move-down" aria-label="Move down">↓</button>
          <button type="button" class="hcms-remove" data-hcms-action="remove" aria-label="Remove">×</button>
        </div>
      </div>
      <div class="hcms-error" hidden></div>
    </article>
  `,
}

const DEFAULT_KEYS = Object.keys(DEFAULT_TEMPLATES)

export function injectDefaults(doc) {
  const head = doc.head || doc.documentElement
  if (!head) return
  for (const key of DEFAULT_KEYS) {
    if (findTemplate(doc, key)) continue
    const tpl = doc.createElement('template')
    tpl.setAttribute('data-hcms-tpl', key)
    tpl.setAttribute('save-remove', '')
    tpl.innerHTML = DEFAULT_TEMPLATES[key].trim()
    head.appendChild(tpl)
  }
}

export function findTemplate(doc, key) {
  if (!doc || !doc.querySelector) return null
  return doc.querySelector(`template[data-hcms-tpl="${cssEscape(key)}"]`)
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
}

export function shapeKindOf(rule) {
  if (typeof rule === 'string') {
    return rule.endsWith('[]') ? 'scalar-array' : 'scalar'
  }
  if (Array.isArray(rule)) return 'object-array'
  if (typeof rule === 'object' && rule !== null) return 'object'
  return 'scalar'
}

const SHAPE_TO_DEFAULT_KEY = {
  scalar: '@scalar',
  object: '@object',
  'scalar-array': '@scalar-array',
  'object-array': '@object-array',
}

const SHAPE_TO_ITEM_KEY = {
  'scalar-array': '@scalar-array-item',
  'object-array': '@object-array-item',
}

export function templateKeyForPath(pathArr, pageRules) {
  const rule = getRuleAtPath(pageRules, pathArr)
  const shape = shapeKindOf(rule)
  return SHAPE_TO_DEFAULT_KEY[shape] || '@scalar'
}

export function itemTemplateKeyForArrayPath(pathArr, pageRules) {
  const rule = getRuleAtPath(pageRules, pathArr)
  const shape = shapeKindOf(rule)
  return SHAPE_TO_ITEM_KEY[shape] || null
}

export function buildTemplateMap(pageRules, doc) {
  const map = new Map()
  walk([], pageRules)
  return map

  function walk(pathArr, rule) {
    const pathStr = pathArr.join('.')
    const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
    const shape = shapeKindOf(rule)

    let tpl =
      (pathStr && findTemplate(doc, pathStr)) ||
      (wildcardKey && wildcardKey !== pathStr && findTemplate(doc, wildcardKey)) ||
      findTemplate(doc, SHAPE_TO_DEFAULT_KEY[shape] || '@scalar')

    map.set(pathStr, tpl)

    if (shape === 'object') {
      for (const [k, child] of Object.entries(rule)) walk([...pathArr, k], child)
    } else if (shape === 'object-array' || shape === 'scalar-array') {
      const itemPath = [...pathArr, '*']
      const itemKey = itemPath.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
      const itemShape = shape === 'object-array' ? 'object-array-item' : 'scalar-array-item'
      const itemTpl =
        findTemplate(doc, itemKey) || findTemplate(doc, '@' + itemShape)
      map.set(itemKey, itemTpl)
      if (shape === 'object-array') {
        const itemRule = rule[1]
        if (itemRule && typeof itemRule === 'object' && !Array.isArray(itemRule)) {
          for (const [k, child] of Object.entries(itemRule)) walk([...itemPath, k], child)
        }
      }
    }
  }
}

export function isInlineTemplate(tplEl) {
  if (!tplEl) return false
  const root = tplEl.content || tplEl
  return !!root.querySelector('[data-hcms-field]')
}

export function slotSelectorFor(kind) {
  switch (kind) {
    case 'object':
      return '.hcms-object-fields'
    case 'object-array-item':
      return '.hcms-card-fields'
    case 'scalar-array':
    case 'object-array':
      return '.hcms-array-items'
    default:
      return null
  }
}
