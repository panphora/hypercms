import { engine } from 'hyper-html-api'
import { applyWithRollback } from './apply-loop.js'
import { fromString as pathFromString, getRuleAtPath } from './path.js'
import { buildItem, fileNameFromUrl, radioGroupName } from './form-builder.js'
import { scaffold } from './scaffold.js'
import { autosizeTextarea, enhanceFields } from './enhance.js'

const BOUND = new WeakSet()

// Wraps a structural apply in the pause-before / commit-on-success pattern.
// Pauses the undo recorder, runs fn, then either commits the captured
// records (if the apply succeeded) or discards them (if it failed). Either
// way, the undo stack only ever contains successful applies — never an
// apply+rollback no-op pair.
//
// No-op pass-through when window.hyperclay.undo isn't loaded.
export function commitWithUndo(label, fn) {
  const u = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.undo) || null
  if (!u) return fn()
  u.pause()
  try {
    const result = fn()
    if (result && result.ok) {
      u.commitCaptured(label)
    } else {
      u.discardCaptured()
    }
    return result
  } finally {
    u.resume()
  }
}

// Runs fn with the undo recorder paused and its captured records discarded, so
// editor-chrome-only DOM mutations (e.g. the body class toggles the shell adds
// on mount/unmount) never enter the undo stack. No-op pass-through when undo
// isn't loaded.
export function suppressUndo(fn) {
  const u = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.undo) || null
  if (!u) return fn()
  u.pause()
  try {
    return fn()
  } finally {
    u.discardCaptured()
    u.resume()
  }
}

