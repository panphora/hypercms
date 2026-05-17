import { engine } from 'hyper-html-api'

// The shell is mounted INSIDE pageRoot (usually document.body). If we snapshot
// pageRoot directly and rollback replaces its children, the live shell node
// becomes orphaned and its dispatched events stop bubbling. Detach the shell
// briefly so snapshot/apply/rollback never touches it, then reattach.
export function applyWithRollback(pageRoot, pageRules, newData, observerHandle, shellRoot) {
  observerHandle?.pause?.()
  const detached = detachIfChild(pageRoot, shellRoot)
  const snapshot = pageRoot.cloneNode(true)
  try {
    engine.apply(pageRoot, pageRules, newData)
    reattach(detached)
    observerHandle?.resume?.()
    return { ok: true }
  } catch (err) {
    while (pageRoot.firstChild) pageRoot.removeChild(pageRoot.firstChild)
    while (snapshot.firstChild) pageRoot.appendChild(snapshot.firstChild)
    reattach(detached)
    observerHandle?.resume?.()
    return { ok: false, error: err }
  }
}

function detachIfChild(pageRoot, shellRoot) {
  if (!shellRoot || shellRoot.parentNode !== pageRoot) return null
  const nextSibling = shellRoot.nextSibling
  pageRoot.removeChild(shellRoot)
  return { pageRoot, shellRoot, nextSibling }
}

function reattach(info) {
  if (!info) return
  info.pageRoot.insertBefore(info.shellRoot, info.nextSibling)
}
