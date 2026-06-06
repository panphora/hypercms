import {
  findTemplate,
  isInlineTemplate,
  humanize,
  shapeKindOf,
  componentForScalarRule,
} from './templates.js'
import { fieldPropertyFor } from './form-rules.js'

// The visible label for a file field is the basename of its URL value; the
// bound leaf still carries the full URL in href so it round-trips byte-stable.
export function fileNameFromUrl(url) {
  if (!url) return ''
  const clean = String(url).split(/[?#]/)[0]
  const base = clean.split('/').pop() || clean
  try {
    return decodeURIComponent(base)
  } catch {
    return base
  }
}

export function buildForm({ pageRules, formRules: _formRules, data, doc }) {
  const fragment = doc.createDocumentFragment()
  const root = buildNode(pageRules, [], data, doc)
  if (root) fragment.appendChild(root)
  return fragment
}

export function buildItem({ shape, itemShape, pathArr, data, doc }) {
  if (shape === 'object-array-item') {
    return buildObjectArrayItem(itemShape, pathArr, data, doc)
  }
  if (shape === 'scalar-array-item') {
    return buildScalarArrayItem(pathArr, data, doc)
  }
  throw new Error(`hypercms: buildItem called with unknown shape "${shape}"`)
}

function buildNode(rule, pathArr, data, doc) {
  const kind = shapeKindOf(rule)
  if (kind === 'scalar') return buildScalar(rule, pathArr, data, doc)
  if (kind === 'object') return buildObject(rule, pathArr, data, doc)
  if (kind === 'object-array') return buildObjectArray(rule, pathArr, data, doc)
  if (kind === 'scalar-array') return buildScalarArray(rule, pathArr, data, doc)
  return null
}

function buildScalar(rule, pathArr, data, doc) {
  // Opt-in upload components select a richer template (@image/@file) off the
  // bound rule's @prop suffix; plain scalars stay @scalar. A path-bound
  // template override still wins inside resolveTemplate.
  const componentKey = componentForScalarRule(rule, doc)
  const tpl = resolveTemplate(pathArr, componentKey, doc)
  if (!tpl) throw new Error(`hypercms: missing template for scalar at "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  stampPath(node, pathArr)
  // Stamp leaf input(s) FIRST so the container's data-hcms-field doesn't
  // make stampScalarField early-return (which would leave the input without
  // a key).
  stampScalarField(node, lastKey(pathArr))
  // Then stamp the wrapping container so engine selectors can scope by key.
  stampContainerField(node, lastKey(pathArr))
  setLabel(node, lastKey(pathArr))
  populateScalarValue(node, data)
  if (componentKey === '@file') syncFileLeafText(node)
  return node
}

// The @file leaf is an <a> whose value is the href; populateScalarValue sets
// href but not the visible text, so derive the filename here. Empty href leaves
// the anchor empty, which the theme's :empty placeholder dresses as "No file
// chosen". Scoped to the default chrome's .mirk-file__name so author overrides
// keep their own text.
function syncFileLeafText(node) {
  const a = node.querySelector ? node.querySelector('a.mirk-file__name[data-hcms-field]') : null
  if (a) a.textContent = fileNameFromUrl(a.getAttribute('href'))
}

function buildObject(rule, pathArr, data, doc) {
  const tpl = resolveTemplate(pathArr, '@object', doc)
  if (!tpl) throw new Error(`hypercms: missing template for object at "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  stampPath(node, pathArr)
  stampContainerField(node, lastKey(pathArr))
  setLabel(node, lastKey(pathArr))

  if (isInlineTemplate(tpl)) {
    stampInlineFieldPaths(node, rule, pathArr)
    populateInlineFields(node, rule, data)
    return node
  }

  const slot = requireSlot(node, '.hcms-object-fields', tpl, pathArr)
  for (const [k, child] of Object.entries(rule)) {
    const childData = data == null ? null : data[k]
    const childNode = buildNode(child, [...pathArr, k], childData, doc)
    if (childNode) slot.appendChild(childNode)
  }
  return node
}

function buildObjectArray(rule, pathArr, data, doc) {
  const tpl = resolveTemplate(pathArr, '@object-array', doc)
  if (!tpl) throw new Error(`hypercms: missing template for object-array at "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  stampPath(node, pathArr)
  stampContainerField(node, lastKey(pathArr))
  setLabel(node, lastKey(pathArr))
  copyArrayConstraintAttrs(node, tpl)
  wireSortable(node, tpl, pathArr)

  const slot = requireSlot(node, '.hcms-array-items', tpl, pathArr)
  const [, itemShape] = rule
  const items = Array.isArray(data) ? data : []
  items.forEach((itemData, i) => {
    const itemNode = buildObjectArrayItem(itemShape, [...pathArr, i], itemData, doc)
    if (itemNode) slot.appendChild(itemNode)
  })
  applyConstraintVisibility(node)
  return node
}

function buildObjectArrayItem(itemShape, pathArr, data, doc) {
  const tpl = resolveItemTemplate(pathArr, 'object-array-item', doc)
  if (!tpl) throw new Error(`hypercms: missing item template for "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  node.setAttribute('data-hcms-card', '')
  if (!node.classList.contains('hcms-card')) node.classList.add('hcms-card')
  stampPath(node, pathArr)

  if (isInlineTemplate(tpl)) {
    if (itemShape && typeof itemShape === 'object' && !Array.isArray(itemShape)) {
      stampInlineFieldPaths(node, itemShape, pathArr)
      populateInlineFields(node, itemShape, data)
    }
    return node
  }

  const slot = requireSlot(node, '.hcms-card-fields', tpl, pathArr)
  if (itemShape && typeof itemShape === 'object' && !Array.isArray(itemShape)) {
    for (const [k, child] of Object.entries(itemShape)) {
      const childData = data == null ? null : data[k]
      const childNode = buildNode(child, [...pathArr, k], childData, doc)
      if (childNode) slot.appendChild(childNode)
    }
  }
  return node
}

function buildScalarArray(rule, pathArr, data, doc) {
  const tpl = resolveTemplate(pathArr, '@scalar-array', doc)
  if (!tpl) throw new Error(`hypercms: missing template for scalar-array at "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  stampPath(node, pathArr)
  stampContainerField(node, lastKey(pathArr))
  setLabel(node, lastKey(pathArr))
  copyArrayConstraintAttrs(node, tpl)
  wireSortable(node, tpl, pathArr)

  const slot = requireSlot(node, '.hcms-array-items', tpl, pathArr)
  const items = Array.isArray(data) ? data : []
  items.forEach((itemValue, i) => {
    const itemNode = buildScalarArrayItem([...pathArr, i], itemValue, doc)
    if (itemNode) slot.appendChild(itemNode)
  })
  applyConstraintVisibility(node)
  return node
}

function buildScalarArrayItem(pathArr, value, doc) {
  const tpl = resolveItemTemplate(pathArr, 'scalar-array-item', doc)
  if (!tpl) throw new Error(`hypercms: missing item template for "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  node.setAttribute('data-hcms-array-item', '')
  if (!node.classList.contains('hcms-array-item')) node.classList.add('hcms-array-item')
  stampPath(node, pathArr)

  populateScalarValue(node, value)
  return node
}

function resolveTemplate(pathArr, defaultKey, doc) {
  const pathStr = pathArr.join('.')
  const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
  return (
    (pathStr && findTemplate(doc, pathStr)) ||
    (wildcardKey && wildcardKey !== pathStr && findTemplate(doc, wildcardKey)) ||
    findTemplate(doc, defaultKey)
  )
}

function resolveItemTemplate(pathArr, defaultShape, doc) {
  const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
  return findTemplate(doc, wildcardKey) || findTemplate(doc, '@' + defaultShape)
}

function cloneTemplate(tpl, doc) {
  const content = tpl.content || tpl
  const wrapper = doc.createElement('div')
  wrapper.appendChild(content.cloneNode(true))
  return wrapper.firstElementChild || wrapper
}

function stampPath(node, pathArr) {
  node.setAttribute('data-hcms-path', pathArr.join('.'))
}

function stampScalarField(node, key) {
  const targetKey = key == null ? '' : String(key)
  if (node.matches && node.matches('[data-hcms-field]')) {
    if (!node.getAttribute('data-hcms-field')) node.setAttribute('data-hcms-field', targetKey)
    return
  }
  // Stamp every descendant input that's marked as a field but missing its key
  // (radio groups have multiple inputs sharing the same key).
  const fields = node.querySelectorAll ? node.querySelectorAll('[data-hcms-field]') : []
  fields.forEach((field) => {
    if (!field.getAttribute('data-hcms-field')) field.setAttribute('data-hcms-field', targetKey)
  })
}

// Stamp data-hcms-field on the WRAPPING container so engine selectors can
// scope by key (e.g. nested arrays sharing a terminal name). The leaf input's
// data-hcms-field carries the same key — form-rules selectors use tag-specific
// qualifiers (`input[data-hcms-field=...]`) so the container doesn't shadow.
function stampContainerField(node, key) {
  if (key == null || key === '' || !node.setAttribute) return
  // Don't overwrite an existing data-hcms-field attribute (e.g. when the
  // template author already stamped it deliberately).
  if (node.hasAttribute?.('data-hcms-field')) return
  node.setAttribute('data-hcms-field', String(key))
}

function setLabel(node, key) {
  if (key == null || key === '') return
  const labels = node.querySelectorAll
    ? node.querySelectorAll('[data-hcms-label]')
    : []
  labels.forEach((el) => {
    const t = el.textContent || ''
    if (t.trim() === '') el.textContent = humanize(String(key))
  })
}

function copyArrayConstraintAttrs(node, tpl) {
  ;['data-hcms-no-add', 'data-hcms-no-remove', 'data-hcms-no-reorder'].forEach((attr) => {
    if (tpl.hasAttribute(attr)) node.setAttribute(attr, '')
  })
  ;['data-hcms-min-items', 'data-hcms-max-items'].forEach((attr) => {
    if (tpl.hasAttribute(attr)) node.setAttribute(attr, tpl.getAttribute(attr))
  })
}

function applyConstraintVisibility(arrayEl) {
  const slot = arrayEl.querySelector ? arrayEl.querySelector('.hcms-array-items') : null
  if (!slot) return
  const items = Array.from(slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]'))
  const count = items.length
  const max = readIntAttr(arrayEl, 'data-hcms-max-items')
  const min = readIntAttr(arrayEl, 'data-hcms-min-items')
  const noAdd = arrayEl.hasAttribute('data-hcms-no-add')
  const noRemove = arrayEl.hasAttribute('data-hcms-no-remove')
  const noReorder = arrayEl.hasAttribute('data-hcms-no-reorder')
  const addBtn = arrayEl.querySelector('[data-hcms-action="add"]')
  if (addBtn) addBtn.hidden = noAdd || (max != null && count >= max)
  items.forEach((item, i) => {
    const rm = item.querySelector('[data-hcms-action="remove"]')
    if (rm) rm.hidden = noRemove || (min != null && count <= min)
    const up = item.querySelector('[data-hcms-action="move-up"]')
    if (up) up.hidden = noReorder || i === 0
    const dn = item.querySelector('[data-hcms-action="move-down"]')
    if (dn) dn.hidden = noReorder || i === count - 1
  })
}

function readIntAttr(el, name) {
  if (!el || !el.hasAttribute(name)) return null
  const n = parseInt(el.getAttribute(name), 10)
  return Number.isFinite(n) ? n : null
}

function wireSortable(node, tpl, pathArr) {
  if (node.hasAttribute('data-hcms-no-reorder') || tpl.hasAttribute('data-hcms-no-reorder')) return
  const slot = node.querySelector('.hcms-array-items')
  if (!slot) return
  const groupName = 'hcms-' + pathArr.join('.')
  slot.setAttribute('sortable', groupName)
  // hyperclayjs's [sortable] attribute compiles `onsorted` as a code body
  // (new Function), so we invoke a top-level callable instead of pointing at
  // a function reference. The callable is installed by hypercms.js open().
  slot.setAttribute('onsorted', 'hypercmsCommit && hypercmsCommit()')
}

function lastKey(pathArr) {
  if (!pathArr.length) return null
  return pathArr[pathArr.length - 1]
}

function populateScalarValue(node, value) {
  // Radio groups have multiple <input data-hcms-field>s; writeValue handles
  // each radio individually (checks against its `value`). Write to ALL leaf
  // fields under the wrapper, skipping the wrapper itself if it happens to
  // carry data-hcms-field too.
  const targets = collectLeafFields(node)
  if (targets.length === 0) return
  for (const t of targets) writeValue(t, value)
}

function collectLeafFields(node) {
  if (!node) return []
  const out = []
  // The node itself is a leaf only if it's a recognized leaf tag (input,
  // textarea, select, img, a, or contenteditable). Container shapes — even
  // shape="scalar" wrappers — have child inputs we should target instead.
  if (node.matches?.('[data-hcms-field]') && isLeafFieldEl(node)) {
    out.push(node)
  }
  const descendants = node.querySelectorAll
    ? node.querySelectorAll('input[data-hcms-field], textarea[data-hcms-field], select[data-hcms-field], img[data-hcms-field], a[data-hcms-field], [contenteditable][data-hcms-field]')
    : []
  descendants.forEach((d) => out.push(d))
  return out
}

function isLeafFieldEl(el) {
  const tag = (el.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'IMG' || tag === 'A') return true
  if (el.hasAttribute?.('contenteditable')) return true
  return false
}

function populateInlineFields(node, shape, data) {
  const fields = node.querySelectorAll ? node.querySelectorAll('[data-hcms-field]') : []
  fields.forEach((el) => {
    const key = el.getAttribute('data-hcms-field')
    if (!key) return
    if (!shape || typeof shape !== 'object' || !(key in shape)) {
      console.warn(`[hypercms] inline template field "${key}" is not in the rule shape; ignoring`)
      return
    }
    const childValue = data == null ? null : data[key]
    writeValue(el, childValue)
  })
}

function stampInlineFieldPaths(node, shape, parentPath) {
  if (!node.querySelectorAll) return
  const fields = node.querySelectorAll('[data-hcms-field]')
  fields.forEach((el) => {
    const key = el.getAttribute('data-hcms-field')
    if (!key) return
    if (shape && typeof shape === 'object' && !(key in shape)) return
    const childPath = [...parentPath, key].join('.')
    el.setAttribute('data-hcms-path', childPath)
  })
}

function requireSlot(node, slotSelector, tpl, pathArr) {
  if (!node.querySelector) return node
  const slot = node.querySelector(slotSelector)
  if (slot) return slot
  // Slotted templates must declare their slot. Inline-template detection has
  // already short-circuited above, so missing slot here is a real authoring bug.
  const id = tpl?.getAttribute?.('data-hcms-tpl') || pathArr.join('.')
  throw new Error(
    `hypercms: template "${id}" is in slotted mode but has no ${slotSelector} element`
  )
}

function writeValue(el, value) {
  const prop = fieldPropertyFor(el)
  const tag = (el.tagName || '').toUpperCase()
  const type = (el.getAttribute('type') || '').toLowerCase()
  if (tag === 'INPUT' && type === 'radio') {
    el.checked = el.value != null && String(el.value) === String(value ?? '')
    return
  }
  if (prop === 'checked') {
    // Coerce strings "true"/"false" the same way coerceBooleans does, so even
    // raw page-extract values (which engine stringifies) don't flip false → true.
    el.checked = value === true || value === 'true'
    return
  }
  if (prop) {
    el[prop] = value == null ? '' : String(value)
    return
  }
  el.textContent = value == null ? '' : String(value)
}
