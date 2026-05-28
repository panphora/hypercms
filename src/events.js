import { engine } from 'hyper-html-api'
import { applyWithRollback } from './apply-loop.js'
import { fromString as pathFromString } from './path.js'
import { buildItem } from './form-builder.js'
import { scaffold } from './scaffold.js'

const BOUND = new WeakSet()

export function bindEvents(ctx) {
  const { formRoot } = ctx
  if (!formRoot || BOUND.has(formRoot)) return
  BOUND.add(formRoot)

  const onInput = (e) => {
    const target = e.target
    if (!target || !target.closest) return
    if (!target.closest('[data-hcms-form-root]')) return
    if (!target.matches('input, textarea, select')) return
    if (!target.closest('[data-hcms-field]') && !target.hasAttribute?.('data-hcms-field')) return
    onScalarChange(target, ctx)
  }

  const onChange = (e) => {
    const target = e.target
    if (!target || !target.closest) return
    if (!target.closest('[data-hcms-form-root]')) return
    if (target.matches('input[type="checkbox"], input[type="radio"], select')) {
      onScalarChange(target, ctx)
    }
  }

  const onClick = (e) => {
    const target = e.target
    if (!target || !target.closest) return
    const actionEl = target.closest('[data-hcms-action]')
    if (!actionEl) return
    const action = actionEl.getAttribute('data-hcms-action')
    // add/remove/move must live inside the form root; close/save inside the shell.
    // Ignore stray data-hcms-action attributes elsewhere on the page.
    if (action === 'add' || action === 'remove' || action === 'move-up' || action === 'move-down') {
      if (!actionEl.closest('[data-hcms-form-root]')) return
    } else if (action === 'close' || action === 'save') {
      if (!actionEl.closest('[data-hcms-shell]')) return
    }
    if (action === 'add') {
      const arrayEl = actionEl.closest('[data-hcms-path]')
      if (!arrayEl) return
      const arrayPath = arrayEl.getAttribute('data-hcms-path')
      onAdd(arrayPath, ctx)
    } else if (action === 'remove') {
      const itemEl = actionEl.closest('[data-hcms-card], [data-hcms-array-item]')
      if (!itemEl) return
      onRemove(itemEl, ctx)
    } else if (action === 'move-up' || action === 'move-down') {
      const itemEl = actionEl.closest('[data-hcms-card], [data-hcms-array-item]')
      if (!itemEl) return
      onMove(itemEl, action === 'move-up' ? -1 : 1, ctx)
    } else if (action === 'close') {
      ctx.onCloseRequested?.()
    } else if (action === 'save') {
      onSave(ctx)
    }
  }

  const doc = formRoot.ownerDocument
  doc.addEventListener('input', onInput, true)
  doc.addEventListener('change', onChange, true)
  doc.addEventListener('click', onClick, true)

  ctx.detachEvents = () => {
    doc.removeEventListener('input', onInput, true)
    doc.removeEventListener('change', onChange, true)
    doc.removeEventListener('click', onClick, true)
    BOUND.delete(formRoot)
  }
}

export function onScalarChange(target, ctx) {
  const fieldEl = target.closest('[data-hcms-field]') || target
  const pathStr = fieldEl.closest('[data-hcms-path]')?.getAttribute('data-hcms-path') || ''
  commit(extractFormData(ctx), { path: pathStr, structural: false }, ctx)
}

export function onAdd(arrayPath, ctx) {
  const { formRoot, pageRules } = ctx
  const arrayEl = formRoot.querySelector(`[data-hcms-path="${cssEscape(arrayPath)}"]`)
  if (!arrayEl) throw new Error(`hypercms: no element at path "${arrayPath}"`)
  const slot = arrayEl.querySelector('.hcms-array-items')
  if (!slot) throw new Error(`hypercms: array container missing .hcms-array-items at "${arrayPath}"`)

  const pathArr = pathFromString(arrayPath)
  const ruleAtPath = ruleAt(pageRules, pathArr)
  const isObjectArray = Array.isArray(ruleAtPath)
  const isScalarArray = typeof ruleAtPath === 'string' && ruleAtPath.endsWith('[]')
  if (!isObjectArray && !isScalarArray) throw new Error(`hypercms: path "${arrayPath}" is not an array`)

  const maxItems = readIntAttr(arrayEl, 'data-hcms-max-items')
  const existingItems = slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]')
  if (arrayEl.hasAttribute('data-hcms-no-add')) return
  if (maxItems != null && existingItems.length >= maxItems) return
  const nextIndex = existingItems.length

  const itemShape = isObjectArray ? ruleAtPath[1] : ruleAtPath.replace(/\[\]$/, '')
  const itemData = scaffold(isObjectArray ? itemShape : 'string')
  const itemNode = buildItem({
    shape: isObjectArray ? 'object-array-item' : 'scalar-array-item',
    itemShape,
    pathArr: [...pathArr, nextIndex],
    data: itemData,
    doc: ctx.doc,
  })
  slot.appendChild(itemNode)
  updateArrayButtonsVisibility(arrayEl)
  commit(extractFormData(ctx), { path: arrayPath, structural: true }, ctx)
}