export function bindEvents(ctx) {
  const { formRoot } = ctx
  if (!formRoot || BOUND.has(formRoot)) return
  BOUND.add(formRoot)

  const onInput = (e) => {
    const target = e.target
    if (!target || !target.closest) return
    if (!target.closest('[data-hcms-form-root]')) return
    if (!target.matches('input, textarea, select, [contenteditable][data-hcms-field]')) return
    if (target.tagName === 'TEXTAREA') autosizeTextarea(target)
    // The upload picker fires `input` too, but its .value is the OS fake path
    // (C:\fakepath\…); it's handled on `change` via onUploadChange. The wrapper
    // carries data-hcms-field, so without this guard the closest() below would
    // route the fake path into onScalarChange.
    if (target.matches('input[type="file"]')) return
    if (!target.closest('[data-hcms-field]') && !target.hasAttribute?.('data-hcms-field')) return
    onScalarChange(target, ctx)
  }

  const onChange = (e) => {
    const target = e.target
    if (!target || !target.closest) return
    if (!target.closest('[data-hcms-form-root]')) return
    if (target.matches('input[type="file"][data-hcms-upload]')) {
      onUploadChange(target, ctx)
      return
    }
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
    // add/remove/move must live inside the form root; close inside the shell.
    // Ignore stray data-hcms-action attributes elsewhere on the page.
    if (action === 'add' || action === 'remove' || action === 'move-up' || action === 'move-down' || action === 'clear-upload') {
      if (!actionEl.closest('[data-hcms-form-root]')) return
    } else if (action === 'close') {
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
      requestRemove(itemEl, ctx)
    } else if (action === 'move-up' || action === 'move-down') {
      const itemEl = actionEl.closest('[data-hcms-card], [data-hcms-array-item]')
      if (!itemEl) return
      onMove(itemEl, action === 'move-up' ? -1 : 1, ctx)
    } else if (action === 'clear-upload') {
      onClearUpload(actionEl, ctx)
    } else if (action === 'close') {
      ctx.onCloseRequested?.()
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

// Element PROPERTIES a form field projects to that fire NO MutationRecord, so
// hyper-undo's observer can't see them (an input's live `value`, a checkbox's
// `checked`). Text projections ARE observed (characterData) and need nothing
// here. Kept narrow on purpose: the broader engine DOM_PROPERTIES_WRITE_SET
// includes observable writes (innerHTML/outerHTML) we must NOT double-record.
const UNOBSERVED_FIELD_PROPS = new Set(['value', 'checked'])

// Resolve the page element + property a scalar field projects to, but ONLY for
// the unobserved-property case above. `pathStr` is the field's FULL path (the
// scalar field element carries data-hcms-path = full path, e.g. "name" or
// "products.0.name"). Returns { el, prop, oldValue } captured from the live page
// BEFORE the apply, or null when the projection is text, targets an array item
// (the engine's ctx isn't pageRoot then), or can't be resolved.
function resolveUnobservedProjection(ctx, pathStr) {
  if (!pathStr) return null
  const fullPath = pathFromString(pathStr)
  // Array-item fields project under a per-item engine ctx, not pageRoot. Resolving
  // pageRoot.querySelector(selector) would grab the wrong item, so skip — the edit
  // simply keeps today's no-undo behavior rather than recording a wrong revert.
  if (fullPath.some((seg) => typeof seg === 'number' || seg === '*')) return null
  const rule = getRuleAtPath(ctx.pageRules, fullPath)
  if (typeof rule !== 'string') return null
  const at = rule.lastIndexOf('@')
  if (at === -1) return null                       // text projection — observed
  const prop = rule.slice(at + 1)
  if (!UNOBSERVED_FIELD_PROPS.has(prop)) return null
  const selector = rule.slice(0, at)
  const el = selector ? ctx.pageRoot.querySelector(selector) : ctx.pageRoot
  if (!el) return null
  return { el, prop, oldValue: el[prop] }
}

export function onScalarChange(target, ctx) {
  const fieldEl = target.closest('[data-hcms-field]') || target
  const pathStr = fieldEl.closest('[data-hcms-path]')?.getAttribute('data-hcms-path') || ''
  // Capture the projected page value BEFORE commit() overwrites it. Property
  // writes (@value/@checked) leave no MutationRecord, so without recording them
  // explicitly they produce no undo step (text projections are observed).
  const proj = resolveUnobservedProjection(ctx, pathStr)
  commit(extractFormData(ctx), { path: pathStr, structural: false }, ctx)
  if (proj) {
    const u = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.undo) || null
    if (u && typeof u.recordValue === 'function') {
      u.recordValue(proj.el, { prop: proj.prop, oldValue: proj.oldValue, newValue: proj.el[proj.prop] })
    }
  }
}

// Crop adapter seam: ALL crop coupling lives here, between the file pick and
// the upload. A field opts in via data-hcms-crop on the page element (copied
// onto the built @image field by the form-builder); absent attr or absent
// quickcrop (standalone page) uploads raw. Returns { file, dataURL? }, or null
// to abort (crop cancelled / failed) — the caller resets the picker and skips
// the commit. quickcrop resolves null on cancel (it does NOT reject), so the
// cancel branch is the null check, not the catch.
const CROP_OUTPUT = { type: 'image/webp', quality: 0.85, maxWidth: 2048, maxHeight: 2048 }

async function maybeCrop(file, fieldEl) {
  const attr = fieldEl && fieldEl.getAttribute ? fieldEl.getAttribute('data-hcms-crop') : null
  if (attr == null) return { file }
  const crop = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.quickcrop) || null
  if (typeof crop !== 'function') return { file }
  try {
    const r = await crop(file, { aspect: parseCropAspect(attr), ...CROP_OUTPUT })
    if (r === null) return null
    return { file: blobToFile(r.blob, file.name), dataURL: r.dataURL }
  } catch (err) {
    showFieldUploadError(fieldEl, (err && err.message) || 'Crop failed')
    return null
  }
}

// "1:1" → 1, "16:9" → 16/9, "free" / "" / unparseable → null (freeform crop).
// Exported for tests.
export function parseCropAspect(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === '' || v === 'free') return null
  const m = v.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const w = parseFloat(m[1])
  const h = parseFloat(m[2])
  if (!w || !h) return null
  return w / h
}

// quickcrop returns a nameless Blob; uploadFileBasic rejects raw Blobs and the
// server keys content-type off the filename extension, so wrap it as a File
// whose extension matches the encoded mime. Exported for tests.
export function blobToFile(blob, originalName) {
  const ext = blob.type === 'image/webp' ? '.webp' : blob.type === 'image/jpeg' ? '.jpg' : '.png'
  const base = String(originalName || 'image').replace(/\.[^.]+$/, '')
  try {
    return new File([blob], base + ext, { type: blob.type })
  } catch {
    return blob
  }
}

