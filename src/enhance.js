// Post-mount field enhancements + the rich-text rule upgrade.
//
// Bare scalar rules bind textContent, which flattens inline HTML (links,
// bold, code) on extract and destroys it on the first apply. When the bound
// page element actually contains child elements, the rule is upgraded to
// @innerHTML so the round-trip preserves markup and the form renders the
// @richtext component (a contenteditable surface, richclay-powered when the
// host page ships richclay). Explicit @prop rules, array rules, and rules
// whose element holds only text are left untouched. Hosts opt out with
// cms.open({ richText: false }).

import { BOUND_ATTR, resolveRichClay } from './richclay-bridge.js'
import { ruleAttrIndex } from 'hyper-html-api/engine'

export function upgradeRichTextRules(rules, pageRoot) {
  if (!pageRoot || rules == null) return rules
  return walk(rules)

  function walk(rule) {
    if (typeof rule === 'string') {
      if (rule.endsWith('[]')) return rule
      if (ruleAttrIndex(rule) !== -1) return rule
      let el = null
      try {
        el = pageRoot.querySelector(rule)
      } catch (_) {
        return rule
      }
      return el && el.children.length > 0 ? rule + '@innerHTML' : rule
    }
    // Array rules ([itemSelector, shape]) scope their inner selectors per
    // item; a document-level querySelector can't answer "does THIS item's
    // element hold markup", so array subtrees are never upgraded.
    if (Array.isArray(rule)) return rule
    if (rule && typeof rule === 'object') {
      const out = Object.create(null)
      for (const [k, v] of Object.entries(rule)) out[k] = walk(v)
      return out
    }
    return rule
  }
}

// The inline view's upgrade. Identical to the one above for a scalar or an
// object rule, and different for the one case that one deliberately refuses:
// the rules inside an array.
//
// The narrow version cannot answer "does THIS row's element hold markup" from a
// document-level querySelector, so it leaves array subtrees alone. Here the item
// elements are resolved first, so the question IS answerable — once per rule
// rather than once per row, because the rule language has no per-row rule. ANY
// row holding markup upgrades the rule for every row, and that costs nothing:
// @innerHTML round-trips plain text unchanged.
//
// It matters because the inline view binds rich text to the row element itself.
// A row left on textContent loses its links and its bold on the first commit.
export function upgradeInlineTextRules(rules, pageRoot) {
  if (!pageRoot || rules == null) return rules
  return walk(rules, [pageRoot])

  function walk(rule, contexts) {
    if (typeof rule === 'string') {
      if (rule.endsWith('[]')) return rule
      if (ruleAttrIndex(rule) !== -1) return rule
      return contexts.some((ctx) => holdsMarkup(ctx, rule)) ? rule + '@innerHTML' : rule
    }
    if (Array.isArray(rule)) {
      const [selector, shape] = rule
      if (typeof selector !== 'string' || !selector) return rule
      const items = queryAll(pageRoot, selector)
      if (!items.length) return rule
      return [selector, walk(shape, items)]
    }
    if (rule && typeof rule === 'object') {
      const out = Object.create(null)
      for (const [k, v] of Object.entries(rule)) out[k] = walk(v, contexts)
      return out
    }
    return rule
  }
}

function holdsMarkup(context, selector) {
  let el = null
  try {
    el = context.querySelector(selector)
  } catch (_) {
    return false
  }
  if (!el) return false
  // An element hypercms has an editor on cannot answer this from its live DOM.
  // Squire wraps the content of a block it binds in a <div>, so a plain
  // paragraph grows a child the instant someone clicks it, and reading that
  // back as author markup upgrades the rule to @innerHTML and turns a
  // plain-text field into a rich-text one just by being clicked. The marker
  // carries the verdict from before the editor arrived, which is the only
  // moment the question had an honest answer. Measured in Chrome: the wrapper
  // lands at t+0 and the upgrade followed on the next observer batch.
  if (el.hasAttribute(BOUND_ATTR)) return el.getAttribute(BOUND_ATTR) === 'rich'
  return el.children.length > 0
}

function queryAll(root, selector) {
  try {
    return [...root.querySelectorAll(selector)]
  } catch (_) {
    return []
  }
}

// Grow a form textarea to fit its content. Browsers with `field-sizing:
// content` handle this in CSS (the theme sets it); everywhere else the
// height is pinned to scrollHeight on populate and on every input.
export function autosizeTextarea(el) {
  if (!el || el.tagName !== 'TEXTAREA') return
  const win = el.ownerDocument.defaultView || (typeof window !== 'undefined' ? window : null)
  if (win && win.CSS && win.CSS.supports && win.CSS.supports('field-sizing: content')) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// Runs after any form (or form fragment) lands in the live DOM: sizes the
// autosize fallback and mounts richclay on rich-text surfaces when the host
// page ships it (window.richclay / window.hyperclay.RichClay). Without
// richclay the surface stays a plain contenteditable bound via @innerHTML,
// which still round-trips markup — richclay only adds the editing chrome.
//
// `formRichText` is the view's, read off view.enhanceFormRichText. The inline
// view passes false: its form fields are never focused (rich text is edited on
// the page element itself), and each instance installs five document-level
// capture listeners that test event.target against their element on every
// keydown, beforeinput, cut, paste and drop. Twenty rich fields is a hundred
// dead listeners. The autosize pass runs either way — the popover shows those
// same fields for every non-text target.
export function enhanceFields(root, doc, formRichText = true) {
  if (!root || !root.querySelectorAll) return
  root.querySelectorAll('textarea[data-hcms-field]').forEach(autosizeTextarea)
  if (formRichText === false) return

  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null)
  const RichClay = resolveRichClay(win)
  if (!RichClay) return

  root.querySelectorAll('[contenteditable][data-hcms-field]').forEach((el) => {
    if (el.__hcmsRichclay) return
    let editor
    try {
      // hyperclay:false keeps the form field out of the page's save/undo
      // machinery (page writes go through commit) and activates the editor
      // regardless of the host's edit-mode signal.
      editor = new RichClay(el, {
        inline: true,
        hyperclay: false,
        toolbar: ['bold', 'italic', 'link', 'undo', 'redo'],
      })
    } catch (err) {
      console.warn('[hypercms] richclay activation failed; field stays plain contenteditable', err)
      return
    }
    el.__hcmsRichclay = editor
    // Toolbar commands mutate the DOM through squire, which doesn't always
    // fire a native input event; mirror squire's own input signal so the
    // form's delegated listener commits the change. Duplicate events are
    // harmless — commits are fingerprinted.
    const squire = editor && editor.squire
    if (squire && typeof squire.addEventListener === 'function') {
      squire.addEventListener('input', () => {
        const Ev = (win && win.Event) || Event
        el.dispatchEvent(new Ev('input', { bubbles: true }))
      })
    }
  })
}
