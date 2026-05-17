import { engine } from 'hyper-html-api'
import { applyWithRollback } from './apply-loop.js'
import { fromString as pathFromString, setAtPath, getValueAtPath } from './path.js'

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
    if (action === 'add') {
      const arrayEl = actionEl.closest('[data-hcms-path]')
      if (!arrayEl) return
      const arrayPath = arrayEl.getAttribute('data-hcms-path')
      onAdd(arrayPath, ctx)
    } else if (action === 'remove') {
      const itemEl = actionEl.closest('[data-hcms-card], [data-hcms-array-item]')
      if (!itemEl) return
      onRemove(itemEl, ctx)
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

  const existingItems = slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]')
  const nextIndex = existingItems.length

  const tpl = findTemplateForItem(arrayPath, isObjectArray ? 'object-array-item' : 'scalar-array-item', ctx.doc)
  if (!tpl) throw new Error(`hypercms: no item template available for "${arrayPath}"`)

  const itemNode = cloneAndStampItem(tpl, [...pathArr, nextIndex], isObjectArray, ctx.doc)
  slot.appendChild(itemNode)
  commit(extractFormData(ctx), { path: arrayPath, structural: true }, ctx)
}

export function onRemove(itemEl, ctx) {
  const path = itemEl.getAttribute('data-hcms-path') || ''
  const parent = itemEl.parentElement
  itemEl.remove()
  // After removal, re-stamp sibling paths to keep indices contiguous.
  if (parent) restampSiblingPaths(parent)
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

  const result = applyWithRollback(ctx.pageRoot, ctx.pageRules, newData, ctx.observerHandle, ctx.shellRoot)
  if (result.ok) {
    ctx.lastFingerprint = fingerprint
    ctx.lastData = newData
    setError(ctx, '')
    ctx.dispatch?.('hcms:change', { data: newData, path: info.path, structural: !!info.structural })
    ctx.onChange?.(newData, info)
  } else {
    setError(ctx, formatError(result.error))
    ctx.dispatch?.('hcms:error', { error: result.error, attemptedData: newData })
    ctx.onError?.(result.error)
  }
  return result
}

export function extractFormData(ctx) {
  return engine.extract(ctx.formRoot, ctx.formRules)
}

function setError(ctx, message) {
  if (!ctx.errorEl) return
  if (message) {
    ctx.errorEl.textContent = message
    ctx.errorEl.hidden = false
  } else {
    ctx.errorEl.textContent = ''
    ctx.errorEl.hidden = true
  }
}

function formatError(err) {
  if (!err) return 'unknown error'
  if (err.name === 'EmptyListInsert') {
    return 'This list has no items to use as a template. Add a hidden seed item directly in the HTML first.'
  }
  if (err.name === 'ShapeMismatch') {
    const first = err.mismatches?.[0]
    if (first) return `Shape mismatch at "${first.path}": expected ${first.expected}, got ${first.got}`
  }
  return err.message || String(err)
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

function cloneAndStampItem(tpl, pathArr, isObjectArray, doc) {
  const content = tpl.content || tpl
  const wrapper = doc.createElement('div')
  wrapper.appendChild(content.cloneNode(true))
  const node = wrapper.firstElementChild || wrapper
  if (isObjectArray) {
    node.setAttribute('data-hcms-card', '')
    if (!node.classList.contains('hcms-card')) node.classList.add('hcms-card')
  } else {
    node.setAttribute('data-hcms-array-item', '')
    if (!node.classList.contains('hcms-array-item')) node.classList.add('hcms-array-item')
  }
  node.setAttribute('data-hcms-path', pathArr.join('.'))
  return node
}

function findTemplateForItem(arrayPath, defaultShape, doc) {
  const pathArr = pathFromString(arrayPath)
  const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).concat('*').join('.')
  return (
    doc.querySelector(`template[data-hcms-tpl="${cssEscape(wildcardKey)}"]`) ||
    doc.querySelector(`template[data-hcms-tpl="@${defaultShape}"]`)
  )
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
      const sorted = {}
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