// A file was picked in an @file/@image widget. Optionally crop, upload via the
// host's uploadFileBasic (or fall back to a local object-URL preview), write the
// resulting URL into the bound img.src / a.href leaf, then commit once. The leaf
// attribute change is an observed page mutation, so undo gets a clean step with
// no commitWithUndo. Async; failures surface inline and reset the picker.
export async function onUploadChange(inputEl, ctx) {
  const file = inputEl.files && inputEl.files[0]
  if (!file) return
  const fieldEl = inputEl.closest('[data-hcms-path]')
  if (!fieldEl) return
  const pathStr = fieldEl.getAttribute('data-hcms-path') || ''

  // A fresh pick is a fresh attempt: clear any stale inline error (e.g. a
  // crop failure from a previous attempt) before running the new flow.
  showFieldUploadError(fieldEl, null)

  const cropped = await maybeCrop(file, fieldEl)
  if (!cropped || ctx.closed) { resetPicker(inputEl); return }
  const fileLike = cropped.file
  const previewDataUrl = cropped.dataURL || null

  const upload = (typeof window !== 'undefined' && window.hyperclay && window.hyperclay.uploadFileBasic) || null
  let url = null
  if (typeof upload === 'function') {
    try {
      const res = await upload(fileLike)
      // uploadFileBasic resolves the full envelope { uploads:[{name,nodeId,url}], … };
      // the served URL is uploads[0].url, NOT res.url.
      url = res && res.uploads && res.uploads[0] && res.uploads[0].url
    } catch (err) {
      if (ctx.closed) { resetPicker(inputEl); return }
      showFieldUploadError(fieldEl, (err && err.message) || 'Upload failed')
      ctx.dispatch?.('hcms:error', { error: err, path: pathStr })
      resetPicker(inputEl)
      return
    }
  }
  // The editor may have been closed while the upload was in flight; bail before
  // writing the (now detached) form leaf or committing to the live page.
  if (ctx.closed) { resetPicker(inputEl); return }
  if (!url) {
    // No host uploader (or it returned nothing): local preview only, which the
    // commit persists into the page as a blob:/data: URL — non-persistent, by
    // design (documented), so the widget still works in a bare page / demo.
    url = previewDataUrl || makeLocalPreviewUrl(fileLike)
  }
  if (!url) { resetPicker(inputEl); return }

  showFieldUploadError(fieldEl, null)
  writeUploadLeaf(fieldEl, url, fileLike.name)
  commit(extractFormData(ctx), { path: pathStr, structural: false }, ctx)
  resetPicker(inputEl)
}

// The × on an upload widget. Clears the bound leaf to empty and commits, so the
// :has()-driven chrome falls back to the empty state. Removes immediately (no
// consent gate) per the approved design; distinct from the "remove" action,
// which deletes a whole array item.
export function onClearUpload(actionEl, ctx) {
  const fieldEl = actionEl.closest('[data-hcms-path]')
  if (!fieldEl) return
  const pathStr = fieldEl.getAttribute('data-hcms-path') || ''
  writeUploadLeaf(fieldEl, '', '')
  const input = fieldEl.querySelector('input[type="file"][data-hcms-upload]')
  if (input) resetPicker(input)
  showFieldUploadError(fieldEl, null)
  commit(extractFormData(ctx), { path: pathStr, structural: false }, ctx)
}

function findUploadLeaf(fieldEl) {
  return fieldEl.querySelector
    ? fieldEl.querySelector('img[data-hcms-field], a[data-hcms-field]')
    : null
}

// Write a URL into the widget's bound leaf: an <img>'s src, or an <a>'s href
// plus its visible filename text. Empty url clears to the empty state.
function writeUploadLeaf(fieldEl, url, fileName) {
  const leaf = findUploadLeaf(fieldEl)
  if (!leaf) return
  const tag = (leaf.tagName || '').toUpperCase()
  if (tag === 'IMG') {
    leaf.src = url || ''
  } else if (tag === 'A') {
    leaf.href = url || ''
    leaf.textContent = url ? (fileName || fileNameFromUrl(url)) : ''
  }
}

