// Every editable thing on the page, as the inline view needs to see it: the
// element a rule resolved to, the real data path that reaches it, and which
// affordance belongs on it.
//
// This is the same walk `unresolved.js` does, with the opposite output. That one
// reports paths as strings and collapses every row of a list to a single '*',
// because it answers "which fields are broken" once for the whole page. The
// inline view needs the resolved element and the real row index, because it puts
// a control on each one.

import domAdapter from 'hyper-html-api/dom'
import { ruleAttrIndex } from 'hyper-html-api/engine'

const FIND_OPTS = { skip: '[data-hcms-shell]', templateAttr: 'cms-template' }
// templateAttr:null includes the hidden [cms-template] seed. A list that has been
// emptied down to its seed still has a place on the page — the seed is sitting in
// it — and that is the one list most in need of an "+ Add" row. Finding the seed
// is the only way to know where the row goes, so an empty list resolves its
// container this way and nothing else uses these opts.
const SEED_OPTS = { skip: '[data-hcms-shell]', templateAttr: null }

// How someone changes this field, in place:
//
//   'text'    the page element IS the affordance. richclay binds to it and the
//             text is edited where it sits; commit on blur.
//   'native'  the page already carries the control — an enabled input, textarea
//             or select bound through @value. Add nothing at all: let them use
//             the control that is already there and commit on change. A readonly
//             or disabled one is NOT this: the author disabled it on purpose, so
//             it falls through to a handle rather than being quietly re-enabled.
//   'handle'  everything else gets a small handle over the anchor's corner,
//             which opens the popover holding that field's real form control.
const TEXT = 'text'
const NATIVE = 'native'
const HANDLE = 'handle'

const NATIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// Elements that cannot hold editable text, either because they are void or
// replaced, or because their text content is their value and belongs to the
// control rather than to the document. A bare rule pointing at one of these is
// unusual but legal (it extracts ''), and binding a rich text editor to it would
// put a caret inside an <img>. They get a handle like anything else.
const NON_TEXT_TAGS = new Set([
  'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BR', 'HR', 'VIDEO', 'AUDIO',
  'IFRAME', 'EMBED', 'OBJECT', 'CANVAS', 'SOURCE', 'TRACK', 'AREA', 'COL', 'PARAM',
])

export function resolveTargets(root, rules) {
  const targets = []
  const lists = []
  walk(root, rules, [], targets, lists)
  return { targets, lists }
}

function walk(ctx, rule, path, targets, lists) {
  if (typeof rule === 'string') {
    // A scalar array ("ul.tags li[]"): every match is its own editable item, and
    // the run of them is a list that can be added to and removed from.
    if (rule.endsWith('[]')) {
      const selector = rule.slice(0, -2)
      if (!selector) return
      const items = find(ctx, selector)
      items.forEach((el, i) => {
        targets.push(describe([...path, i], el, rule, null))
      })
      lists.push(makeList(ctx, path, selector, items, true))
      return
    }
    const at = ruleAttrIndex(rule)
    const attr = at === -1 ? null : rule.slice(at + 1)
    const selector = at === -1 ? rule : rule.slice(0, at)
    // "." and a bare "@attr" both address the context node itself, so they can
    // never fail to resolve and there is nothing to query.
    const el = !selector || selector === '.' ? ctx : find(ctx, selector)[0]
    if (el) targets.push(describe(path, el, rule, attr))
    return
  }

  if (Array.isArray(rule)) {
    const [selector, shape] = rule
    if (typeof selector !== 'string' || !selector) return
    const items = find(ctx, selector)
    items.forEach((el, i) => walk(el, shape, [...path, i], targets, lists))
    lists.push(makeList(ctx, path, selector, items, false))
    return
  }

  if (rule && typeof rule === 'object') {
    for (const [key, sub] of Object.entries(rule)) walk(ctx, sub, [...path, key], targets, lists)
  }
}

// `container` is where a new row goes. With rows present it is their shared
// parent; with none it comes from the seed, which is why an emptied list can
// still be grown back.
function makeList(ctx, path, selector, items, scalar) {
  let container = items[0] ? items[0].parentElement : null
  if (!container) {
    const seed = find(ctx, selector, SEED_OPTS)[0]
    container = seed ? seed.parentElement : null
  }
  return { path, items, container, scalar }
}

function describe(path, el, rule, attr) {
  return { path, el, rule, attr, kind: kindOf(el, attr), icon: iconOf(el, attr) }
}

function kindOf(el, attr) {
  const tag = (el.tagName || '').toUpperCase()
  if (!attr || attr === 'innerHTML') return NON_TEXT_TAGS.has(tag) ? HANDLE : TEXT
  if (attr === 'value' && NATIVE_TAGS.has(tag) && !el.readOnly && !el.disabled) return NATIVE
  return HANDLE
}

function iconOf(el, attr) {
  const tag = (el.tagName || '').toUpperCase()
  if ((!attr || attr === 'innerHTML') && !NON_TEXT_TAGS.has(tag)) return null
  if (tag === 'IMG' || attr === 'srcset') return 'camera'
  if (tag === 'A' && attr === 'href') return 'paperclip'
  return 'pencil'
}

function find(ctx, selector, opts = FIND_OPTS) {
  try {
    return domAdapter.find(ctx, selector, opts)
  } catch (_) {
    // unresolved.js already turns an invalid selector into a named
    // InvalidRuleSelector before the first extract, so by the time the inline
    // view walks, a throw here would be a duplicate of an error the session has
    // already surfaced. Skip the rule instead of taking the whole view down.
    return []
  }
}
