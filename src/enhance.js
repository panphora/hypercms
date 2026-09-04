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

import { resolveRichClay } from './richclay-bridge.js'
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
export function enhanceFields(root, doc) {
  if (!root || !root.querySelectorAll) return
  root.querySelectorAll('textarea[data-hcms-field]').forEach(autosizeTextarea)

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
