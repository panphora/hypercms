// The visible layer of the inline view: one handle per non-text target, one
// ↑ ↓ ✕ strip per list row and one Add per list, drawn over the page and kept in
// step with it.
//
// Two mechanisms, kept deliberately separate, because merging them was the first
// draft's mistake (plan §3.1.2 and §3.5). An IntersectionObserver answers "is
// this anchor showing", and it accounts for an overflow:hidden ancestor clipping
// an anchor that is still inside the viewport, which no viewport comparison can
// see. It does NOT fire when a visible element merely moves, so it can never
// drive placement. Placement is a separate frame-coalesced pass driven by scroll
// and resize.
//
// The list controls live here rather than in a layer of their own so they are
// placed by that same pass and hidden by that same observer. They carry no
// knowledge of the form: a click reports which list and which row it belongs to
// and the view does the rest, because acting on a page row from here would move
// the page outside the rollback snapshot (inline.js listAction).

import { placeHandle } from '../place.js'
import { isAnchorable } from '../anchor.js'

// The strip, in the order it reads. Spelled out as data because the first/last
// rule below is about which of these three a row gets, and a rule is easier to
// see against a list than against three blocks of markup.
const ROW_ACTIONS = [
  ['move-up', '↑', 'Move up'],
  ['move-down', '↓', 'Move down'],
  ['remove', '✕', 'Remove'],
]

// A list control is pinned INSIDE its anchor's top-right corner. 'corner'
// because place.js's adaptive rule measures the anchor against the control and
// sends a small one BESIDE it, which is right for a handle floating near a link
// and wrong for a strip that belongs to a row: measured in Chrome, every card
// row shorter than ~47px put its strip wholly outside the card. inset 0 because
// a handle straddles its corner on purpose and a strip must not — §3.3 asks for
// a strip pinned to the card's top-right, inside it.
const CONTROL_PLACEMENT = { prefer: 'corner', inset: 0 }

// Can this row carry its own strip? Measured against the row's real box, never
// guessed from its tag. Three buttons are ~84px wide at minimum and a run of
// pills has a ~60px pitch, so a strip drawn on every such row would cover its
// neighbours wherever it was put — geometry, not a placement bug.
function hosts(row, strip) {
  return strip.width <= row.width && strip.height <= row.height
}

