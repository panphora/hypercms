export function toString(path) {
  return path.map(String).join('.')
}

export function fromString(str) {
  if (str === '') return []
  return str.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg))
}

export function getRuleAtPath(rules, path) {
  let node = rules
  for (const seg of path) {
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

export function getValueAtPath(data, path) {
  let node = data
  for (const seg of path) {
    if (node == null) return undefined
    node = node[seg]
  }
  return node
}

export function setAtPath(obj, path, value) {
  if (path.length === 0) return value
  const [k, ...rest] = path
  if (typeof k === 'number') {
    const next = Array.isArray(obj) ? [...obj] : []
    next[k] = setAtPath(next[k], rest, value)
    return next
  }
  return {
    ...(obj && typeof obj === 'object' ? obj : {}),
    [k]: setAtPath((obj || {})[k], rest, value),
  }
}