function resetPicker(inputEl) {
  // Clear the selection so re-picking the same file fires `change` again.
  try { inputEl.value = '' } catch { /* some inputs reject programmatic clear */ }
}

function makeLocalPreviewUrl(file) {
  const U = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL : null
  if (!U) return ''
  try { return U.createObjectURL(file) } catch { return '' }
}

function showFieldUploadError(fieldEl, message) {
  const slot = fieldEl.querySelector ? fieldEl.querySelector(':scope > .hcms-error') : null
  if (!slot) return
  if (message) {
    slot.textContent = message
    slot.hidden = false
  } else {
    slot.textContent = ''
    slot.hidden = true
  }
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
    // Component arrays (chips) record their item-template key at build time so
    // added items keep the same chrome.
    itemKey: arrayEl.getAttribute('data-hcms-item-tpl') || null,
  })
  slot.appendChild(itemNode)
  enhanceFields(itemNode, ctx.doc)
  updateArrayButtonsVisibility(arrayEl)
  return commitWithUndo(`Add ${arrayPath}`, () =>
    commit(extractFormData(ctx), { path: arrayPath, structural: true }, ctx)
  )
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
  return commitWithUndo(`Reorder ${arrayEl.getAttribute('data-hcms-path') || ''}`, () =>
    commit(extractFormData(ctx), { path: arrayEl.getAttribute('data-hcms-path') || '', structural: true }, ctx)
  )
}

const DEFAULT_CONFIRM_REMOVE = 'Delete this item?'

// Resolve whether removing an item from `arrayEl` should confirm first, and with
// what prompt. Most specific wins: a per-array `data-hcms-confirm-remove`
// attribute (a string overrides the prompt; "off"/"false"/"no"/"0" disables that
// one array), then the global `confirmRemove` open() option (a string overrides
// the prompt, true forces every list, false disables everything), then the
// built-in default. The default confirms card removals (object-array items hold
// several fields) and leaves scalar-array chips instant. Returns the prompt to
// confirm with, or null to remove without asking.
function resolveRemoveConfirm(arrayEl, ctx) {
  const attr = arrayEl && arrayEl.getAttribute('data-hcms-confirm-remove')
  if (attr != null) {
    if (/^(off|false|no|0)$/i.test(attr.trim())) return null
    return attr || DEFAULT_CONFIRM_REMOVE
  }
  const global = ctx && ctx.confirmRemove
  if (global === false) return null
  if (typeof global === 'string') return global || DEFAULT_CONFIRM_REMOVE
  if (global === true) return DEFAULT_CONFIRM_REMOVE
  return arrayEl && arrayEl.getAttribute('data-hcms-shape') === 'object-array'
    ? DEFAULT_CONFIRM_REMOVE
    : null
}

