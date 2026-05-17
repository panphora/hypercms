import { shapeKindOf } from './templates.js'

const PREFIX = '[hypercms]'

export function warnUnmatchedTemplates(doc, pageRules) {
  if (!doc || !doc.querySelectorAll || !pageRules) return
  const validKeys = collectValidKeys(pageRules)
  const tpls = doc.querySelectorAll('template[data-hcms-tpl]')
  tpls.forEach((tpl) => {
    const key = tpl.getAttribute('data-hcms-tpl')
    if (!key) return
    if (key.startsWith('@')) return
    if (!validKeys.has(key)) {
      console.warn(`${PREFIX} template "${key}" doesn't match any rule path; ignored`)
    }
  })
}

function collectValidKeys(pageRules) {
  const keys = new Set()
  walk([], pageRules)
  return keys

  function walk(pathArr, rule) {
    const pathStr = pathArr.join('.')
    const wildcardKey = pathArr.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
    if (pathStr) keys.add(pathStr)
    if (wildcardKey) keys.add(wildcardKey)
    const shape = shapeKindOf(rule)
    if (shape === 'object') {
      for (const [k, child] of Object.entries(rule)) walk([...pathArr, k], child)
    } else if (shape === 'object-array' || shape === 'scalar-array') {
      const itemPath = [...pathArr, '*']
      const itemWildcardKey = itemPath.map((s) => (typeof s === 'number' ? '*' : s)).join('.')
      keys.add(itemWildcardKey)
      if (shape === 'object-array') {
        const itemRule = rule[1]
        if (itemRule && typeof itemRule === 'object' && !Array.isArray(itemRule)) {
          for (const [k, child] of Object.entries(itemRule)) walk([...itemPath, k], child)
        }
      }
    }
  }
}
