import { componentForScalarRule } from './templates.js'
import { fontsHref, sameFamilies } from './catalogs/fonts.js'

// The page's one Google Fonts stylesheet is derived from its font fields: the
// families they hold, nothing else. Recomputed after commits and refreshes, so
// undo, live sync and outside edits all end in the right link without each
// path having to know about fonts.

const LINK = 'link[data-hcms-fonts]'
const PRECONNECT = 'link[data-hcms-fonts-preconnect]'

// Every font field's value, walking the rules and the extracted data together.
// `found` says whether these rules have any font field at all.
export function fontStacksIn(pageRules, data, doc) {
  const stacks = []
  let found = false
  walk(pageRules, data, [])
  return { stacks, found }

  function walk(rule, value, pathArr) {
    if (typeof rule === 'string') {
      if (rule.endsWith('[]')) return
      if (componentForScalarRule(rule, doc, pathArr, pageRules) !== '@font') return
      found = true
      if (value != null && value !== '') stacks.push(String(value))
      return
    }
    if (Array.isArray(rule)) {
      const items = Array.isArray(value) ? value : []
      items.forEach((item) => walk(rule[1], item, [...pathArr, '*']))
      if (!items.length) walk(rule[1], undefined, [...pathArr, '*'])
      return
    }
    if (rule && typeof rule === 'object') {
      for (const [key, child] of Object.entries(rule)) walk(child, value?.[key], [...pathArr, key])
    }
  }
}

export function syncFontsLink(doc, href) {
  const head = doc?.head
  if (!head) return
  let link = head.querySelector(LINK)
  let pre = head.querySelector(PRECONNECT)
  if (!href) {
    link?.remove()
    pre?.remove()
    return
  }
  if (!pre) {
    pre = doc.createElement('link')
    pre.setAttribute('rel', 'preconnect')
    pre.setAttribute('href', 'https://fonts.gstatic.com')
    pre.setAttribute('crossorigin', '')
    pre.setAttribute('data-hcms-fonts-preconnect', '')
    pre.setAttribute('no-undo', '')
    head.appendChild(pre)
  }
  if (!link) {
    link = doc.createElement('link')
    link.setAttribute('rel', 'stylesheet')
    link.setAttribute('data-hcms-fonts', '')
    link.setAttribute('no-undo', '')
    pre.after(link)
  }
  // The CMS derives this link from the font fields, so its changes are never
  // undo steps of their own, including on a link the author wrote by hand.
  if (!link.hasAttribute('no-undo')) link.setAttribute('no-undo', '')
  if (!pre.hasAttribute('no-undo')) pre.setAttribute('no-undo', '')
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
}

export function reconcileFontsLink(ctx, data) {
  if (!ctx?.doc || ctx.pageRules == null) return
  const { stacks, found } = fontStacksIn(ctx.pageRules, data, ctx.doc)
  if (!found) return
  const current = ctx.doc.head?.querySelector(LINK)?.getAttribute('href') || null
  const href = fontsHref(stacks, current)
  // A link that already loads exactly these families stays as it is, so
  // opening the editor or an undo never rewrites the author's own URL.
  if (href && current && sameFamilies(current, href)) return
  syncFontsLink(ctx.doc, href)
}
