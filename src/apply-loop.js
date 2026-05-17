import { engine } from 'hyper-html-api'
import { withoutShell } from './shell-isolation.js'
import { fromString as pathFromString, getRuleAtPath } from './path.js'

// Both scalar and structural applies run through withoutShell so the engine
// never sees the form's own DOM. Scalar applies skip snapshot — string user
// input can't produce a ShapeMismatch and the focused input must survive
// every keystroke.
//
// Structural applies (add/remove/reorder) can hit EmptyListInsert and other
// engine errors. We snapshot just the affected array container's slot so
// rollback restores only the failing subtree; listeners and state elsewhere
// on the page survive.
export function applyWithRollback(pageRoot, pageRules, newData, options = {}) {
  const { observerHandle, shellRoot, structural, structuralPath } = options
  observerHandle?.pause?.()
  try {
    if (!structural) {
      try {
        withoutShell(pageRoot, shellRoot, (root) => engine.apply(root, pageRules, newData))
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
      withoutShell(pageRoot, shellRoot, (root) => engine.apply(root, pageRules, newData))
      return { ok: true }
    } catch (err) {
      if (subtreeSnapshot) {
        restoreChildren(target, subtreeSnapshot)
      } else if (pageSnapshot) {
        restoreNonShellSnapshot(pageRoot, shellRoot, pageSnapshot)
      }
      return { ok: false, error: err }
    }
  } finally {
    observerHandle?.resume?.()
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
      // Final step: the array's selector resolves to the container.
      if (Array.isArray(sub)) {
        const [selector] = sub
        return ctx.querySelector?.(selector) || null
      }
      if (typeof sub === 'string' && sub.endsWith('[]')) {
        // Scalar array's container is the parent element of the matched items.
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
  const clones = []
  for (const child of Array.from(parent.childNodes)) {
    clones.push(child.cloneNode(true))
  }
  return clones
}

function restoreChildren(parent, clones) {
  while (parent.firstChild) parent.removeChild(parent.firstChild)
  for (const clone of clones) parent.appendChild(clone)
}

function captureNonShellSnapshot(pageRoot, shellRoot) {
  const clones = []
  for (const child of Array.from(pageRoot.childNodes)) {
    if (child === shellRoot || (shellRoot && child.contains?.(shellRoot))) continue
    clones.push(child.cloneNode(true))
  }
  return clones
}

function restoreNonShellSnapshot(pageRoot, shellRoot, clones) {
  for (const child of Array.from(pageRoot.childNodes)) {
    if (child === shellRoot || (shellRoot && child.contains?.(shellRoot))) continue
    pageRoot.removeChild(child)
  }
  const host = findShellHostChild(pageRoot, shellRoot)
  for (const clone of clones) {
    pageRoot.insertBefore(clone, host || null)
  }
}

function findShellHostChild(pageRoot, shellRoot) {
  if (!shellRoot) return null
  for (const child of Array.from(pageRoot.childNodes)) {
    if (child === shellRoot || child.contains?.(shellRoot)) return child
  }
  return null
}
