import { engine } from 'hyper-html-api'
import { morph } from 'hyper-morph'
import { fromString as pathFromString, getRuleAtPath } from './path.js'
import { rowIdentityHooks } from './row-identity.js'

const ENGINE_OPTS = { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }
const ROLLBACK_UI = 'data-hcms-rollback-ui'
let rollbackUiId = 0

// Engine reads/writes against pageRoot pass skip + templateAttr so the
// engine never traverses into the form's own DOM, and so [cms-template]
// nodes are treated as seed templates (not real data). Scalar applies skip
// snapshot — string user input can't produce a ShapeMismatch and the focused
// input must survive every keystroke.
//
// Structural applies (add/remove/reorder) can hit EmptyListInsert and other
// engine errors. We snapshot just the affected array container's slot so
// rollback restores only the failing subtree; listeners and state elsewhere
// on the page survive.
export function applyWithRollback(pageRoot, pageRules, newData, options = {}) {
  return applyPage(pageRoot, pageRules, newData, options)
}

function applyPage(pageRoot, pageRules, newData, options) {
  const { shellRoot, structural, structuralPath, formRoot } = options
  // The form's own row elements are the only stable handle across an apply, so
  // when we have the form we let it say which page row each item is. Without it
  // the engine matches by content, which is exact except between two rows that
  // read identically.
  const engineOpts = formRoot ? { ...ENGINE_OPTS, ...rowIdentityHooks(formRoot) } : ENGINE_OPTS
  if (!structural) {
    try {
      engine.apply(pageRoot, pageRules, newData, engineOpts)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err }
    }
  }

  // Structural path: snapshot the smallest container that the change
  // touches, falling back to non-shell page content if we can't resolve
  // a specific container.
  const target = resolveStructuralTarget(pageRoot, pageRules, structuralPath)
  const subtreeSnapshot = target ? captureChildren(target) : null
  const pageSnapshot = target ? null : captureNonShellSnapshot(pageRoot, shellRoot)
  try {
    engine.apply(pageRoot, pageRules, newData, engineOpts)
    return { ok: true }
  } catch (err) {
    if (subtreeSnapshot) {
      restoreChildren(target, subtreeSnapshot)
    } else if (pageSnapshot) {
      restoreNonShellSnapshot(pageRoot, shellRoot, pageSnapshot)
    }
    return { ok: false, error: err }
  }
}

// Walk pageRules along structuralPath to find the array rule that the change
// targets, then ask the engine to locate its matching container in pageRoot.
// Returns the live container element (so its child cards can be snapshotted),
// or null if the path doesn't resolve to a single array container.
function resolveStructuralTarget(pageRoot, pageRules, structuralPath) {
  if (!structuralPath || !pageRoot) return null
  const segs = pathFromString(structuralPath)
  // Walk to the array rule. Add/remove paths can be either the array itself
  // ("products") or an item path ("products.0"); both resolve to the same
  // array container.
  let arrPath = []
  let node = pageRules
  for (const seg of segs) {
    if (typeof node === 'string' || node == null) break
    if (Array.isArray(node)) {
      // We're at an array — this segment is the index; stop walking, we have
      // the container.
      break
    }
    if (typeof node === 'object' && seg in node) {
      arrPath.push(seg)
      node = node[seg]
      if (Array.isArray(node) || (typeof node === 'string' && node.endsWith('[]'))) break
    } else {
      return null
    }
  }
  if (!Array.isArray(node) && !(typeof node === 'string' && node.endsWith('[]'))) return null
  // arrPath is the prefix that leads to the array. Walk pageRoot via the
  // engine using a stripped pageRules so we land on the container.
  return resolveContainerByPath(pageRoot, pageRules, arrPath)
}

// Walk pageRoot by following each parent rule's selector until we reach the
// array container. For paths with no parent (root-level array), use pageRoot
// itself; otherwise descend through each named rule.
function resolveContainerByPath(pageRoot, pageRules, arrPath) {
  if (arrPath.length === 0) return null
  let ctx = pageRoot
  let rule = pageRules
  for (let i = 0; i < arrPath.length; i++) {
    const key = arrPath[i]
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null
    const sub = rule[key]
    if (sub == null) return null
    if (i === arrPath.length - 1) {
      // Final step: the array's selector resolves to ITEMS, not the
      // container. Walk to the items' shared parent so the snapshot covers
      // the whole list (cards/scalars siblings). Without this, an object
      // array's selector like `.product` returns the first item, and
      // rollback restores only that item's children — leaving any earlier
      // list-level insert/reorder mutated.
      if (Array.isArray(sub)) {
        const [selector] = sub
        const first = ctx.querySelector?.(selector)
        return first?.parentElement || null
      }
      if (typeof sub === 'string' && sub.endsWith('[]')) {
        const selector = sub.slice(0, -2)
        const first = ctx.querySelector?.(selector)
        return first?.parentElement || null
      }
      return null
    }
    // Intermediate: must be an object subrule. Engine extract treats objects
    // as same-ctx, so we don't narrow ctx.
    rule = sub
  }
  return null
}

function captureChildren(parent) {
  const nodes = []
  const retained = []
  for (const child of Array.from(parent.childNodes)) {
    nodes.push(cloneForRollback(child, retained))
  }
  return { nodes, retained }
}

function restoreChildren(parent, snapshot) {
  const source = parent.cloneNode(false)
  for (const clone of snapshot.nodes) source.appendChild(clone)
  morph(parent, Array.from(source.childNodes), rollbackMorphOptions())
  restoreRetainedUi(parent, snapshot.retained)
}

function captureNonShellSnapshot(pageRoot, shellRoot) {
  const nodes = []
  const retained = []
  for (const child of Array.from(pageRoot.childNodes)) {
    if (child === shellRoot || (shellRoot && child.contains?.(shellRoot))) continue
    nodes.push(cloneForRollback(child, retained))
  }
  return { nodes, retained }
}

function restoreNonShellSnapshot(pageRoot, shellRoot, snapshot) {
  const source = pageRoot.cloneNode(false)
  for (const clone of snapshot.nodes) source.appendChild(clone)
  morph(pageRoot, Array.from(source.childNodes), rollbackMorphOptions())
  restoreRetainedUi(pageRoot, snapshot.retained)
}

function cloneForRollback(source, retained) {
  const clone = source.cloneNode(false)
  if (source.nodeType === 1 && source.matches('[editor-ui],[clay~="editor-ui"]')) {
    const id = String(++rollbackUiId)
    clone.setAttribute(ROLLBACK_UI, id)
    retained.push({ id, node: source })
  }
  const sourceChildren = source.nodeType === 1 && source.tagName === 'TEMPLATE' ? source.content : source
  const cloneChildren = clone.nodeType === 1 && clone.tagName === 'TEMPLATE' ? clone.content : clone
  for (const child of Array.from(sourceChildren.childNodes || [])) {
    cloneChildren.appendChild(cloneForRollback(child, retained))
  }
  return clone
}

function restoreRetainedUi(root, retained) {
  for (const { id, node } of retained) {
    const placeholder = root.querySelector(`[${ROLLBACK_UI}="${id}"]`)
    if (placeholder === node) node.removeAttribute(ROLLBACK_UI)
    else if (node.isConnected) placeholder?.remove()
    else placeholder?.replaceWith(node)
  }
}

function rollbackMorphOptions() {
  return {
    morphStyle: 'innerHTML',
    policy: 'raw',
    restoreFocus: false,
    scripts: { handle: false, merge: false },
  }
}
