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
import { bindEvents, cssEscape } from '../events.js'
import { autosizeTextarea, enhanceFields, upgradeRichTextRules } from '../enhance.js'
import { applyUnresolvedState } from '../unresolved.js'
import { refreshForm } from '../refresh.js'
import { reensureStyles } from '../shell.js'
import { resolveTargets } from '../targets.js'
import { place } from '../place.js'
import { createInlineLayer } from './inline-layer.js'

const HOST_TAG = 'hypercms-inline'

// The one revealed field, and the wrappers it hides behind. Both are cleared
// before every activation, so at most one path is ever showing.
const ACTIVE_CLASS = 'is-hcms-inline-active'
const ONPATH_CLASS = 'is-hcms-inline-onpath'

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function createInlineView({ doc, pageRoot, opts = {} }) {
  const richText = opts.richText !== false
  let host = null
  let layer = null
  let unbindPage = null
  // Which target the popover is open over, which handle opened it (so focus can
  // go back there), and the placement mode of THIS open. The mode is reset on
  // every activation: place()'s hysteresis is about one popover following its
  // own anchor, and carrying a previous open's mode into a new one would bias
  // the first placement toward wherever the last field happened to sit.
  let activeTarget = null
  let activeHandle = null
  let popMode = null

  return {
    name: 'inline',
    richText,
    ctx: null,
    root: null,
    formRoot: null,
    errorEl: null,
    noticeEl: null,
    countEl: null,

    popEl: null,

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
      this.countEl = host.countEl
      this.popEl = host.popEl

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

      layer = createInlineLayer({
        doc,
        layerEl: host.layerEl,
        // The handle and the page click are two doors to one room.
        onActivate: (target, handle) => this.activate(target, handle),
      })
      layer.setFollower(() => this.placePopover())
      this.bindPage()
      this.syncTargets()
    },

    // Discovery and activation, delegated on the page root rather than bound
    // per target: the target set is rebuilt on every refresh, and per-element
    // listeners would have to be torn down and reattached with it.
    bindPage() {
      const root = this.ctx.pageRoot
      const hostRoot = host.root

      const onPointerOver = (event) => {
        const target = layer && layer.elementToTarget(event.target)
        if (target) layer.showHighlight(target.el)
        else layer?.hideHighlight()
      }
      const onPointerLeave = () => layer?.hideHighlight()

      const onClick = (event) => {
        // The editor's own chrome. A handle already activates through its own
        // listener, and a click in the popover must not close it.
        if (hostRoot.contains(event.target)) return
        const target = layer && layer.elementToTarget(event.target)
        if (!target) {
          this.deactivate()
          return
        }
        // A text target keeps its default click so the caret lands where the
        // person pressed. A link inside one is the exception: while the session
        // is open, following it would navigate away mid-edit.
        const inLink = typeof event.target.closest === 'function' && event.target.closest('a[href]')
        if (inLink || target.kind !== 'text') event.preventDefault()
        this.activate(target)
      }

      const onKeyDown = (event) => {
        if (event.key === 'Escape') this.deactivate()
      }

      root.addEventListener('pointerover', onPointerOver)
      root.addEventListener('pointerleave', onPointerLeave)
      root.addEventListener('click', onClick)
      hostRoot.addEventListener('keydown', onKeyDown)

      unbindPage = () => {
        root.removeEventListener('pointerover', onPointerOver)
        root.removeEventListener('pointerleave', onPointerLeave)
        root.removeEventListener('click', onClick)
        hostRoot.removeEventListener('keydown', onKeyDown)
      }
    },

    // Reveal the form leaf for this target, over the target. Nothing moves in
    // or out of the form tree — the leaf is shown where it already lives — so
    // engine.extract(formRoot) can never be missing a path.
    activate(target, handle) {
      if (!target || !host) return
      if (target.kind === 'text') return this.activateText(target)

      const leaf = revealPath(this, host, target.path.join('.'))
      if (!leaf) {
        this.deactivate()
        return
      }

      activeTarget = target
      activeHandle = handle || null
      popMode = null

      // Unhide BEFORE measuring. A hidden popover has a zero rect, which places
      // it at the clamp instead of beside its anchor — the same trap as the 0px
      // textarea below, which was sized while the popover had no height.
      host.popEl.hidden = false
      autosizeIn(leaf)
      this.placePopover()
      focusFirst(leaf)
    },

    // B2b-3b binds richclay to the page element and edits the text in place.
    activateText() {},

    placePopover() {
      if (!host || !activeTarget || host.popEl.hidden) return
      const win = doc.defaultView
      if (!win) return
      const viewport = { width: win.innerWidth, height: win.innerHeight }
      const anchor = activeTarget.el.getBoundingClientRect()
      const bar = host.popEl.getBoundingClientRect()
      const { mode, x, y } = place({ anchor, bar, viewport, current: popMode })
      popMode = mode
      host.popEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    },

    deactivate() {
      if (!host || (!activeTarget && host.popEl.hidden)) return
      host.popEl.hidden = true
      clearPathClasses(host.root)
      const handle = activeHandle
      activeTarget = null
      activeHandle = null
      popMode = null
      if (handle && doc.contains(handle) && typeof handle.focus === 'function') {
        try { handle.focus({ preventScroll: true }) } catch (_) { handle.focus() }
      }
    },

    // Re-resolve every editable thing on the page and hand the current set to
    // the layer. Runs on mount and on every refresh, because a refresh can add
    // or remove rows and can rebind the rules (refresh.js re-runs prepareRules).
    syncTargets() {
      if (!layer) return
      const ctx = this.ctx
      const { targets } = resolveTargets(ctx.pageRoot, ctx.pageRules)
      layer.setTargets(targets)
      const n = layer.count
      if (this.countEl) {
        this.countEl.textContent = `${n} editable ${n === 1 ? 'area' : 'areas'}`
        this.countEl.hidden = n === 0
      }
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
      } else if (reason === 'undo') {
        refreshForm(this.ctx, { ignoreActiveValue: false })
      } else {
        refreshForm(this.ctx)
      }
      this.syncTargets()
      this.restoreActive()
    },

    // morphForm re-syncs every field from a freshly built form, and that form
    // carries no reveal classes, so an open popover goes blank while still
    // sitting there open. Measured in a browser: the leaf keeps its identity
    // and loses only its class, which is why nothing here rebuilds anything.
    // The same reason enhanceFields and applyErrorState re-run after the morph
    // in refresh.js.
    restoreActive() {
      if (!host || !activeTarget || host.popEl.hidden) return
      // The refresh can take the page element out from under an open popover:
      // a live-sync that deletes the row being edited, say. Its rect would then
      // measure zero and the popover would place against the viewport clamp.
      if (!doc.contains(activeTarget.el)) {
        this.deactivate()
        return
      }
      const leaf = revealPath(this, host, activeTarget.path.join('.'))
      if (!leaf) {
        this.deactivate()
        return
      }
      // After the classes, never before: a textarea measured while its wrapper
      // is still display:none reports a zero scrollHeight and sizes to nothing.
      autosizeIn(leaf)
      this.placePopover()
      // Deliberately no focusFirst: a refresh can land mid-typing, and moving
      // the caret back to the top of the field on every page mutation would
      // make the field unusable.
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
      // Dropped before the close, not restored to: the handle is about to be
      // removed with the layer, and focusing it on the way out would fight the
      // session's own restore of whatever had focus before it opened.
      activeHandle = null
      this.deactivate()
      unbindPage?.()
      unbindPage = null
      layer?.destroy()
      layer = null
      host?.destroy()
      host = null
      this.popEl = null
    },
  }
}

