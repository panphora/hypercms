// The CMS reads and writes the whole document, so a rule can bind <html> (the
// page's theme properties) or the <head>. Everything that needs an element to
// stand for the page (event payloads and dispatch, structural rollback, the
// inline view's page listeners) keeps using <body>, where the content lives.
export function contentRoot(pageRoot) {
  if (pageRoot && pageRoot.nodeType === 9) return pageRoot.body || pageRoot.documentElement
  return pageRoot
}

// A rule with no selector ("@data-mode", ".") addresses the page root itself.
// A Document has no attributes or text of its own, so outside a list those
// rules address <body>, which is what they addressed when <body> was the
// default root. Inside a list the row is the context and nothing changes.
export function rootRules(rules, pageRoot) {
  if (!pageRoot || pageRoot.nodeType !== 9) return rules
  return walk(rules)
  function walk(rule) {
    if (typeof rule === 'string') {
      if (rule === '.') return 'body'
      if (rule.startsWith('@')) return `body${rule}`
      return rule
    }
    if (Array.isArray(rule) || !rule || typeof rule !== 'object') return rule
    const out = {}
    for (const [k, v] of Object.entries(rule)) out[k] = walk(v)
    return out
  }
}
