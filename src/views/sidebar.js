// The sidebar view: the shell panel and the form inside it. Everything here is
// chrome for one way of rendering a session — the session core (src/session.js)
// owns the page, the rules and the data.

import { mountShell } from '../shell.js'
import { buildForm } from '../form-builder.js'
import { bindEvents, suppressUndo } from '../events.js'
import { enhanceFields, upgradeRichTextRules } from '../enhance.js'
import { applyUnresolvedState } from '../unresolved.js'
import { refreshForm } from '../refresh.js'

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function createSidebarView({ doc, pageRoot, opts = {} }) {
  // Rich-text upgrade (default on). Opt out with cms.open({ richText: false }).
  const richText = opts.richText !== false
  let shell = null

  return {
    name: 'sidebar',
    richText,
    ctx: null,
    root: null,
    formRoot: null,
    errorEl: null,
    noticeEl: null,

    prepareRules(sourceRules) {
      return richText ? upgradeRichTextRules(sourceRules, pageRoot) : sourceRules
    },

    mount(initialData) {
      const ctx = this.ctx
      // Suppress undo around mountShell: it toggles chrome-only classes on
      // document.body (hcms-open, etc.) which would otherwise land as undoable
      // page edits. The shell subtree itself is already filtered via save-ignore.
      shell = suppressUndo(() => mountShell({
        mountTo: opts.mountTo || doc.body,
        side: opts.side || 'right',
        overlay: !!opts.overlay,
        showSaveButton: !!opts.showSaveButton,
        title: opts.title,
        eyebrow: opts.eyebrow,
        theme: opts.theme,
        doc,
      }))
      this.root = shell.root
      this.formRoot = shell.formRoot
      this.errorEl = shell.errorEl
      this.noticeEl = shell.noticeEl

      const fragment = buildForm({
        pageRules: ctx.pageRules,
        formRules: ctx.formRules,
        data: initialData,
        doc,
      })
      shell.formRoot.appendChild(fragment)
      ctx.seeder.seed(shell.formRoot)
      enhanceFields(shell.formRoot, doc)
      applyUnresolvedState(ctx)

      bindEvents(ctx)
    },

    refresh(reason) {
      if (reason === 'livesync') {
        // A full-document morph can wipe the shell's <head> stylesheet and the
        // <body> chrome classes (both live outside the save-ignore shell subtree).
        // Re-assert them before re-extracting.
        shell?.restoreChrome?.()
        refreshForm(this.ctx, { ignoreActiveValue: true })
        return
      }
      if (reason === 'undo') {
        refreshForm(this.ctx, { ignoreActiveValue: false })
        return
      }
      refreshForm(this.ctx)
    },

    // Move focus into the shell — survives close+restore via previouslyFocused.
    focusOnOpen() {
      const target = this.root && this.root.querySelector(FOCUSABLE)
      if (target && typeof target.focus === 'function') target.focus()
    },

    destroy() {
      shell?.destroy()
      shell = null
    },
  }
}