// Built-in delete confirmation: every list-item removal routes through here so
// the policy applies uniformly. Confirmation uses hyperclay's consent() (the
// styled modal) when the host page provides it, falls back to native confirm(),
// and proceeds when neither exists (non-browser). Programmatic api.removeItem()
// bypasses this by calling onRemove directly, the way undo treats deliberate
// actions.
export function requestRemove(itemEl, ctx) {
  const arrayEl = itemEl.closest('[data-hcms-shape="object-array"], [data-hcms-shape="scalar-array"]')
  const message = resolveRemoveConfirm(arrayEl, ctx)
  if (message == null) return onRemove(itemEl, ctx)
  const consent = typeof window !== 'undefined' && (window.hyperclay?.consent || window.consent)
  if (typeof consent === 'function') {
    Promise.resolve(consent(message)).then(() => onRemove(itemEl, ctx), () => {})
  } else if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (window.confirm(message)) onRemove(itemEl, ctx)
  } else {
    onRemove(itemEl, ctx)
  }
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
  return commitWithUndo(`Remove ${path}`, () =>
    commit(extractFormData(ctx), { path, structural: true }, ctx)
  )
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
    setError(ctx, null)
    ctx.dispatch?.('hcms:change', { data: newData, path: info.path, structural: !!info.structural })
    ctx.onChange?.(newData, info)
  } else {
    setError(ctx, formatError(result.error, info.path))
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
// A single commit can produce multiple mismatches (ShapeMismatch carries an array); each one
// tries to land at its own path. Custom templates that omit the slot, and path-less errors,
// fall back to the global banner (joined when there's more than one).
function setError(ctx, errors) {
  ctx.lastErrors = errors && errors.length ? errors : null
  applyErrorState(ctx)
}

// Re-apply ctx.lastErrors to the DOM. Exported so refreshForm can call this
// after morphForm rebuilds the form — the morph wipes inline error slots
// (they're inside the form), so we restore them post-morph.
export function applyErrorState(ctx) {
  clearInlineErrors(ctx)
  if (ctx.errorEl) {
    ctx.errorEl.textContent = ''
    ctx.errorEl.hidden = true
  }
  if (!ctx.lastErrors) return

  const unplaced = []
  for (const { message, path } of ctx.lastErrors) {
    if (path != null && path !== '') {
      const target = findInlineErrorSlot(ctx.formRoot, path)
      if (target) {
        // Two errors at the same path concatenate into one slot, separated by a newline.
        target.textContent = target.textContent ? `${target.textContent}\n${message}` : message
        target.hidden = false
        continue
      }
    }
    unplaced.push(message)
  }

  if (unplaced.length && ctx.errorEl) {
    ctx.errorEl.textContent = unplaced.join('\n')
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
  // Walk up the path: try the exact match first, then trim the last segment, etc.
  // Lets deep-path errors land at the nearest ancestor that has a slot — useful when
  // engine paths go deeper than the form's stamped structure (e.g., migration data).
  const segs = path.split('.')
  while (segs.length > 0) {
    const candidate = segs.join('.')
    const esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(candidate) : candidate.replace(/[^a-zA-Z0-9_\-.*]/g, (c) => '\\' + c)
    const container = formRoot.querySelector(`[data-hcms-path="${esc}"]`)
    if (container) {
      for (const child of container.children) {
        if (child.classList && child.classList.contains('hcms-error')) return child
      }
    }
    segs.pop()
  }
  return null
}

function formatError(err, fallbackPath) {
  if (!err) return [{ message: 'unknown error', path: fallbackPath }]
  if (err.name === 'EmptyListInsert') {
    return [{ message: 'Add a seed item in HTML first.', path: fallbackPath }]
  }
  if (err.name === 'ShapeMismatch' && Array.isArray(err.mismatches) && err.mismatches.length) {
    return err.mismatches.map((m) => ({
      message: `Shape mismatch: expected ${m.expected}, got ${m.got}`,
      path: m.path,
    }))
  }
  return [{ message: err.message || String(err), path: fallbackPath }]
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
  // Radio names are rewritten one item at a time below, so during a move or
  // drag a just-renamed radio can transiently share a name with a
  // not-yet-renamed sibling — and the browser enforces single-selection per
  // group AT THAT INSTANT, permanently unchecking one of them (null extract →
  // the whole-form commit clobbers that field's page value). Snapshot every
  // radio's checked state and re-assert it once all names are final (and
  // unique per field) again.
  const radios = parent.querySelectorAll
    ? Array.from(parent.querySelectorAll('input[type="radio"][data-hcms-field]'), (r) => [r, r.checked])
    : []
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
  for (const [r, wasChecked] of radios) {
    if (r.checked !== wasChecked) r.checked = wasChecked
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
  syncRadioGroupNames(root)
}

// Radio group names derive from the field path at build time (populateOptions),
// so a restamp that moves paths must recompute them. Otherwise a removed-then-
// re-added sibling gets a fresh name that collides with this item's stale one:
// the two fields share a browser radio group, checking one unchecks the other,
// and the whole-form commit clobbers the unchecked field's page value. Only
// names the builder minted ('hcms-' prefix) are touched — radios in inline or
// custom templates keep whatever name the author gave them.
function syncRadioGroupNames(root) {
  for (const input of root.querySelectorAll('input[type="radio"][data-hcms-field]')) {
    if (!input.name || !input.name.startsWith('hcms-')) continue
    const host = input.closest('[data-hcms-path]')
    if (host) input.name = radioGroupName(host.getAttribute('data-hcms-path'))
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