// Show exactly one leaf: mark it active, and mark every wrapper between it and
// the form root, each of which the one-field-at-a-time rule would otherwise
// leave hidden around it. Returns the leaf, or null when the path is not in the
// form. The walk stops AT the form root and never above it: <body> and <html>
// are the author's elements, they reach the saved file, and clearPathClasses
// only queries downward from the host so a class left up there never comes off.
function revealPath(view, host, path) {
  const leaf = view.formRoot &&
    view.formRoot.querySelector(`[data-hcms-path="${cssEscape(path)}"]`)
  clearPathClasses(host.root)
  if (!leaf) return null
  leaf.classList.add(ACTIVE_CLASS)
  for (let el = leaf.parentElement; el; el = el.parentElement) {
    el.classList.add(ONPATH_CLASS)
    if (el === view.formRoot) break
  }
  return leaf
}

function clearPathClasses(root) {
  if (!root) return
  for (const el of root.querySelectorAll(`.${ACTIVE_CLASS}, .${ONPATH_CLASS}`)) {
    el.classList.remove(ACTIVE_CLASS, ONPATH_CLASS)
  }
}

// Every textarea in the revealed leaf was measured while the popover was
// hidden, so it is sitting at height: 0 until it is sized again.
function autosizeIn(leaf) {
  if (leaf.tagName === 'TEXTAREA') autosizeTextarea(leaf)
  leaf.querySelectorAll?.('textarea').forEach(autosizeTextarea)
}

function focusFirst(leaf) {
  const el = leaf.matches?.(FOCUSABLE) ? leaf : leaf.querySelector?.(FOCUSABLE)
  if (!el || typeof el.focus !== 'function') return
  try { el.focus({ preventScroll: true }) } catch (_) { el.focus() }
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
      <div class="hcms-inline-count" hidden></div>
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
    countEl: root.querySelector('.hcms-inline-count'),
    layerEl: root.querySelector('.hcms-inline-layer'),
    popEl: root.querySelector('.hcms-inline-pop'),
    destroy() { root.remove() },
  }
}
