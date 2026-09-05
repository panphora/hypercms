// The inline view: the editing session rendered onto the page itself rather than
// into a side panel.
//
// Three ways to change one field, chosen per target: text is edited in place
// through richclay bound to the page element, a native control on the page is
// left alone to be used, and everything else gets a handle that opens the
// popover holding that field's real form control.
//
// The form is NOT a second representation of the data. It is the same form the
// sidebar builds, mounted inside the inline host with every field hidden; the
// popover shows one field at a time by revealing it in place. Nothing is ever
// moved in or out of the form tree, so engine.extract(formRoot, formRules) can
// never be missing a path. That is the failure mode of the obvious alternative,
// relocating a field node into a popover and back.
//
// A text edit is the one path that does not write the page through the engine:
// richclay has already written it. What the commit does is mirror that value
// into the form leaf and apply as usual, which the engine's compare-before-write
// guard turns into a no-op on the element under the caret.

import { buildForm } from '../form-builder.js'
import {
  bindEvents,
  commit,
  cssEscape,
  extractFormData,
  findLeafField,
  suppressUndo,
  writeFieldValue,
} from '../events.js'
import { autosizeTextarea, enhanceFields, upgradeInlineTextRules } from '../enhance.js'
import { applyUnresolvedState } from '../unresolved.js'
import { refreshForm } from '../refresh.js'
import { reensureStyles } from '../shell.js'
import { resolveTargets } from '../targets.js'
import { place } from '../place.js'
import { platform } from '../platform.js'
import { BOUND_ATTR, markBound, resolveRichClay } from '../richclay-bridge.js'
import { installSnapshotHook } from '../hooks.js'
import { createInlineLayer } from './inline-layer.js'

const HOST_TAG = 'hypercms-inline'

// The one revealed field, and the wrappers it hides behind. Both are cleared
// before every activation, so at most one path is ever showing.
const ACTIVE_CLASS = 'is-hcms-inline-active'
const ONPATH_CLASS = 'is-hcms-inline-onpath'

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'

// The same commands the sidebar's rich-text fields carry, so the two views
// offer the same formatting.
const TOOLBAR = ['bold', 'italic', 'link', 'undo', 'redo']

const HEADING = /^H[1-6]$/

