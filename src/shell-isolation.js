// Shell isolation helpers. The CMS shell is mounted inside the page DOM
// (under pageRoot, usually document.body). Several operations need to read or
// snapshot pageRoot WITHOUT seeing the shell, so we don't extract form
// controls as user content or clone the shell during rollback.
//
// Two patterns:
//   withoutShell(pageRoot, shellRoot, fn) — runs fn with shell temporarily
//     detached, then reattaches in its original spot. Used for extract +
//     snapshot.
//   findShellHost(pageRoot, shellRoot) — walks up from shellRoot until we
//     find the immediate child of pageRoot that contains the shell. Returns
//     that element so callers can move/snapshot around it. Returns null if
//     shell isn't a descendant of pageRoot.

export function findShellHost(pageRoot, shellRoot) {
  if (!shellRoot || !pageRoot) return null
  if (shellRoot.parentNode === pageRoot) return shellRoot
  let node = shellRoot
  while (node && node.parentNode && node.parentNode !== pageRoot) {
    node = node.parentNode
  }
  if (!node || node.parentNode !== pageRoot) return null
  return node
}

export function withoutShell(pageRoot, shellRoot, fn) {
  const host = findShellHost(pageRoot, shellRoot)
  if (!host) return fn(pageRoot)
  const nextSibling = host.nextSibling
  const parent = host.parentNode
  parent.removeChild(host)
  try {
    return fn(pageRoot)
  } finally {
    parent.insertBefore(host, nextSibling)
  }
}