export function onMove(itemEl, direction, ctx) {
  const arrayEl = itemEl.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]')
  if (!arrayEl) return
  if (arrayEl.hasAttribute('data-hcms-no-reorder')) return
  const slot = arrayEl.querySelector('.hcms-array-items')
  if (!slot) return
  const siblings = Array.from(slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]'))
  const idx = siblings.indexOf(itemEl)
  if (idx < 0) return
  const targetIdx = idx + direction
  if (targetIdx < 0 || targetIdx >= siblings.length) return
  const moveAction = itemEl.querySelector(`[data-hcms-action="${direction < 0 ? 'move-up' : 'move-down'}"]`)
  if (direction < 0) {
    slot.insertBefore(itemEl, siblings[targetIdx])
  } else {
    slot.insertBefore(itemEl, siblings[targetIdx].nextSibling)
  }
  restampSiblingPaths(slot)
  updateArrayButtonsVisibility(arrayEl)
  // Restore focus to the moved button so keyboard users can continue pressing
  // the same button (now landed in its new position).
  if (moveAction && typeof moveAction.focus === 'function') {
    const newAction = itemEl.querySelector(`[data-hcms-action="${direction < 0 ? 'move-up' : 'move-down'}"]`)
    newAction?.focus?.()
  }
  commit(extractFormData(ctx), { path: arrayEl.getAttribute('data-hcms-path') || '', structural: true }, ctx)
}

export function onRemove(itemEl, ctx) {
  const path = itemEl.getAttribute('data-hcms-path') || ''
  const parent = itemEl.parentElement
  const arrayEl = itemEl.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]')
  if (arrayEl?.hasAttribute('data-hcms-no-remove')) return
  if (arrayEl) {
    const minItems = readIntAttr(arrayEl, 'data-hcms-min-items')
    const slot = arrayEl.querySelector('.hcms-array-items')
    const count = slot
      ? slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]').length
      : 0
    if (minItems != null && count <= minItems) return
  }
  itemEl.remove()
  // After removal, re-stamp sibling paths to keep indices contiguous.
  if (parent) restampSiblingPaths(parent)
  if (arrayEl) updateArrayButtonsVisibility(arrayEl)
  commit(extractFormData(ctx), { path, structural: true }, ctx)
}

export function onSave(ctx) {
  const data = extractFormData(ctx)
  ctx.dispatch?.('hcms:save', { data })
  ctx.onSave?.(data)
}

export function commit(newData, info, ctx) {
  const fingerprint = stableStringify(newData)
  if (fingerprint === ctx.lastFingerprint) return { ok: true, skipped: true }

  const result = applyWithRollback(ctx.pageRoot, ctx.pageRules, newData, {
    observerHandle: ctx.observerHandle,
    shellRoot: ctx.shellRoot,
    structural: !!info.structural,
    structuralPath: info.path || null,
  })
  if (result.ok) {
    ctx.lastFingerprint = fingerprint
    ctx.lastData = newData
    setError(ctx, '')
    ctx.dispatch?.('hcms:change', { data: newData, path: info.path, structural: !!info.structural })
    ctx.onChange?.(newData, info)
  } else {
    const { message, path: errorPath } = formatError(result.error, info.path)
    setError(ctx, message, errorPath)
    ctx.dispatch?.('hcms:error', { error: result.error, attemptedData: newData })
    ctx.onError?.(result.error)
  }
  return result
}

export function extractFormData(ctx) {
  const raw = engine.extract(ctx.formRoot, ctx.formRules)
  return coerceBooleans(raw, ctx.formRules)
}

// Walks either pageRules OR formRules (both use the same `endsWith('@checked')`
// semantics) and coerces leaf strings "true" / "false" to booleans. Engine
// extract stringifies @checked properties; the form layer wants real booleans
// so writeValue's Boolean(value) doesn't flip "false" → true on hydration.
export function coerceBooleans(data, rules) {
  if (rules == null || data == null) return data
  if (typeof rules === 'string') {
    if (rules.endsWith('@checked')) {
      return data === true || data === 'true'
    }
    return data
  }
  if (Array.isArray(rules)) {
    if (!Array.isArray(data)) return data
    const [, itemShape] = rules
    return data.map((item) => coerceBooleans(item, itemShape))
  }
  if (typeof rules === 'object') {
    if (typeof data !== 'object' || Array.isArray(data)) return data
    const out = {}
    for (const [k, child] of Object.entries(rules)) {
      out[k] = coerceBooleans(data[k], child)
    }
    return out
  }
  return data
}

export { stableStringify }

// Errors render inline when we can match a path to a slot in the form (a `.hcms-error`
// direct child of the path's container — added by the default scalar / array templates).
// Custom templates that omit the slot, and path-less errors, fall back to the global banner.
function setError(ctx, message, path) {
  ctx.lastError = message ? { message, path } : null
  applyErrorState(ctx)
}