export function createInlineView({ doc, pageRoot, opts = {} }) {
  const richText = opts.richText !== false
  let host = null
  let layer = null
  let unbindPage = null
  // Every richclay instance this view put on a PAGE element, keyed by that
  // element. Bindings are made on the first click and live until the session
  // ends, so a second click on a heading finds its editor rather than building
  // another one.
  const bindings = new Map()
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

    // The form's own rich-text fields are never focused in this view — a rich
    // target is edited on the page element itself — so mounting richclay on
    // them buys nothing and costs five document-level capture listeners each.
    enhanceFormRichText: false,

    // The wider upgrade, not the sidebar's. Every text projection this view
    // binds rich text to has to round-trip through @innerHTML, list rows
    // included, and only this one looks inside an array.
    prepareRules(sourceRules) {
      return richText ? upgradeInlineTextRules(sourceRules, pageRoot) : sourceRules
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
      enhanceFields(host.formRoot, doc, this.enhanceFormRichText)
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
      // A text target is edited where it sits, and only falls through to the
      // popover when it cannot be: no richclay on the page, or a root richclay
      // refuses. Without the fall-through, clicking such a target would do
      // nothing at all.
      if (target.kind === 'text' && this.activateText(target)) return

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

    // Bind richclay to the page element and edit the text where it sits.
    // Returns false when the target cannot be bound, which is the caller's
    // signal to open the popover over it instead.
    //
    // On demand, never at mount: an instance per text target on a page with
    // twenty of them is twenty Squire editors, twenty toolbars and a hundred
    // document-level listeners for one heading someone might click.
    activateText(target) {
      const el = target.el
      const existing = bindings.get(el)
      if (existing) {
        focusEditor(existing)
        return true
      }

      const RichClay = resolveRichClay(doc.defaultView)
      if (typeof RichClay !== 'function') return false

      const editor = construct(this.ctx, RichClay, el)
      if (!editor) return false

      markBound(el)
      // The second trigger for the snapshot hook, and the reliable one: by the
      // time anyone clicks a heading the host client is certainly loaded, even
      // on a page that missed the readiness event at open(). Without the hook
      // the editor's contenteditable reaches the saved file.
      installSnapshotHook()

      const binding = {
        el,
        editor,
        path: target.path.join('.'),
        // What the rule projects, so the commit reads the same thing the engine
        // will write. A text target is either a bare rule (textContent) or one
        // the upgrade rebound (@innerHTML); nothing else is ever text.
        prop: target.attr === 'innerHTML' ? 'innerHTML' : 'textContent',
      }
      // For the undo primitive: richclay stamps no-undo on everything it
      // activates, so from here until unbind the page's undo stack sees nothing
      // that happens in this element.
      binding.oldValue = binding.el[binding.prop]
      bindings.set(el, binding)

      // Toolbar commands mutate the DOM through squire without always firing a
      // native input event, so squire's own signal is the one to commit on.
      const squire = editor.squire
      if (squire && typeof squire.addEventListener === 'function') {
        const onInput = () => acceptInlineTextChange(this.ctx, binding)
        squire.addEventListener('input', onInput)
        binding.detachInput = () => squire.removeEventListener?.('input', onInput)
      }

      // Blur closes an edit session: one undo primitive covering everything
      // typed since the bind (or since the last blur).
      const onBlur = () => recordUndo(binding)
      el.addEventListener('blur', onBlur)
      binding.detachBlur = () => el.removeEventListener('blur', onBlur)

      focusEditor(binding)
      return true
    },

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
      for (const binding of bindings.values()) unbind(this.ctx, binding)
      bindings.clear()
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

// Build the editor, or answer null when this element cannot carry one.
//
// The pause is around the construction and nothing else, and it is not
// belt-and-braces: richclay writes contenteditable, data-richclay and a class
// onto an authored page element, and those three DO reach the mutation hub
// (measured, plan §6). Un-paused they read as a page edit and drive a full form
// refresh; unsuppressed they land on the page's undo stack as three attribute
// writes nobody made.
function construct(ctx, RichClay, el) {
  const handle = ctx && ctx.observerHandle
  handle?.pause()
  try {
    return suppressUndo(() => {
      let editor = null
      try {
        editor = new RichClay(el, {
          inline: true,
          hyperclay: false,
          toolbar: TOOLBAR,
          // A heading is one line by definition; without this, Enter in it
          // creates a second block inside the <h1>.
          ...(HEADING.test(el.tagName) ? { singleLine: true } : null),
        })
      } catch (err) {
        console.warn('[hypercms] richclay activation failed; the field falls back to the popover', err)
        return null
      }
      // richclay's own verdict, which it delivers by returning an instance that
      // never activates: TABLE and its row parts, SCRIPT/STYLE/TEXTAREA/TITLE/
      // IFRAME/NOSCRIPT/XMP, TEMPLATE, and anything outside the HTML namespace.
      // Without this check the person clicks one of those and nothing happens.
      if (editor.unsupported || !editor.active) {
        try { editor.destroy() } catch (_) {}
        return null
      }
      return editor
    })
  } finally {
    handle?.resume()
  }
}

// Mirror the page element into the form leaf, then commit like any other edit.
//
// Per change, not on blur. commit IS the notification — it dispatches
// hcms:change and calls onChange — so a blur-only commit would lose the edit's
// own event to whatever unrelated commit folded the text in first, and then be
// skipped on its fingerprint. The form leaf has to be written first or the
// commit extracts the stale one and puts the old text back on the page.
function acceptInlineTextChange(ctx, { path, el, prop }) {
  const field = findLeafField(ctx.formRoot, path)
  if (!field) return
  writeFieldValue(field, el[prop], ctx.formRoot, path)
  commit(extractFormData(ctx), { path, structural: false }, ctx)
}

// One primitive per edit session, at the boundary that closes it. Everything in
// between is invisible to the page's undo stack: richclay stamps no-undo on
// what it activates and hyper-undo honours it.
//
// Unlike resolveUnobservedProjection this can record an array row, because the
// element is in hand rather than resolved from a document-level selector.
function recordUndo(binding) {
  const { el, prop, oldValue } = binding
  const newValue = el[prop]
  if (newValue === oldValue) return
  binding.oldValue = newValue
  const u = platform('undo')
  if (u && typeof u.recordValue === 'function') {
    u.recordValue(el, { prop, oldValue, newValue })
  }
}

// Close one binding. The undo record comes first: recordValue is a no-op while
// the recorder is paused, and destroy has to run inside a pause.
function unbind(ctx, binding) {
  recordUndo(binding)
  binding.detachInput?.()
  binding.detachBlur?.()
  const handle = ctx && ctx.observerHandle
  handle?.pause()
  try {
    suppressUndo(() => {
      try { binding.editor.destroy() } catch (err) {
        console.warn('[hypercms] richclay teardown failed; editor state may reach the save', err)
      }
      // The bridge only unmarks the snapshot clone. Left on the live element,
      // the marker would tell the next snapshot to strip an element hypercms no
      // longer owns.
      binding.el.removeAttribute(BOUND_ATTR)
    })
  } finally {
    handle?.resume()
  }
}

// The click that opens a text target lands before the element is editable, so
// the browser has put no caret in it. richclay's focus() goes through squire,
// which puts the caret in the text rather than selecting the whole region.
function focusEditor(binding) {
  const { editor, el } = binding
  if (el.ownerDocument.activeElement === el) return
  try {
    if (typeof editor.focus === 'function') editor.focus()
    else el.focus()
  } catch (_) {}
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
