import {
  findTemplate,
  isInlineTemplate,
  humanize,
  shapeKindOf,
} from './templates.js'
import { fieldPropertyFor } from './form-rules.js'

export function buildForm({ pageRules, formRules: _formRules, data, doc }) {
  const fragment = doc.createDocumentFragment()
  const root = buildNode(pageRules, [], data, doc)
  if (root) fragment.appendChild(root)
  return fragment
}

function buildNode(rule, pathArr, data, doc) {
  const kind = shapeKindOf(rule)
  if (kind === 'scalar') return buildScalar(pathArr, data, doc)
  if (kind === 'object') return buildObject(rule, pathArr, data, doc)
  if (kind === 'object-array') return buildObjectArray(rule, pathArr, data, doc)
  if (kind === 'scalar-array') return buildScalarArray(rule, pathArr, data, doc)
  return null
}

function buildScalar(pathArr, data, doc) {
  const tpl = resolveTemplate(pathArr, '@scalar', doc)
  if (!tpl) throw new Error(`hypercms: missing template for scalar at "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  stampPath(node, pathArr)
  stampScalarField(node, lastKey(pathArr))
  setLabel(node, lastKey(pathArr))
  populateScalarValue(node, data)
  return node
}

function buildObject(rule, pathArr, data, doc) {
  const tpl = resolveTemplate(pathArr, '@object', doc)
  if (!tpl) throw new Error(`hypercms: missing template for object at "${pathArr.join('.')}"`)
  const node = cloneTemplate(tpl, doc)
  stampPath(node, pathArr)
  setLabel(node, lastKey(pathArr))

  if (isInlineTemplate(tpl)) {
    populateInlineFields(node, rule, data)
    return node
  }

  const slot = node.querySelector('.hcms-object-fields') || node
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
  setLabel(node, lastKey(pathArr))
  applyArrayConstraints(node, tpl)
  wireSortable(node, tpl, pathArr)

  const slot = findItemsSlot(node)
  const [, itemShape] = rule
  const items = Array.isArray(data) ? data : []
  items.forEach((itemData, i) => {
    const itemNode = buildObjectArrayItem(itemShape, [...pathArr, i], itemData, doc)
    if (itemNode) slot.appendChild(itemNode)
  })
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
      populateInlineFields(node, itemShape, data)
    }
    return node
  }

  const slot = node.querySelector('.hcms-card-fields') || node
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
  setLabel(node, lastKey(pathArr))
  applyArrayConstraints(node, tpl)
  wireSortable(node, tpl, pathArr)

  const slot = findItemsSlot(node)
  const items = Array.isArray(data) ? data : []
  items.forEach((itemValue, i) => {
    const itemNode = buildScalarArrayItem([...pathArr, i], itemValue, doc)
    if (itemNode) slot.appendChild(itemNode)
  })
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
  const field = node.querySelector('[data-hcms-field]')
  if (field && !field.getAttribute('data-hcms-field')) {
    field.setAttribute('data-hcms-field', targetKey)
  }
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

function findItemsSlot(node) {
  return node.querySelector('.hcms-array-items') || node
}

function applyArrayConstraints(node, tpl) {
  ;['data-hcms-no-add', 'data-hcms-no-remove', 'data-hcms-no-reorder'].forEach((attr) => {
    if (tpl.hasAttribute(attr)) node.setAttribute(attr, '')
  })
  ;['data-hcms-min-items', 'data-hcms-max-items'].forEach((attr) => {
    if (tpl.hasAttribute(attr)) node.setAttribute(attr, tpl.getAttribute(attr))
  })
  if (node.hasAttribute('data-hcms-no-add')) {
    node.querySelectorAll('[data-hcms-action="add"]').forEach((b) => (b.hidden = true))
  }
  if (node.hasAttribute('data-hcms-no-remove')) {
    node.querySelectorAll('[data-hcms-action="remove"]').forEach((b) => (b.hidden = true))
  }
}

function wireSortable(node, tpl, pathArr) {
  if (node.hasAttribute('data-hcms-no-reorder') || tpl.hasAttribute('data-hcms-no-reorder')) return
  const slot = node.querySelector('.hcms-array-items')
  if (!slot) return
  const groupName = 'hcms-' + pathArr.join('.')
  slot.setAttribute('sortable', groupName)
  slot.setAttribute(
    'onsorted',
    'window.hyperclay && window.hyperclay.hypercms && window.hyperclay.hypercms._commit && window.hyperclay.hypercms._commit()'
  )
}

function lastKey(pathArr) {
  if (!pathArr.length) return null
  return pathArr[pathArr.length - 1]
}

function populateScalarValue(node, value) {
  const target = node.matches && node.matches('[data-hcms-field]') ? node : node.querySelector('[data-hcms-field]')
  if (!target) return
  writeValue(target, value)
}

function populateInlineFields(node, shape, data) {
  const fields = node.querySelectorAll ? node.querySelectorAll('[data-hcms-field]') : []
  fields.forEach((el) => {
    const key = el.getAttribute('data-hcms-field')
    if (!key) return
    if (!shape || typeof shape !== 'object' || !(key in shape)) return
    const childValue = data == null ? null : data[key]
    writeValue(el, childValue)
  })
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
    el.checked = Boolean(value)
    return
  }
  if (prop) {
    el[prop] = value == null ? '' : String(value)
    return
  }
  el.textContent = value == null ? '' : String(value)
}
