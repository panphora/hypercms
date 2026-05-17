export function scaffold(shape) {
  if (typeof shape === 'string') return shape.endsWith('[]') ? [] : ''
  if (Array.isArray(shape)) return []
  if (typeof shape === 'object' && shape !== null) {
    const out = {}
    for (const [k, v] of Object.entries(shape)) out[k] = scaffold(v)
    return out
  }
  return ''
}
