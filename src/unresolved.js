import domAdapter from 'hyper-html-api/dom'
import { ruleAttrIndex } from 'hyper-html-api/engine'

const PREFIX = '[hypercms]'

// The opts every other engine call in hypercms uses: never traverse into the
// sidebar's own form, never count a [cms-template] seed as content.
const FIND_OPTS = { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }
// templateAttr:null includes seeds. An empty list still holding its seed can be
// grown back from it, so it is not dead.
const SEED_OPTS = { skip: '[data-hcms-shell]', templateAttr: null }

export class InvalidRuleSelector extends Error {
  constructor(path, selector, cause) {
    super(`hypercms: rule at "${path}" has an invalid CSS selector: "${selector}"`)
    this.name = 'InvalidRuleSelector'
    this.path = path
    this.selector = selector
    this.cause = cause
  }
}

// Report a field only when writing to it would be silently discarded, which is
// exactly when apply() finds no element and returns having done nothing.
// An extracted null is NOT that test: a present-but-empty attribute reads null
// too (extract.js readPropOrAttr), and that field saves perfectly. So this
// resolves each rule's selector and counts matches instead of reading values.
export function findUnresolved(root, rules) {
  const missing = []
  const twins = []
  walk(root, rules, [], missing, twins)
  return { missing: unique(missing), twins: uniqueTwins(twins) }
}

function walk(ctx, rule, path, missing, twins) {
  if (typeof rule === 'string') {
    const selector = selectorOf(rule)
    if (!selector) return
    const matches = find(ctx, selector, FIND_OPTS, path)
    if (rule.endsWith('[]')) {
      if (matches.length === 0 && find(ctx, selector, SEED_OPTS, path).length === 0) {
        missing.push(pathStr(path))
      }
      return
    }
    if (matches.length === 0) missing.push(pathStr(path))
    else if (matches.length > 1) twins.push({ path: pathStr(path), count: matches.length })
    return
  }

  if (Array.isArray(rule)) {
    const [selector, shape] = rule
    if (typeof selector !== 'string' || !selector) return
    const matches = find(ctx, selector, FIND_OPTS, path)
    if (matches.length === 0) {
      if (find(ctx, selector, SEED_OPTS, path).length === 0) missing.push(pathStr(path))
      return
    }
    // Rows collapse to one '*' segment, so a field broken on every row is
    // reported once rather than once per row.
    for (const node of matches) walk(node, shape, [...path, '*'], missing, twins)
    return
  }

  if (rule && typeof rule === 'object') {
    for (const [key, sub] of Object.entries(rule)) walk(ctx, sub, [...path, key], missing, twins)
  }
}

function find(ctx, selector, opts, path) {
  try {
    return domAdapter.find(ctx, selector, opts)
  } catch (err) {
    throw new InvalidRuleSelector(pathStr(path), selector, err)
  }
}

// Mirrors the engine's scalar parsing: a trailing [] strips, "." and a leading
// @ read the context node itself so they can never fail to resolve, and
// otherwise the selector is the part before the separator @ (the last one that
// is not inside brackets or quotes, so a mailto address stays in the selector).
function selectorOf(rule) {
  if (rule === '.' || rule.startsWith('@')) return null
  if (rule.endsWith('[]')) return rule.slice(0, -2) || null
  const at = ruleAttrIndex(rule)
  return (at === -1 ? rule : rule.slice(0, at)) || null
}

export function applyUnresolvedState(ctx) {
  renderNotice(ctx)
  warnTwins(ctx)
}

// States the fact and stops. Regenerating a CMS replaces the rules tag
// wholesale, so a notice that reads as a repair prompt would walk anyone with a
// hand-edited config into losing it.
function renderNotice(ctx) {
  const el = ctx.noticeEl
  if (!el) return
  const missing = (ctx.unresolved && ctx.unresolved.missing) || []
  if (missing.length === 0) {
    el.textContent = ''
    el.hidden = true
    return
  }
  const count = missing.length === 1
    ? '1 field no longer matches this page'
    : `${missing.length} fields no longer match this page`
  el.textContent = `${count}: ${missing.join(', ')}`
  el.hidden = false
}

// Two elements matching one scalar rule still works, since the write lands on
// the first, so this is a console note rather than a notice. Runtime duplicates
// (a carousel cloning slides, a dialog holding a second copy) are ordinary.
// Signature-gated because the walk reruns on every refresh.
function warnTwins(ctx) {
  const twins = (ctx.unresolved && ctx.unresolved.twins) || []
  const signature = twins.map((t) => `${t.path}:${t.count}`).join('|')
  if (signature === ctx.lastTwinSignature) return
  ctx.lastTwinSignature = signature
  for (const { path, count } of twins) {
    console.warn(`${PREFIX} "${path}" matches ${count} elements; edits go to the first one.`)
  }
}

function unique(list) {
  return [...new Set(list)]
}

function uniqueTwins(list) {
  const byPath = new Map()
  for (const twin of list) {
    const seen = byPath.get(twin.path)
    if (!seen || twin.count > seen.count) byPath.set(twin.path, twin)
  }
  return [...byPath.values()]
}

function pathStr(path) {
  return path.length ? path.join('.') : '(whole page)'
}
