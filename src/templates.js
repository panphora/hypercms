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

// Crisp-line × (square caps + crispEdges): a plain pixel-sharp close glyph that
// stays hard-edged inside the small square corner button on object-array cards.
const CLOSE_ICON = `<svg class="hcms-x" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"></path></svg>`

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
          <button type="button" class="hcms-remove hcms-remove--card" data-hcms-action="remove" aria-label="Remove">${CLOSE_ICON}</button>
        </div>
      </div>
      <div class="hcms-error" hidden></div>
    </article>
  `,
  // Opt-in upload components. Built on the kit's consolidated mirk chrome (all
  // themed in theme.generated.css), with interactive hooks kept on data-hcms-*
  // so the vendored mirk runtime (which keys off .mirk-*__input / .mirk-*__remove)
  // never double-handles a CMS field. The bound value is the leaf's URL: the
  // <a href> for @file, the <img src> for @image. Empty/filled chrome is driven
  // by that attribute in CSS (.hcms-upload* in pixel-quiet.overrides.css), no JS.
  '@file': `
    <div class="hcms-field hcms-upload hcms-upload--file" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-file mirk-file--compact mirk-file--round">
        <label class="mirk-button mirk-button--round mirk-button--small">
          <input type="file" data-hcms-upload />
          <span class="mirk-button__label">Choose</span>
        </label>
        <a class="mirk-file__name" data-hcms-field></a>
        <button type="button" class="hcms-upload-clear" data-hcms-action="clear-upload" aria-label="Remove file">${CLOSE_ICON}</button>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,
  '@image': `
    <div class="hcms-field hcms-upload hcms-upload--image" data-hcms-shape="scalar">
      <span class="hcms-label" data-hcms-label></span>
      <div class="mirk-image mirk-image--compact mirk-image--rounded">
        <label class="mirk-button mirk-button--small mirk-image__upload">
          <input type="file" accept="image/*" data-hcms-upload />
          <span class="mirk-button__label">Upload image</span>
        </label>
        <figure class="mirk-image__thumb">
          <span class="mirk-image__frame"><img class="mirk-image__preview" data-hcms-field alt="" /></span>
          <button type="button" class="hcms-upload-clear hcms-upload-clear--badge" data-hcms-action="clear-upload" aria-label="Remove image">${CLOSE_ICON}</button>
        </figure>
      </div>
      <div class="hcms-error" hidden></div>
    </div>
  `,
}

// Shape templates fill-the-gaps on every managed page. The opt-in upload
// components (@file/@image) are injected on demand the first time a field
// selects them (the Slice-2 component seam), so pages using neither stay clean.
const ALWAYS_INJECT_KEYS = [
  '@scalar',
  '@object',
  '@scalar-array',
  '@scalar-array-item',
  '@object-array',
  '@object-array-item',
]

export function injectDefaults(doc) {
  const head = doc.head || doc.documentElement
  if (!head) return
  for (const key of ALWAYS_INJECT_KEYS) injectTemplate(doc, head, key)
}

// Inject one opt-in component template (@file/@image) if the page hasn't
// already defined its own. Called by the component-selection seam the first
// time a field resolves to an upload component.
export function injectComponentTemplate(doc, key) {
  if (!DEFAULT_TEMPLATES[key]) return null
  const head = doc && (doc.head || doc.documentElement)
  if (!head) return null
  return injectTemplate(doc, head, key)
}

// Opt-in upload-component selection. A scalar field upgrades from a plain text
// input to an image-upload widget when its rule ends in @src (uploading is the
// dominant image-CMS workflow). @href is NOT inferred: editing a link/URL is far
// more common than uploading a file, so an a@href rule stays a plain URL field.
// A file upload (and an image override) is opt-in via data-hcms-component on the
// page element the rule points at — the only branch that reads the page DOM.
// Suffix is split like the engine (lastIndexOf('@'), see engine/extract.js).
// Returns a DEFAULT_TEMPLATES key.
const PROP_TO_COMPONENT = { src: '@image' }
const UPLOAD_COMPONENT_KEYS = new Set(['@image', '@file'])

export function componentForScalarRule(rule, doc) {
  if (typeof rule !== 'string') return '@scalar'
  const at = rule.lastIndexOf('@')
  if (at >= 0) {
    const prop = rule.slice(at + 1)
    if (PROP_TO_COMPONENT[prop]) return PROP_TO_COMPONENT[prop]
  }
  const override = readComponentOverride(rule, at, doc)
  if (override === 'image') return '@image'
  if (override === 'file') return '@file'
  return '@scalar'
}

function readComponentOverride(rule, at, doc) {
  if (!doc || !doc.querySelector) return null
  const selector = at >= 0 ? rule.slice(0, at) : rule
  if (!selector || selector === '.') return null
  let el = null
  try {
    el = doc.querySelector(selector)
  } catch {
    return null
  }
  return el && el.getAttribute ? el.getAttribute('data-hcms-component') : null
}

// Pre-inject the @file/@image templates this page's rules actually select, so
// both deriveFormRules (selectors) and buildForm (DOM) resolve them. Walks the
// same rule shapes as buildTemplateMap; idempotent and author-template-safe.
export function injectUploadComponents(doc, pageRules) {
  if (!doc || pageRules == null) return
  walk(pageRules)

  function walk(rule) {
    const kind = shapeKindOf(rule)
    if (kind === 'scalar') {
      const key = componentForScalarRule(rule, doc)
      if (UPLOAD_COMPONENT_KEYS.has(key)) injectComponentTemplate(doc, key)
      return
    }
    if (kind === 'object') {
      for (const child of Object.values(rule)) walk(child)
      return
    }
    if (kind === 'object-array') {
      const itemShape = rule[1]
      if (itemShape && typeof itemShape === 'object' && !Array.isArray(itemShape)) {
        for (const child of Object.values(itemShape)) walk(child)
      } else {
        walk(itemShape)
      }
    }
  }
}

function injectTemplate(doc, head, key) {
  const existing = findTemplate(doc, key)
  if (existing) return existing
  const tpl = doc.createElement('template')
  tpl.setAttribute('data-hcms-tpl', key)
  tpl.setAttribute('save-remove', '')
  tpl.innerHTML = DEFAULT_TEMPLATES[key].trim()
  head.appendChild(tpl)
  return tpl
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
    const defaultKey =
      shape === 'scalar' ? componentForScalarRule(rule, doc) : SHAPE_TO_DEFAULT_KEY[shape] || '@scalar'

    let tpl =
      (pathStr && findTemplate(doc, pathStr)) ||
      (wildcardKey && wildcardKey !== pathStr && findTemplate(doc, wildcardKey)) ||
      findTemplate(doc, defaultKey)

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