// Re-apply ctx.lastError to the DOM. Exported so refreshForm can call this
// after morphForm rebuilds the form — the morph wipes inline error slots
// (they're inside the form), so we restore them post-morph.
export function applyErrorState(ctx) {
  clearInlineErrors(ctx)
  if (ctx.errorEl) {
    ctx.errorEl.textContent = ''
    ctx.errorEl.hidden = true
  }
  if (!ctx.lastError) return
  const { message, path } = ctx.lastError

  if (path != null && path !== '') {
    const target = findInlineErrorSlot(ctx.formRoot, path)
    if (target) {
      target.textContent = message
      target.hidden = false
      return
    }
  }

  if (ctx.errorEl) {
    ctx.errorEl.textContent = message
    ctx.errorEl.hidden = false
  }
}

function clearInlineErrors(ctx) {
  if (!ctx.formRoot) return
  for (const el of ctx.formRoot.querySelectorAll('.hcms-error')) {
    el.textContent = ''
    el.hidden = true
  }
}

function findInlineErrorSlot(formRoot, path) {
  if (!formRoot) return null
  const esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(path) : path.replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
  const container = formRoot.querySelector(`[data-hcms-path="${esc}"]`)
  if (!container) return null
  for (const child of container.children) {
    if (child.classList && child.classList.contains('hcms-error')) return child
  }
  return null
}

function formatError(err, fallbackPath) {
  if (!err) return { message: 'unknown error', path: fallbackPath }
  if (err.name === 'EmptyListInsert') {
    return { message: 'Add a seed item in HTML first.', path: fallbackPath }
  }
  if (err.name === 'ShapeMismatch') {
    const first = err.mismatches?.[0]
    if (first) return { message: `Shape mismatch: expected ${first.expected}, got ${first.got}`, path: first.path }
  }
  return { message: err.message || String(err), path: fallbackPath }
}

function ruleAt(rules, pathArr) {
  let node = rules
  for (const seg of pathArr) {
    if (node == null) return undefined
    if (typeof node === 'string') return undefined
    if (Array.isArray(node)) {
      if (typeof seg !== 'number' && seg !== '*') return undefined
      node = node[1]
      continue
    }
    if (typeof node === 'object') {
      if (typeof seg === 'number') return undefined
      if (!(seg in node)) return undefined
      node = node[seg]
      continue
    }
    return undefined
  }
  return node
}

function readIntAttr(el, name) {
  if (!el || !el.hasAttribute(name)) return null
  const n = parseInt(el.getAttribute(name), 10)
  return Number.isFinite(n) ? n : null
}

export function updateArrayButtonsVisibility(arrayEl) {
  if (!arrayEl) return
  const slot = arrayEl.querySelector('.hcms-array-items')
  if (!slot) return
  const items = Array.from(slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]'))
  const count = items.length
  const max = readIntAttr(arrayEl, 'data-hcms-max-items')
  const min = readIntAttr(arrayEl, 'data-hcms-min-items')
  const noAdd = arrayEl.hasAttribute('data-hcms-no-add')
  const noRemove = arrayEl.hasAttribute('data-hcms-no-remove')
  const noReorder = arrayEl.hasAttribute('data-hcms-no-reorder')
  const addBtn = arrayEl.querySelector(':scope > .hcms-add, :scope > * > .hcms-add, :scope > [data-hcms-action="add"]')
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

export function restampAllSiblings(formRoot) {
  if (!formRoot || !formRoot.querySelectorAll) return
  formRoot.querySelectorAll('.hcms-array-items').forEach((slot) => restampSiblingPaths(slot))
}

function restampSiblingPaths(parent) {
  let i = 0
  for (const child of parent.children) {
    if (!child.matches?.('[data-hcms-card], [data-hcms-array-item]')) continue
    const path = child.getAttribute('data-hcms-path')
    if (!path) continue
    const segs = path.split('.')
    segs[segs.length - 1] = String(i)
    const newPath = segs.join('.')
    if (newPath !== path) restampSubtree(child, path, newPath)
    i++
  }
}

function restampSubtree(root, oldPrefix, newPrefix) {
  const all = root.querySelectorAll('[data-hcms-path]')
  root.setAttribute('data-hcms-path', newPrefix)
  for (const el of all) {
    const p = el.getAttribute('data-hcms-path')
    if (p === oldPrefix) {
      el.setAttribute('data-hcms-path', newPrefix)
    } else if (p && p.startsWith(oldPrefix + '.')) {
      el.setAttribute('data-hcms-path', newPrefix + p.slice(oldPrefix.length))
    }
  }
}

function stableStringify(value) {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // Use a null-prototype container so `__proto__` keys survive sorting and
      // serialize as data rather than mutating object prototype.
      const sorted = Object.create(null)
      for (const k of Object.keys(v).sort()) sorted[k] = v[k]
      return sorted
    }
    return v
  })
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
}