export function createInlineLayer({ doc, layerEl, onActivate, onListAction }) {
  const win = doc.defaultView
  // Every positioned thing the layer draws, whatever kind: a handle, a row
  // strip, a list's Add. One array, because all three are placed by one pass.
  let placements = []
  // Anchor element -> the placements riding on it. One element can carry two:
  // in a scalar array of images, every row is also a handle target.
  let index = new Map()
  // The count is the number of HANDLES, which is what the session bar reports as
  // editable areas. A strip is not an area of its own; it operates on one.
  let handleCount = 0
  // Every resolved target, keyed by the page element it sits on — not just the
  // ones that got a handle. The highlight and the page-level click have to
  // reach a text or a native target too, and neither of those has an entry.
  let targets = new Map()
  let observer = null
  let frame = 0
  let listening = false
  let follower = null
  let highlighted = null
  // The rows showing a strip they are too small to host: the one under the
  // pointer, and the one holding focus. Two slots rather than one so a strip
  // does not vanish from under the keyboard while the pointer rests elsewhere;
  // only ever ONE is drawn (hover wins), so two strips can never collide.
  let hoveredRow = null
  let focusedRow = null
  // Row element AND its strip node, both mapped to the row. The strip is drawn
  // over the row it belongs to, so pointing at the strip has to read as
  // pointing at the row or it would hide under the pointer that came for it.
  let rowOwners = new Map()
  // A toggle, not a mode: the strips and the Adds go away and the handles stay,
  // so someone reading a page they are editing can see it without leaving the
  // session. Layer state rather than per-placement state, so it survives the
  // rebuild every refresh does.
  let controlsHidden = false

  // ONE reusable outline, moved to whatever is hovered. Marking each target
  // with an attribute instead would write editor state into an authored
  // element, which is the class of problem richclay-bridge.js exists to undo.
  const highlight = doc.createElement('div')
  highlight.className = 'hcms-inline-highlight'
  highlight.hidden = true
  highlight.setAttribute('aria-hidden', 'true')
  layerEl.appendChild(highlight)

  function schedule() {
    if (frame || !win) return
    // The same degradation toggle.js applies in scheduleSurface: a window with
    // no requestAnimationFrame gets a synchronous pass instead of a crash on
    // mount. Every browser has it; a non-visual jsdom does not.
    if (typeof win.requestAnimationFrame !== 'function') return placeAll()
    frame = win.requestAnimationFrame(() => {
      frame = 0
      placeAll()
    })
  }

  const revealedRow = () => hoveredRow || focusedRow

  function placeAll() {
    if (!win) return
    const viewport = { width: win.innerWidth, height: win.innerHeight }
    const revealed = revealedRow()
    for (const spot of placements) {
      if (!spot.visible || (spot.control && controlsHidden)) {
        spot.node.hidden = true
        continue
      }
      // hidden must come off BEFORE measuring: a hidden node has a zero rect.
      spot.node.hidden = false
      const anchor = spot.el.getBoundingClientRect()
      const handle = spot.node.getBoundingClientRect()
      // A row too small to hold its strip shows it only while that row is the
      // one being pointed at or typed in. This deviates from §3.3's "always
      // visible", and only for rows that cannot physically hold the control.
      if (spot.kind === 'row' && spot.el !== revealed && !hosts(anchor, handle)) {
        spot.node.hidden = true
        continue
      }
      const prefer = spot.kind === 'handle' ? null : CONTROL_PLACEMENT
      const { x, y } = placeHandle({ anchor, handle, viewport, ...prefer })
      spot.node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    placeHighlight()
    follower?.()
  }

  // The row `el` belongs to, walking up from it: one Map lookup per ancestor,
  // the same shape elementToTarget uses for targets.
  function rowAt(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const row = rowOwners.get(node)
      if (row) return row
    }
    return null
  }

  function onFocusIn(event) {
    const before = revealedRow()
    focusedRow = rowAt(event.target)
    // Focus landing on a strip's own button is the keyboard taking over, so the
    // pointer's row must not out-vote it: otherwise tabbing to ↑ would hide the
    // strip the focus is standing on.
    if (focusedRow && layerEl.contains(event.target)) hoveredRow = null
    if (revealedRow() !== before) schedule()
  }

  function onFocusOut(event) {
    // The one case focusin cannot answer: focus left for nothing at all, so no
    // later focusin arrives to say which row it is in now.
    if (event.relatedTarget || !focusedRow) return
    const before = revealedRow()
    focusedRow = null
    if (revealedRow() !== before) schedule()
  }

  // The highlight carries an explicit width/height, so it never measures itself
  // and the hidden-before-measuring trap the handles have does not apply.
  function placeHighlight() {
    if (!highlighted || highlight.hidden) return
    const rect = highlighted.getBoundingClientRect()
    highlight.style.width = `${Math.round(rect.width)}px`
    highlight.style.height = `${Math.round(rect.height)}px`
    highlight.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`
  }

  function observe() {
    if (!win || typeof win.IntersectionObserver !== 'function') {
      // Degraded, not broken: treat everything as visible and let the placement
      // pass and place.js's viewport clamp do what they can.
      for (const spot of placements) spot.visible = true
      return
    }
    observer = new win.IntersectionObserver((records) => {
      let changed = false
      for (const record of records) {
        for (const spot of index.get(record.target) || []) {
          if (spot.visible !== record.isIntersecting) {
            spot.visible = record.isIntersecting
            changed = true
          }
        }
      }
      if (changed) schedule()
    }, { threshold: 0 })
    for (const el of index.keys()) observer.observe(el)
  }

  function listen() {
    if (listening || !win) return
    // capture, so a scroll inside an overflow container reaches us too. A
    // handle over a target inside a scrolling panel has to track that panel,
    // and a scroll event on it does not bubble to the window.
    win.addEventListener('scroll', schedule, { passive: true, capture: true })
    win.addEventListener('resize', schedule, { passive: true })
    // focusin/focusout, not focus/blur: only these two bubble, and the strip's
    // buttons and the page rows are in different subtrees.
    doc.addEventListener('focusin', onFocusIn)
    doc.addEventListener('focusout', onFocusOut)
    listening = true
  }

  function unlisten() {
    if (!listening || !win) return
    win.removeEventListener('scroll', schedule, { capture: true })
    win.removeEventListener('resize', schedule)
    doc.removeEventListener('focusin', onFocusIn)
    doc.removeEventListener('focusout', onFocusOut)
    listening = false
  }

  // `kind` is 'handle', 'row' or 'add': it decides how the node is placed, and
  // everything but a handle is a list control that Hide controls takes away.
  function addPlacement(el, node, kind) {
    const spot = { el, node, kind, control: kind !== 'handle', visible: false }
    placements.push(spot)
    const riders = index.get(el)
    if (riders) riders.push(spot)
    else index.set(el, [spot])
    layerEl.appendChild(node)
    return spot
  }

  function makeHandle(target) {
    const path = target.path.join('.')
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'hcms-inline-handle mirk-button mirk-button--small'
    button.setAttribute('data-hcms-target', path)
    // The icon kind is carried as data rather than as a different glyph: one
    // mark reads as one affordance, and CSS can differentiate later without
    // changing the markup.
    if (target.icon) button.setAttribute('data-hcms-icon', target.icon)
    button.setAttribute('aria-label', `Edit ${path}`)
    button.innerHTML = '<span class="mirk-button__label">✎</span>'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onActivate?.(target, button)
    })
    return button
  }

  function makeListButton(action, glyph, label) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'hcms-inline-list-button mirk-button mirk-button--small'
    button.setAttribute('data-hcms-list-action', action)
    button.setAttribute('aria-label', label)
    button.innerHTML = `<span class="mirk-button__label">${glyph}</span>`
    return button
  }

  // One row's strip. The index is stamped here because the first-row and
  // last-row visibility rules below need the position the layer was built with.
  // The action deliberately does NOT trust it: listAction re-resolves the row
  // from the element it is handed, because a refresh trails a structural change
  // by an observer batch, and a second click inside that window would otherwise
  // act on whatever had taken this row's number.
  function makeRowControls(list, row, rowIndex, count) {
    const path = list.path.join('.')
    const strip = doc.createElement('div')
    strip.className = 'hcms-inline-row-controls'
    strip.setAttribute('data-hcms-list', path)
    strip.setAttribute('data-hcms-row', String(rowIndex))
    for (const [action, glyph, label] of ROW_ACTIONS) {
      const button = makeListButton(action, glyph, `${label} ${path}.${rowIndex}`)
      // The same rule updateArrayButtonsVisibility applies to the sidebar's own
      // buttons (events.js:855), rather than a second rule that could disagree
      // with it: the first row cannot move up, the last cannot move down.
      if (action === 'move-up' && rowIndex === 0) button.hidden = true
      if (action === 'move-down' && rowIndex === count - 1) button.hidden = true
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onListAction?.({ action, list, index: rowIndex, row })
      })
      strip.appendChild(button)
    }
    return strip
  }

  function makeAdd(list) {
    const path = list.path.join('.')
    const button = makeListButton('add', '+ Add', `Add to ${path || 'the list'}`)
    button.classList.add('hcms-inline-list-add')
    button.setAttribute('data-hcms-list', path)
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onListAction?.({ action: 'add', list, index: list.items.length })
    })
    return button
  }

  function addListControls(list) {
    const rows = list.items || []
    rows.forEach((el, i) => {
      // The same floor the handles clear. A row below it cannot carry a strip
      // any better than it can carry a handle, and the strip would end up at the
      // viewport clamp with nothing to belong to.
      if (!isAnchorable(el)) return
      const strip = makeRowControls(list, el, i, rows.length)
      addPlacement(el, strip, 'row')
      rowOwners.set(el, el)
      rowOwners.set(strip, el)
    })
    // Deliberately NOT gated on isAnchorable, unlike the rows above. An emptied
    // list is the one most in need of an Add, and a <ul> holding nothing but its
    // hidden [cms-template] seed measures zero height — the floor would take the
    // Add away from exactly the list that cannot be grown any other way.
    if (list.container) addPlacement(list.container, makeAdd(list), 'add')
  }

  function clearEntries() {
    observer?.disconnect()
    observer = null
    for (const spot of placements) spot.node.remove()
    placements = []
    index = new Map()
    targets = new Map()
    rowOwners = new Map()
    handleCount = 0
  }

  return {
    setTargets(list, lists) {
      clearEntries()
      for (const target of list || []) {
        // Indexed whatever its kind, because the highlight and the click reach
        // every target; the handle below is the part only 'handle' gets.
        targets.set(target.el, target)
        // Only the 'handle' kind gets one, which is what the kind name says. A
        // text target's affordance is the caret richclay puts in it, and a
        // native target already carries its own control: targets.js is explicit
        // that a native gets "nothing at all". A handle over a live <input>
        // would cover the very control it was advertising.
        if (target.kind !== 'handle') continue
        if (!isAnchorable(target.el)) continue
        addPlacement(target.el, makeHandle(target), 'handle')
        handleCount++
      }
      for (const listSpec of lists || []) addListControls(listSpec)
      observe()
      listen()
      schedule()
    },
    refresh: schedule,
    get count() { return handleCount },

    get controlsHidden() { return controlsHidden },

    // Hidden immediately rather than on the next frame, so the toggle reads as
    // instant; showing them again goes through the placement pass, which is what
    // gives them their coordinates back.
    setControlsHidden(hidden) {
      controlsHidden = !!hidden
      if (controlsHidden) {
        for (const spot of placements) if (spot.control) spot.node.hidden = true
      }
      schedule()
    },

    // The nearest target containing `el`, walking up from it. One Map lookup
    // per ancestor rather than a scan of the target list per pointer event.
    elementToTarget(el) {
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const target = targets.get(node)
        if (target) return target
      }
      return null
    },

    // Where the pointer is, answered off the one pointer path the highlight
    // already rides (inline.js bindPage). Takes the RAW element under the
    // pointer rather than a resolved target: a strip is not a target at all,
    // and reading it as "off the row" would hide it under the pointer.
    setHoveredRow(el) {
      const before = revealedRow()
      hoveredRow = el ? rowAt(el) : null
      if (revealedRow() !== before) schedule()
    },

    showHighlight(el) {
      if (!el) return
      highlighted = el
      highlight.hidden = false
      placeHighlight()
    },

    hideHighlight() {
      highlighted = null
      highlight.hidden = true
    },

    // The seam the view uses to ride the same frame-coalesced pass the handles
    // do, so an open popover tracks a scroll without a second rAF loop.
    setFollower(fn) {
      follower = typeof fn === 'function' ? fn : null
    },

    destroy() {
      if (frame && win) win.cancelAnimationFrame(frame)
      frame = 0
      follower = null
      highlighted = null
      hoveredRow = null
      focusedRow = null
      highlight.remove()
      unlisten()
      clearEntries()
    },
  }
}
