// The inline view: the editing session rendered onto the page itself rather than
// into a side panel.
//
// This phase mounts the host and the form. The controls that make the page
// visibly editable — handles, the popover, rich text bound to page elements —
// are the next phase, so opening this view currently changes nothing you can
// see. That is intentional: the switch semantics, the teardown and the data
// path are worth proving before any of it is drawn.
//
// The form is NOT a second representation of the data. It is the same form the
// sidebar builds, mounted inside the inline host with every field hidden; the
// popover will later show one field at a time by revealing it in place. Nothing
// is ever moved in or out of the form tree, so engine.extract(formRoot,
// formRules) can never be missing a path. That is the failure mode of the
// obvious alternative, relocating a field node into a popover and back.

import { buildForm } from '../form-builder.js'
import { bindEvents } from '../events.js'
import { enhanceFields, upgradeRichTextRules } from '../enhance.js'
import { applyUnresolvedState } from '../unresolved.js'
import { refreshForm } from '../refresh.js'
import { reensureStyles } from '../shell.js'

const HOST_TAG = 'hypercms-inline'

export function createInlineView({ doc, pageRoot, opts = {} }) {
  const richText = opts.richText !== false
  let host = null

  return {
    name: 'inline',
    richText,
    ctx: null,
    root: null,
    formRoot: null,
    errorEl: null,
    noticeEl: null,

    // Today the same upgrade the sidebar performs. The inline view needs a wider
    // one — every text projection it binds rich text to has to round-trip
    // through @innerHTML, including inside list rows — but that upgrade belongs
    // with the binding that motivates it, in the next phase, not ahead of it.
    prepareRules(sourceRules) {
      return richText ? upgradeRichTextRules(sourceRules, pageRoot) : sourceRules
    },

    mount(initialData) {
      const ctx = this.ctx
      host = mountInlineHost(doc, opts.theme)
      this.root = host.root
      this.formRoot = host.formRoot
      this.errorEl = host.errorEl
      this.noticeEl = host.noticeEl

      const fragment = buildForm({
        pageRules: ctx.pageRules,
        formRules: ctx.formRules,
        data: initialData,
        doc,
      })
      host.formRoot.appendChild(fragment)
      ctx.seeder.seed(host.formRoot)
      enhanceFields(host.formRoot, doc)
      applyUnresolvedState(ctx)

      bindEvents(ctx)
    },

    // `changes` is the mutation batch behind an 'observer' refresh. The inline
    // view will need it to recognise its own edits; nothing reads it yet, and a
    // view must treat an absent batch as "refresh everything".
    refresh(reason, changes) {
      if (reason === 'livesync') {
        // The stylesheet lives in <head>, outside this host, so a full-document
        // morph can strip it. The host itself carries no body classes to
        // restore: unlike the sidebar it does not shift the page.
        reensureStyles(doc)
        refreshForm(this.ctx, { ignoreActiveValue: true })
        return
      }
      if (reason === 'undo') {
        refreshForm(this.ctx, { ignoreActiveValue: false })
        return
      }
      refreshForm(this.ctx)
    },

    // Deliberately NOT a page field. Focusing one would scroll the page and
    // begin an edit nobody asked for. Focusing the host itself puts the next Tab
    // into the session bar without moving the page or starting anything.
    focusOnOpen() {
      if (this.root && typeof this.root.focus === 'function') {
        try { this.root.focus({ preventScroll: true }) } catch (_) { this.root.focus() }
      }
    },

    destroy() {
      host?.destroy()
      host = null
    },
  }
}

function mountInlineHost(doc, theme) {
  // reensureStyles is idempotent: it returns immediately when the stylesheet is
  // already in the document and installs it when it is not, so it doubles as the
  // "ensure" the sidebar's private ensureStyles provides.
  reensureStyles(doc)

  const root = doc.createElement(HOST_TAG)

  // Same theme contract as the sidebar: pixel-quiet is the baked-in look and an
  // optional theme pins light/dark. hcms-shell is what the tokens and every
  // mirk widget rule are scoped to, so without it the popover's fields render
  // as browser defaults; hcms-inline is what keeps the docked-panel geometry
  // off, since that is now scoped to .hcms-panel.
  const themeClass = theme === 'dark' ? ' dark' : theme === 'light' ? ' light' : ''
  root.className = 'hcms-shell pixel-quiet hcms-inline' + themeClass

  // The engine skip selector. Every read and write in hypercms passes
  // { skip: '[data-hcms-shell]' }, so this one attribute is what keeps the
  // engine from walking into the form and treating the CMS's own fields as page
  // content. Reused rather than renamed: it is already honored in seven places
  // across six files, and each of them covers this host for free.
  root.setAttribute('data-hcms-shell', '')

  // Both spellings of "never persist this", because the two clients each have a
  // path that knows only one of them. clayjs strips [no-save] and [save-remove]
  // alike (region-policy.js:82), but hyperclayjs's AI-edit clone path queries
  // [save-remove] exclusively (ai-edit.js:151, :249), so the modern spelling on
  // its own would leave the whole editor sitting in that clone.
  root.setAttribute('no-save', '')
  root.setAttribute('save-remove', '')
  // Out of every snapshot, not just the save: without this, live sync ships the
  // editor to everyone else's browser.
  root.setAttribute('snapshot-remove', '')
  // The CMS's own chrome must never wake autosave, undo or dirty tracking.
  // no-watch implies all three (region-policy.js:184-185), which is why
  // save-ignore and no-trigger-autosave are NOT here: they would be redundant,
  // and a redundant attribute is one a later reader mistakes for load-bearing.
  root.setAttribute('no-watch', '')

  // Focusable for focusOnOpen, but NOT role="dialog" / aria-modal. The sidebar
  // is modal — it traps focus and locks the page. This one is the opposite: the
  // page stays fully usable while it is open, which is the entire point.
  root.setAttribute('tabindex', '-1')

  root.innerHTML = `
    <div class="hcms-inline-bar">
      <div class="hcms-inline-notice" role="status" hidden></div>
      <div class="hcms-inline-error" role="alert" hidden></div>
    </div>
    <div class="hcms-inline-layer"></div>
    <div class="hcms-inline-pop" hidden><div data-hcms-form-root class="hcms-form"></div></div>
  `

  doc.body.appendChild(root)

  return {
    root,
    formRoot: root.querySelector('[data-hcms-form-root]'),
    noticeEl: root.querySelector('.hcms-inline-notice'),
    errorEl: root.querySelector('.hcms-inline-error'),
    destroy() { root.remove() },
  }
}
