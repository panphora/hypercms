import { engine } from 'hyper-html-api'
import { withoutShell } from './shell-isolation.js'

// Scalar applies never throw on user input — engine ShapeMismatch only fires
// for object/array data, which a string keystroke can't produce. We skip
// the snapshot entirely so the focused input is preserved across every commit.
// If apply does throw (programmer error: rule shape vs data type), the form
// stays ahead of the page until the next refresh reconciles.
//
// Structural applies (add/remove/reorder) can hit EmptyListInsert and other
// engine errors. We snapshot just the non-shell page content so rollback
// works without orphaning the shell or losing focus elsewhere.
export function applyWithRollback(pageRoot, pageRules, newData, options = {}) {
  const { observerHandle, shellRoot, structural } = options
  observerHandle?.pause?.()
  try {
    if (!structural) {
      try {
        engine.apply(pageRoot, pageRules, newData)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err }
      }
    }

    // Structural path: snapshot non-shell children so we can rollback without
    // touching the live shell.
    const snapshot = captureNonShellSnapshot(pageRoot, shellRoot)
    try {
      withoutShell(pageRoot, shellRoot, (root) => engine.apply(root, pageRules, newData))
      return { ok: true }
    } catch (err) {
      restoreNonShellSnapshot(pageRoot, shellRoot, snapshot)
      return { ok: false, error: err }
    }
  } finally {
    observerHandle?.resume?.()
  }
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
  // Remove all non-shell children, leaving the live shell intact.
  for (const child of Array.from(pageRoot.childNodes)) {
    if (child === shellRoot || (shellRoot && child.contains?.(shellRoot))) continue
    pageRoot.removeChild(child)
  }
  // Insert clones before the shell host (or at end if no shell)
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
