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
  onAdd,
  onMove,
  requestRemove,
  suppressUndo,
  writeFieldValue,
} from '../events.js'
import { autosizeTextarea, enhanceFields, upgradeInlineTextRules } from '../enhance.js'
import { applyUnresolvedState } from '../unresolved.js'
import { refreshForm } from '../refresh.js'
import { clearSessionOpen, markSessionOpen, reensureStyles } from '../shell.js'
import { isAnchorable } from '../anchor.js'
import { resolveTargets } from '../targets.js'
import { place } from '../place.js'
import { platform } from '../platform.js'
import {
  BOUND_ATTR,
  BOUND_ID_ATTR,
  RC_OWNED_ATTR,
  markBound,
  registerBinding,
  releaseBinding,
  resolveRichClay,
  stripOrphanEditorState,
} from '../richclay-bridge.js'
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

let nextBoundId = 0

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

  // Build one binding: the editor, the marker, the snapshot hook, and the two
  // listeners that turn typing into commits and blur into one undo primitive.
  // Returns it, or null when the element cannot carry an editor. Shared by the
  // first click and by the repair after a morph, so a rebound element comes back
  // with everything the first bind gave it.
  function bindText(ctx, el, path, prop, carry) {
    const RichClay = resolveRichClay(doc.defaultView)
    if (typeof RichClay !== 'function') return null

    // A rebind inherits what the element looked like before richclay first
    // touched it. Re-deriving these from the DOM reads the editor's own
    // normalisation back as the author's markup, and the peer's morph as
    // proof there was never an author's editor here.
    const inherited = carry || {}
    // Before richclay touches it. Squire normalises the markup it is handed:
    // measured in Chrome, binding a heading rewrote
    //   <h1>A page that edits <em>itself</em></h1>
    // into
    //   <h1><div>A page that edits <i>itself</i></div></h1>
    // and that reaches the saved file. Someone who clicks a heading, reads it
    // and presses Escape has changed nothing and must not have changed their
    // document either, so an untouched session puts this back verbatim.
    const originalHTML = inherited.originalHTML ?? el.innerHTML
    const richClayIsOurs = inherited.richClayIsOurs ?? !el.hasAttribute('data-richclay')
    // richclay's constructor returns the existing instance for an element that
    // already has one (richclay.js:85-86), so on a page where the author mounted
    // their own editor this is theirs, not ours. Adopt it for the session and
    // never tear it down: destroying it would take away an editor hypercms did
    // not create and cannot put back. data-richclay-active is richclay's own
    // "there is a live editor here" flag, written by setupEditorAttributes.
    const adopted = inherited.adopted ?? el.getAttribute('data-richclay-active') === 'true'
    // The undo baseline, read before richclay touches the element for the same
    // reason as originalHTML above: read after construct it holds Squire's
    // normalisation, and undoing then writes <div> wrappers and <i> tags into
    // the author's file. richclay stamps no-undo on what it activates, so from
    // the bind until unbind this is the only record the page's undo stack gets.
    // Never inherited: a rebind's baseline is the value on the page now.
    const oldValue = readPageValue(el, prop)
    const editor = construct(ctx, RichClay, el, prop, richClayIsOurs)
    if (!editor) return null

    // The rule's projection, not this element's children. A marker is only ever
    // read back to answer "should the rule be rich", and for an array the rule
    // is shared by every row: a plain row under a rich rule would otherwise
    // report plain and downgrade the whole rule the moment the row that proved
    // it rich is deleted. Recording the projection also states the frozen
    // projection rule directly instead of approximating it.
    markBound(el, prop === 'innerHTML', richClayIsOurs)
    const boundId = String(++nextBoundId)
    el.setAttribute(BOUND_ID_ATTR, boundId)
    // The second trigger for the snapshot hook, and the reliable one: by the
    // time anyone clicks a heading the host client is certainly loaded, even
    // on a page that missed the readiness event at open(). Without the hook
    // the editor's contenteditable reaches the saved file.
    installSnapshotHook()

    const binding = {
      el,
      editor,
      path,
      prop,
      boundId,
      originalHTML,
      oldValue,
      richClayIsOurs,
      adopted,
      // Set by squire's input event, which is the only signal that someone
      // actually edited. Comparing the projected value cannot answer this:
      // the normalisation above changes innerHTML at bind time, before anyone
      // has typed anything.
      dirty: false,
      written: false,
      // Whether the pre-bind markup may go back. Adopted means the editor is the
      // author's and its normalisation is theirs to keep; dirty means they
      // typed; written means a commit changed this path.
      restorable() {
        return !this.adopted && !this.dirty && !this.written
      },
      lastEdited: undefined,
    }
    bindings.set(el, binding)
    registerBinding(boundId, binding)

    // Toolbar commands mutate the DOM through squire without always firing a
    // native input event, so squire's own signal is the one to commit on.
    const squire = editor.squire
    if (squire && typeof squire.addEventListener === 'function') {
      const onInput = () => {
        binding.dirty = true
        // What this person produced, captured while the DOM still holds it.
        // recordUndo reads this rather than the element, because at the one
        // boundary that matters the element no longer holds their work.
        binding.lastEdited = readPageValue(el, binding.prop)
        acceptInlineTextChange(ctx, binding)
      }
      squire.addEventListener('input', onInput)
      binding.detachInput = () => squire.removeEventListener?.('input', onInput)
    }

    // Blur closes an edit session: one undo primitive covering everything
    // typed since the bind (or since the last blur).
    const onBlur = () => recordUndo(binding)
    el.addEventListener('blur', onBlur)
    binding.detachBlur = () => el.removeEventListener('blur', onBlur)

    return binding
  }

  return {
    name: 'inline',
    richText,
    ctx: null,
    root: null,
    formRoot: null,
    errorEl: null,
    noticeEl: null,
    countEl: null,
    handoffEl: null,
    handoffCountEl: null,

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

    bindText(el, path, prop, carry) { return bindText(this.ctx, el, path, prop, carry) },

    mount(initialData) {
      const ctx = this.ctx
      host = mountInlineHost(doc, opts.theme)
      this.root = host.root
      this.formRoot = host.formRoot
      this.errorEl = host.errorEl
      this.noticeEl = host.noticeEl
      this.countEl = host.countEl
      this.handoffEl = host.handoffEl
      this.handoffCountEl = host.handoffCountEl
      this.popEl = host.popEl
      // A body class is a page edit unless it is suppressed, the same reason
      // the sidebar wraps its own mount.
      suppressUndo(() => markSessionOpen(doc))

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
        onListAction: (op) => this.listAction(op),
      })
      layer.setFollower(() => this.placePopover())
      host.toggleEl.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.toggleControls()
      })
      // There is no drawer. What a field with no visual representation gets is
      // the count above and this one tap out to the view that edits everything.
      // The switch carries the session's options across (hypercms.js open()), so
      // the sidebar comes up on the same page root with the same callbacks.
      host.handoffEl.querySelector('[data-hcms-open-view]').addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        ctx.onViewRequested?.('sidebar')
      })
      this.bindPage()
      this.syncTargets()
    },

    // Add, remove and reorder, every one of them acting on the FORM row and
    // letting the commit move the page.
    //
    // Moving the page row here instead would corrupt the rollback:
    // captureChildren runs INSIDE applyWithRollback (apply-loop.js:39), after
    // the caller has already mutated, so a failed apply would restore the
    // post-move DOM and the reorder would never come undone. Moving the form row
    // first means the commit snapshots the page container still in its pre-move
    // state. Routing through requestRemove rather than onRemove is the same kind
    // of inheritance: the consent modal an object array raises is that path's,
    // and reimplementing it here would be a second policy to keep in step.
    listAction({ action, list, index, row }) {
      const ctx = this.ctx
      const arrayPath = list.path.join('.')
      const arrayEl = ctx.formRoot.querySelector(`[data-hcms-path="${cssEscape(arrayPath)}"]`)
      if (!arrayEl) return
      if (action === 'add') {
        onAdd(arrayPath, ctx)
        return
      }
      // The strip was stamped with the index its row held when the layer was
      // last built, and a refresh trails a structural change by an observer
      // batch. Re-resolve from the row element so a second click inside that
      // window acts on the row under the pointer rather than on whatever has
      // since taken its number.
      const rowIndex = row ? liveRowIndex(ctx, arrayPath, row) : index
      // A row that is no longer in the list was removed by the click before this
      // one, and its strip is still on screen because the refresh trails the
      // change. There is nothing to act on, and the number it was stamped with
      // now belongs to the row that moved up into its place, so doing nothing is
      // the only correct outcome.
      if (rowIndex === -1) return
      const formRow = formRowAt(arrayEl, rowIndex)
      if (!formRow) return
      if (action === 'remove') {
        requestRemove(formRow, ctx)
        // The commit has already moved the page and the form. Reconcile now
        // rather than on the debounced refresh: until this runs, every binding
        // below the change still holds the numeric path it had before it, and a
        // keystroke inside that window commits into the wrong row.
        this.syncTargets()
        return
      }
      onMove(formRow, action === 'move-up' ? -1 : 1, ctx)
      this.syncTargets()
    },

    toggleControls() {
      if (!layer || !host) return
      const hidden = !layer.controlsHidden
      layer.setControlsHidden(hidden)
      host.toggleEl.setAttribute('aria-pressed', String(hidden))
      const label = host.toggleEl.querySelector('.mirk-button__label')
      if (label) label.textContent = hidden ? 'Show controls' : 'Hide controls'
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
        // One pointer path, two questions. The second: a list row too small to
        // hold its own strip shows it only while the pointer is on that row,
        // and the raw element is what answers that — the strip is drawn over
        // its row and is not a target, so a resolved target cannot say so.
        layer?.setHoveredRow(event.target)
      }
      const onPointerLeave = () => {
        layer?.hideHighlight()
        layer?.setHoveredRow(null)
      }

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

      // A commit naming this element's path means something wrote content to it,
      // and the pre-bind markup must never go back over that. richclay's
      // rewriting commits nothing, which is precisely what makes this the right
      // signal and the text comparison it replaces the wrong one: that could not
      // tell an API write that kept the same words from the editor's own work.
      //
      // On the document because the event is dispatched on the host, which does
      // not sit inside the page root. detail.pageRoot is what the payload
      // carries it for.
      const onChanged = (event) => {
        const detail = event.detail
        if (!detail || detail.pageRoot !== this.ctx.pageRoot || !detail.path) return
        for (const binding of bindings.values()) {
          if (binding.path === detail.path) binding.written = true
        }
      }

      root.addEventListener('pointerover', onPointerOver)
      root.addEventListener('pointerleave', onPointerLeave)
      root.addEventListener('click', onClick)
      hostRoot.addEventListener('keydown', onKeyDown)
      doc.addEventListener('hcms:change', onChanged)

      unbindPage = () => {
        root.removeEventListener('pointerover', onPointerOver)
        root.removeEventListener('pointerleave', onPointerLeave)
        root.removeEventListener('click', onClick)
        hostRoot.removeEventListener('keydown', onKeyDown)
        doc.removeEventListener('hcms:change', onChanged)
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

      const binding = bindText(this.ctx, el, target.path.join('.'), projectionOf(target))
      if (!binding) return false

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
      const { targets, lists } = resolveTargets(ctx.pageRoot, ctx.pageRules)
      layer.setTargets(targets, lists)
      const byEl = reconcileBindings(this, bindings, targets, doc)
      // An open popover holds its path the same way a binding does. Re-point it
      // at the target that now stands for the element it is anchored over, or
      // the popover keeps editing the row that inherited its old index.
      if (activeTarget) {
        const fresh = byEl.get(activeTarget.el)
        // Gone from the rules, so the popover would keep writing its old path
        // from an element nothing reads. Close it rather than leave it editing a
        // field that is not there any more.
        if (fresh) activeTarget = fresh
        else this.deactivate()
      }
      sweepOrphanEditors(this.ctx, bindings, doc)
      const n = layer.count
      if (this.countEl) {
        this.countEl.textContent = `${n} editable ${n === 1 ? 'area' : 'areas'}`
        this.countEl.hidden = n === 0
      }
      // Every ruled field with no anchorable element, whatever its kind: a
      // permanently hidden metadata span and a target inside a closed tab are
      // byte-identical to the browser, so this is a live count and not a
      // classification. Read off the same floor the handles clear rather than a
      // second rule that could disagree with it.
      const away = targets.reduce((total, target) => total + (isAnchorable(target.el) ? 0 : 1), 0)
      if (this.handoffEl) {
        this.handoffCountEl.textContent = away === 0
          ? ''
          : `${away} ${away === 1 ? "field isn't" : "fields aren't"} visible right now.`
        // At zero the bar says nothing at all, rather than "0 fields".
        this.handoffEl.hidden = away === 0
      }
    },

    // `changes` is the mutation batch behind an 'observer' refresh. The inline
    // view will need it to recognise its own edits; nothing reads it yet, and a
    // view must treat an absent batch as "refresh everything".
    refresh(reason, changes) {
      if (reason === 'livesync') {
        // The stylesheet lives in <head> and the session class on <body>, both
        // outside this host, so a full-document morph can strip either. The page
        // shift is still the sidebar's alone: this view adds no geometry class.
        reensureStyles(doc)
        markSessionOpen(doc)
        refreshForm(this.ctx, { ignoreActiveValue: true })
      } else if (reason === 'undo') {
        refreshForm(this.ctx, { ignoreActiveValue: false })
      } else {
        refreshForm(this.ctx)
      }
      this.syncTargets()
      // Both reasons put a morph over the page, and a morph takes the editor's
      // attributes off every element this view has bound.
      if (reason === 'livesync' || reason === 'undo') this.rebindText(reason)
      this.restoreActive()
    },

    // A live-sync morph re-syncs the page against the incoming copy, and this
    // view's own snapshot hook is what makes that copy clean: contenteditable,
    // data-richclay, no-undo and the bound marker all come back off an element
    // a live editor is still pointing at. An undo replaying those same
    // attribute writes in reverse does the same thing. Repair the pairing after
    // the morph, for the reason restoreActive repairs the popover after it.
    rebindText(reason) {
      // On the undo path the value did not change because anyone typed: the undo
      // itself reverted it. Recording that would push a primitive describing the
      // undo's own effect, and a fresh record clears the redo stack, so the
      // person who just pressed undo could not press redo. Measured against the
      // recorder, which fires its handlers outside its own pause.
      const record = reason !== 'undo'
      for (const [el, binding] of [...bindings]) {
        // Replaced outright: no key matched, so the incoming element took this
        // one's place. What they typed before the sync is already committed and
        // still belongs on the undo stack, but the node it was typed into is off
        // the page — nothing is put back onto it, and the incoming markup stands.
        if (!doc.contains(el)) {
          unbind(this.ctx, binding, { restore: false, record })
          bindings.delete(el)
          continue
        }
        if (el.hasAttribute(BOUND_ATTR)) {
          const current = readPageValue(el, binding.prop)
          // An undo or a sync that did not reach this element leaves its value
          // exactly as the person typed it, and their edit is still pending.
          // Only an element the change actually moved needs a fresh baseline,
          // and only then is what they typed gone with it.
          if (current !== binding.lastEdited) {
            // Survived with the marker intact, so the editor is still live and
            // still correct; only the value moved under it. Its baseline is now
            // the value the morph reverted away from, and left stale the next
            // blur records that revert as a fresh edit — which clears the redo
            // stack, so the person who pressed undo cannot press redo.
            binding.oldValue = current
            // The value they had typed is gone with the undo, so it must not
            // survive as a pending edit: left set, the next blur would record it
            // against the new baseline and clear the redo stack, which is the
            // defect the line above exists to prevent, arriving one step later.
            binding.lastEdited = undefined
          }
          continue
        }
        // Survived, but the page no longer treats it as ours. Close the session
        // that was open, one primitive for what they typed, and open a fresh one
        // on the markup as it now stands. Deliberately no restore: the element
        // holds the incoming copy's markup, and putting a pre-morph snapshot
        // back over it would undo somebody else's edit.
        const hadFocus = doc.activeElement === el
        unbind(this.ctx, binding, { restore: false, record })
        bindings.delete(el)
        const rebound = bindText(this.ctx, el, binding.path, binding.prop, {
          richClayIsOurs: binding.richClayIsOurs,
          adopted: binding.adopted,
        })
        // Only the element they were actually in: a sync that arrives while
        // someone is typing must not pull the caret into a different one.
        if (rebound && hadFocus) focusEditor(rebound)
      }
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
      clearSessionOpen(doc)
      this.popEl = null
      this.handoffEl = null
      this.handoffCountEl = null
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
function construct(ctx, RichClay, el, prop, richClayIsOurs) {
  const handle = ctx && ctx.observerHandle
  handle?.pause()
  try {
    return suppressUndo(() => {
      let editor = null
      try {
        editor = new RichClay(el, {
          inline: true,
          hyperclay: false,
          // Formatting is offered only where the rule can keep it. A textContent
          // projection commits the element's text, so a bold applied through this
          // toolbar would be flattened by the very next commit — the button would
          // be promising something the rule cannot hold. That is every scalar
          // array row (enhance.js never upgrades a "[]" rule) and everything at
          // all under richText: false. richclay reads false as "no toolbar"
          // (resolveToolbarControls, richclay.js:1007).
          toolbar: prop === 'innerHTML' ? TOOLBAR : false,
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
        // Only tear down an instance this call is responsible for. On an
        // element the author opted in on, richclay owns the mount and the
        // instance is theirs; destroying it takes away an editor hypercms
        // did not create and cannot put back.
        if (richClayIsOurs) { try { editor.destroy() } catch (_) {} }
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
  writeFieldValue(field, readPageValue(el, prop), ctx.formRoot, path)
  commit(extractFormData(ctx), { path, structural: false }, ctx)
}

// What the engine will read back out of this element. The DOM adapter trims a
// text projection (hyper-html-api dom.js text()), so a raw textContent read puts
// a value in the form that the page can never extract, the mirror disagrees on
// every commit, and the engine rewrites the text node the caret is sitting in.
function readPageValue(el, prop) {
  return prop === 'innerHTML' ? el.innerHTML : (el.textContent || '').trim()
}

// One primitive per edit session, at the boundary that closes it. Everything in
// between is invisible to the page's undo stack: richclay stamps no-undo on
// what it activates and hyper-undo honours it.
//
// Unlike resolveUnobservedProjection this can record an array row, because the
// element is in hand rather than resolved from a document-level selector.
function recordUndo(binding) {
  const { el, prop, oldValue, lastEdited } = binding
  // Deliberately not the element. A live-sync morph replaces the content before
  // this boundary is reached, so reading the DOM here records a peer's edit
  // under this person's name and undo reverts THEIR change. No local edit means
  // no primitive at all, which is the same fix from the other side: an untouched
  // binding that a morph wrote through must not put anything on the stack.
  const newValue = lastEdited
  if (newValue === undefined || newValue === oldValue) return
  binding.oldValue = newValue
  const u = platform('undo')
  if (!u || typeof u.recordValue !== 'function') return
  // hyper-undo drops recordValue while its recorder is paused (scope.js:190),
  // and both boundaries that close a binding sit inside a pause somebody else
  // opened: teardownSession suppresses around destroy (session.js:225), and
  // clayjs dispatches clay:sync-applied inside its mutation pause, which pauses
  // undo too (live-sync.js:1357, mutation.js:132). The values are read here and
  // the record is posted after those finally-blocks have run, so the edit keeps
  // its place on the stack instead of vanishing at the moment it ends.
  //
  // A record against an element the morph took off the page would be an entry
  // that replays into nothing and still costs an undo press, so it is skipped.
  if (u.isPaused) queueMicrotask(() => { if (el.isConnected) u.recordValue(el, { prop, oldValue, newValue }) })
  else u.recordValue(el, { prop, oldValue, newValue })
}

// Close one binding. The undo record comes first: recordValue is a no-op while
// the recorder is paused, and destroy has to run inside a pause.
//
// `restore` is what separates ending a session from repairing one. Ending it
// puts the author's markup back when nobody typed; repairing after a morph must
// not, because the markup on the element is the incoming copy's and a pre-morph
// snapshot written back over it would undo somebody else's edit.
function unbind(ctx, binding, { restore = true, record = true } = {}) {
  if (record) recordUndo(binding)
  binding.detachInput?.()
  binding.detachBlur?.()
  const handle = ctx && ctx.observerHandle
  handle?.pause()
  try {
    suppressUndo(() => {
      if (!binding.adopted) {
        try { binding.editor.destroy() } catch (err) {
          console.warn('[hypercms] richclay teardown failed; editor state may reach the save', err)
        }
        // destroy() takes data-richclay off only on richclay 0.5.0, which tracks
        // who wrote it. Neither vendored 0.4.0 copy removes that attribute
        // anywhere, so without this the mount selector stays on the live element
        // and the next save carries it into the author's file, exactly what the
        // clone-side removal exists to prevent. Never on an element the author
        // opted in on: there the attribute is theirs.
        if (binding.richClayIsOurs) binding.el.removeAttribute('data-richclay')
      }
      // The bridge only unmarks the snapshot clone. Left on the live element,
      // the marker would tell the next snapshot to strip an element hypercms no
      // longer owns, and the provenance flag beside it would reach the file.
      binding.el.removeAttribute(BOUND_ATTR)
      binding.el.removeAttribute(RC_OWNED_ATTR)
      binding.el.removeAttribute(BOUND_ID_ATTR)
      releaseBinding(binding.boundId)
      // Nobody typed, so the only difference between this element and the one
      // the author wrote is the editor's own normalisation. Put their markup
      // back. Inside the pause and the undo suppression with the teardown, so
      // the restore is not itself an edit.
      if (restore && binding.restorable()) {
        binding.el.innerHTML = binding.originalHTML
      }
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

// resolveTargets re-walks the page on every refresh, so it is the only authority
// on which path reaches which element right now. Both a binding and an open
// popover cache a path from the moment they were made: a move or a remove
// renumbers every row after it, and without this, typing into the row you just
// moved up writes into the row that took its old index.
//
// The projection is re-read for the same reason. refreshForm re-runs
// prepareRules every refresh, so a rule upgrades to @innerHTML the moment its
// element gains markup. A binding frozen on textContent would flatten every tag
// in that element on the next keystroke, including the node under the caret.
function reconcileBindings(view, bindings, targets, doc) {
  const byEl = new Map()
  for (const target of targets) byEl.set(target.el, target)

  for (const [el, binding] of [...bindings]) {
    const target = byEl.get(el)
    if (!target) {
      // The rules no longer name this element. Left bound it stays editable with
      // nowhere of its own to write, and every keystroke commits the old path,
      // so the text lands in whatever element the rule now points at. End the
      // session on it instead. restore is on because nobody has taken the
      // element away: if it was never typed into, the author's markup goes back.
      unbind(view.ctx, binding, { restore: true })
      bindings.delete(el)
      continue
    }
    binding.path = target.path.join('.')
    const prop = projectionOf(target)
    if (prop === binding.prop) continue
    // The projection changed under a live editor. Rebuilding it is the only way
    // the toolbar, the commit and the undo baseline end up describing the same
    // half of the element.
    const hadFocus = doc.activeElement === el
    unbind(view.ctx, binding, { restore: false })
    bindings.delete(el)
    const rebound = view.bindText(el, binding.path, prop, {
      richClayIsOurs: binding.richClayIsOurs,
      adopted: binding.adopted,
      originalHTML: binding.originalHTML,
    })
    if (rebound && hadFocus) focusEditor(rebound)
  }

  return byEl
}

// A text target is either a bare rule (textContent) or one prepareRules rebound
// to @innerHTML. Nothing else is ever text.
function projectionOf(target) {
  return target.attr === 'innerHTML' ? 'innerHTML' : 'textContent'
}

// Runs on every sync, because a structural apply is exactly when the engine
// clones, and a refresh is what follows one.
function sweepOrphanEditors(ctx, bindings, doc) {
  for (const el of ctx.pageRoot.querySelectorAll(`[${BOUND_ATTR}]`)) {
    if (bindings.has(el)) continue
    const handle = ctx.observerHandle
    handle?.pause()
    try {
      suppressUndo(() => stripOrphanEditorState(el, doc.defaultView))
    } finally {
      handle?.resume()
    }
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
      <div class="hcms-inline-handoff" hidden>
        <span class="hcms-inline-handoff-count"></span>
        <button type="button" class="hcms-inline-handoff-open mirk-button mirk-button--small" data-hcms-open-view="sidebar">
          <span class="mirk-button__label">Edit in the sidebar</span>
        </button>
      </div>
      <button type="button" class="hcms-inline-toggle mirk-button mirk-button--small" data-hcms-controls-toggle aria-pressed="false">
        <span class="mirk-button__label">Hide controls</span>
      </button>
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
    handoffEl: root.querySelector('.hcms-inline-handoff'),
    handoffCountEl: root.querySelector('.hcms-inline-handoff-count'),
    layerEl: root.querySelector('.hcms-inline-layer'),
    popEl: root.querySelector('.hcms-inline-pop'),
    toggleEl: root.querySelector('[data-hcms-controls-toggle]'),
    destroy() { root.remove() },
  }
}

// The form row a page row stands for. onMove and requestRemove both take a form
// item element and find their array back from it, so this resolves exactly what
// they expect to be handed: the array's own items slot, indexed. Deliberately
// not a path query — the row's data-hcms-path is restamped by every structural
// operation, and the slot's child order is the thing those two read.
function formRowAt(arrayEl, index) {
  const slot = arrayEl.querySelector('.hcms-array-items')
  if (!slot) return null
  const rows = slot.querySelectorAll(':scope > [data-hcms-card], :scope > [data-hcms-array-item]')
  return rows[index] || null
}

// Where this page row sits in its list right now, or -1 when the row is no
// longer in it (a remove that already landed).
function liveRowIndex(ctx, arrayPath, row) {
  const { lists } = resolveTargets(ctx.pageRoot, ctx.pageRules)
  const list = lists.find((candidate) => candidate.path.join('.') === arrayPath)
  return list ? list.items.indexOf(row) : -1
}
