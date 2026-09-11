// Each item has one positioned container for its edit and row-action buttons.
// List Add controls live in an excluded placeholder after the real rows.
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
import { inlineIcon } from '../inline-icons.js'
import { createInlineGhosts } from './inline-ghosts.js'

// Move actions retain the first/last-row availability rules.
const ROW_ACTIONS = [
  ['move-up', 'Move up'],
  ['move-down', 'Move down'],
]

// A list control is pinned INSIDE its anchor's top-right corner. 'corner'
// because place.js's adaptive rule measures the anchor against the control and
// sends a small one BESIDE it, which is right for a handle floating near a link
// and wrong for a strip that belongs to a row: measured in Chrome, every card
// row shorter than ~47px put its strip wholly outside the card. inset 0 because
// a handle straddles its corner on purpose and a strip must not — §3.3 asks for
// a strip pinned to the card's top-right, inside it.
const CONTROL_PLACEMENT = { prefer: 'corner', inset: 0 }

// Measure the complete toolbar, including the pencil, against the row's box.
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
  let handleCount = 0
  // Every resolved target, keyed by the page element it sits on — not just the
  // ones that got a handle. The highlight and the page-level click have to
  // reach a text or a native target too, and neither of those has an entry.
  let targets = new Map()
  let observer = null
  let observedAnchors = new Set()
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
  // target reconciliation on every refresh.
  let controlsHidden = false
  let openSettings = null
  const ghosts = createInlineGhosts({
    doc,
    themeRoot: layerEl.closest('[data-hcms-shell]'),
    onResize: schedule,
    onAdd: (list) => onListAction?.({ action: 'add', list, index: list.items.length }),
  })

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
    ghosts.update()
    const viewport = { width: win.innerWidth, height: win.innerHeight }
    const revealed = revealedRow()
    for (const spot of placements) {
      if (!spot.visible) {
        spot.node.hidden = true
        continue
      }
      for (const member of spot.members) member.node.hidden = controlsHidden && member.kind !== 'handle'
      // hidden must come off BEFORE measuring: a hidden node has a zero rect.
      spot.node.hidden = false
      const anchor = spot.el.getBoundingClientRect()
      let handle = spot.node.getBoundingClientRect()
      const fullWidth = handle.width
      const tooSmall = spot.kind === 'row' && !hosts(anchor, handle)
      // A row too small to hold its strip shows it only while that row is the
      // one being pointed at or typed in. This deviates from §3.3's "always
      // visible", and only for rows that cannot physically hold the control.
      if (tooSmall && spot.el !== revealed) {
        for (const member of spot.members) {
          if (member.kind === 'row') member.node.hidden = true
        }
        handle = spot.node.getBoundingClientRect()
      }
      if (spot.members.every((member) => member.node.hidden)) {
        spot.node.hidden = true
        continue
      }
      const prefer = spot.kind === 'handle' ? null : CONTROL_PLACEMENT
      let { x, y } = placeHandle({ anchor, handle, viewport, ...prefer })
      const pencil = spot.members.find((member) => member.kind === 'handle')
      if (tooSmall && pencil) {
        const pencilBox = pencil.node.getBoundingClientRect()
        const position = placeHandle({ anchor, handle: pencilBox, viewport })
        const afterPencil = spot.members.slice(spot.members.indexOf(pencil) + 1)
          .filter((member) => !member.node.hidden)
          .reduce((width, member) => width + member.node.getBoundingClientRect().width + 2, 0)
        x = Math.max(8 + fullWidth, Math.min(viewport.width - 8, position.x + pencilBox.width + afterPencil)) - handle.width
        y = position.y
      }
      spot.node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    if (openSettings) {
      if (!openSettings.node.isConnected || openSettings.node.closest('[hidden]')) closeSettings()
      else {
        const rect = openSettings.button.getBoundingClientRect()
        const menu = openSettings.menu.getBoundingClientRect()
        openSettings.menu.style.left = `${Math.max(8, rect.right - menu.width) - rect.left}px`
        openSettings.menu.style.right = 'auto'
        openSettings.menu.style.top = rect.bottom + 6 + menu.height > viewport.height - 8 ? 'auto' : 'calc(100% + 6px)'
        openSettings.menu.style.bottom = rect.bottom + 6 + menu.height > viewport.height - 8 ? 'calc(100% + 6px)' : 'auto'
      }
    }
    placeHighlight()
    follower?.()
  }

  // The row `el` belongs to, walking up from it: one Map lookup per ancestor,
  // the same shape elementToTarget uses for targets.
  function rowAt(el) {
    if (el?.closest?.('[data-hcms-ghost]')) return null
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const row = rowOwners.get(node)
      if (row) return row
    }
    return null
  }

  function onFocusIn(event) {
    if (openSettings && !openSettings.node.contains(event.target)) closeSettings()
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

  function syncObservation() {
    if (!win || typeof win.IntersectionObserver !== 'function') {
      for (const spot of placements) spot.visible = true
      return
    }
    if (!observer) {
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
    }
    const next = new Set(index.keys())
    for (const el of observedAnchors) {
      if (!next.has(el)) observer.unobserve(el)
    }
    for (const el of next) {
      if (!observedAnchors.has(el)) observer.observe(el)
    }
    observedAnchors = next
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
    doc.addEventListener('pointerdown', onOutsideSettings, true)
    doc.addEventListener('keydown', onSettingsKeyDown, true)
    listening = true
  }

  function unlisten() {
    if (!listening || !win) return
    win.removeEventListener('scroll', schedule, { capture: true })
    win.removeEventListener('resize', schedule)
    doc.removeEventListener('focusin', onFocusIn)
    doc.removeEventListener('focusout', onFocusOut)
    doc.removeEventListener('pointerdown', onOutsideSettings, true)
    doc.removeEventListener('keydown', onSettingsKeyDown, true)
    listening = false
  }

  function targetIdentity(target) {
    return `${target.kind}\0${target.attr || ''}`
  }

  function sameList(left, right) {
    return left.container === right.container &&
      left.scalar === right.scalar
  }

  function sameMember(member, spec) {
    if (member.kind !== spec.kind) return false
    if (member.kind === 'handle') return targetIdentity(member.target) === targetIdentity(spec.target)
    if (member.kind === 'row') return member.row === spec.row && sameList(member.list, spec.list)
    return sameList(member.list, spec.list)
  }

  function updateHandle(member, target) {
    member.target = target
    const path = target.path.join('.')
    member.node.setAttribute('data-hcms-target', path)
    if (target.icon) member.node.setAttribute('data-hcms-icon', target.icon)
    else member.node.removeAttribute('data-hcms-icon')
    member.node.setAttribute('aria-label', `Edit ${path}`)
  }

  function makeHandle(target) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'hcms-inline-handle mirk-button mirk-button--small'
    button.innerHTML = `<span class="mirk-button__label">${inlineIcon('edit')}</span>`
    const member = { node: button, kind: 'handle', target }
    updateHandle(member, target)
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onActivate?.(member.target, button)
    })
    return member
  }

  function makeListButton(action, label) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'hcms-inline-list-button mirk-button mirk-button--small'
    button.setAttribute('data-hcms-list-action', action)
    button.setAttribute('aria-label', label)
    button.innerHTML = `<span class="mirk-button__label">${inlineIcon(action)}${action === 'add' ? '<span>Add</span>' : ''}</span>`
    return button
  }

  // One row's strip. The index is stamped here because the first-row and
  // last-row availability rules below need the position the layer was built with.
  // The action deliberately does NOT trust it: listAction re-resolves the row
  // from the element it is handed, because a refresh trails a structural change
  // by an observer batch, and a second click inside that window would otherwise
  // act on whatever had taken this row's number.
  function updateRowControls(member, { list, row, rowIndex, count }) {
    const path = list.path.join('.')
    member.list = list
    member.row = row
    member.index = rowIndex
    member.count = count
    member.node.setAttribute('data-hcms-list', path)
    member.node.setAttribute('data-hcms-row', String(rowIndex))
    for (const button of member.node.querySelectorAll('[data-hcms-list-action]')) {
      const action = button.getAttribute('data-hcms-list-action')
      const label = ROW_ACTIONS.find(([name]) => name === action)?.[1] || action
      button.setAttribute('aria-label', `${label} ${path}.${rowIndex}`)
      button.disabled = (action === 'move-up' && rowIndex === 0) ||
        (action === 'move-down' && rowIndex === count - 1)
    }
  }

  function makeRowControls(list, row, rowIndex, count) {
    const strip = doc.createElement('div')
    strip.className = 'hcms-inline-row-controls'
    const member = { node: strip, kind: 'row', list, row, index: rowIndex, count }
    for (const [action, label] of ROW_ACTIONS) {
      const button = makeListButton(action, label)
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (button.disabled) return
        onListAction?.({
          action,
          list: member.list,
          index: member.index,
          row: member.row,
        })
      })
      strip.appendChild(button)
    }
    updateRowControls(member, { list, row, rowIndex, count })
    return member
  }

  function closeSettings(restoreFocus = false) {
    if (!openSettings) return
    const member = openSettings
    openSettings = null
    member.menu.hidden = true
    member.button.setAttribute('aria-expanded', 'false')
    member.node.parentElement?.classList.remove('has-open-settings')
    if (restoreFocus && member.button.isConnected) member.button.focus({ preventScroll: true })
  }

  function onOutsideSettings(event) {
    if (openSettings && !openSettings.node.contains(event.target)) closeSettings()
  }

  function onSettingsKeyDown(event) {
    if (!openSettings) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeSettings(true)
    } else if (event.key === 'Tab') closeSettings(true)
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && openSettings.menu.contains(event.target)) {
      event.preventDefault()
      openSettings.menu.querySelector('[role="menuitem"]').focus({ preventScroll: true })
    }
  }

  function updateSettings(member, { list, row, rowIndex }) {
    Object.assign(member, { list, row, index: rowIndex })
    member.node.setAttribute('data-hcms-list', list.path.join('.'))
    member.node.setAttribute('data-hcms-row', String(rowIndex))
    member.button.setAttribute('aria-label', `Settings ${list.path.join('.')}.${rowIndex}`)
  }

  function makeSettings(spec) {
    const node = doc.createElement('div')
    node.className = 'hcms-inline-settings'
    const button = makeListButton('settings', 'Settings')
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', 'false')
    const menu = doc.createElement('div')
    menu.className = 'hcms-inline-settings-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', 'Item settings')
    menu.hidden = true
    const remove = doc.createElement('button')
    remove.type = 'button'
    remove.setAttribute('role', 'menuitem')
    remove.setAttribute('data-hcms-list-action', 'remove')
    remove.textContent = 'Delete'
    menu.appendChild(remove)
    node.append(button, menu)
    const member = { node, button, menu, kind: 'settings' }
    updateSettings(member, spec)
    const show = () => {
      closeSettings()
      openSettings = member
      menu.hidden = false
      button.setAttribute('aria-expanded', 'true')
      node.parentElement.classList.add('has-open-settings')
      remove.focus({ preventScroll: true })
      schedule()
    }
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (openSettings === member) closeSettings(true)
      else show()
    })
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        show()
      }
    })
    remove.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      closeSettings(true)
      onListAction?.({ action: 'remove', list: member.list, index: member.index, row: member.row })
    })
    return member
  }

  function updateMember(member, spec) {
    if (member.kind === 'handle') updateHandle(member, spec.target)
    else if (member.kind === 'row') updateRowControls(member, spec)
    else if (member.kind === 'settings') updateSettings(member, spec)
  }

  function addDesired(desired, desiredIndex, el, spec, category) {
    let spot = desiredIndex.get(el)?.find((candidate) => candidate.category === category)
    if (!spot) {
      spot = { el, category, members: [] }
      desired.push(spot)
      const riders = desiredIndex.get(el)
      if (riders) riders.push(spot)
      else desiredIndex.set(el, [spot])
    }
    spot.members.push(spec)
  }

  function addListControls(desired, desiredIndex, list) {
    const rows = list.items || []
    rows.forEach((el, i) => {
      if (!isAnchorable(el)) return
      addDesired(desired, desiredIndex, el, {
        kind: 'row', list, row: el, rowIndex: i, count: rows.length,
      }, 'item')
      addDesired(desired, desiredIndex, el, {
        kind: 'settings', list, row: el, rowIndex: i,
      }, 'item')
    })
  }

  function reconcileMembers(spot, specs) {
    const unused = new Set(spot.members)
    const next = []
    for (const spec of specs) {
      const member = spot.members.find((candidate) => unused.has(candidate) && sameMember(candidate, spec)) ||
        (spec.kind === 'handle'
          ? makeHandle(spec.target)
          : spec.kind === 'row'
            ? makeRowControls(spec.list, spec.row, spec.rowIndex, spec.count)
            : makeSettings(spec))
      unused.delete(member)
      updateMember(member, spec)
      if (controlsHidden && member.kind !== 'handle') member.node.hidden = true
      next.push(member)
    }
    for (const member of unused) {
      if (member === openSettings) closeSettings()
      member.node.remove()
    }
    next.sort((left, right) => ['row', 'handle', 'settings'].indexOf(left.kind) - ['row', 'handle', 'settings'].indexOf(right.kind))
    next.forEach((member, i) => {
      if (spot.node.children[i] !== member.node) spot.node.insertBefore(member.node, spot.node.children[i] || null)
    })
    spot.members = next
  }

  function reconcile(targetList, lists) {
    const desired = []
    const desiredIndex = new Map()
    const nextTargets = new Map()
    let nextHandleCount = 0
    for (const target of targetList || []) {
      if (!nextTargets.has(target.el)) nextTargets.set(target.el, target)
      if (target.kind !== 'handle' || !isAnchorable(target.el)) continue
      addDesired(desired, desiredIndex, target.el, { kind: 'handle', target }, 'item')
      nextHandleCount++
    }
    for (const list of lists || []) addListControls(desired, desiredIndex, list)

    const unused = new Set(placements)
    const visibility = new Map()
    for (const spot of placements) {
      if (!visibility.has(spot.el)) visibility.set(spot.el, spot.visible)
    }
    const next = []
    for (const wanted of desired) {
      let spot = placements.find((candidate) =>
        unused.has(candidate) && candidate.el === wanted.el && candidate.category === wanted.category)
      if (!spot) {
        const container = doc.createElement('div')
        container.className = 'hcms-inline-item-controls'
        container.setAttribute('role', 'group')
        spot = {
          el: wanted.el,
          node: container,
          category: wanted.category,
          kind: wanted.category === 'add' ? 'add' : 'handle',
          members: [],
          visible: visibility.get(wanted.el) ?? false,
        }
        layerEl.appendChild(container)
      }
      unused.delete(spot)
      spot.el = wanted.el
      spot.category = wanted.category
      reconcileMembers(spot, wanted.members)
      spot.kind = spot.members.some((member) => member.kind === 'row')
        ? 'row'
        : spot.members.some((member) => member.kind === 'handle') ? 'handle' : 'add'
      spot.node.setAttribute('aria-label', spot.category === 'add' ? 'List controls' : 'Item controls')
      next.push(spot)
    }
    for (const spot of unused) spot.node.remove()

    placements = next
    index = new Map()
    rowOwners = new Map()
    for (const spot of placements) {
      const riders = index.get(spot.el)
      if (riders) riders.push(spot)
      else index.set(spot.el, [spot])
      for (const member of spot.members) {
        if (member.kind !== 'row' && member.kind !== 'settings') continue
        rowOwners.set(member.row, member.row)
        rowOwners.set(member.node, member.row)
        rowOwners.set(spot.node, member.row)
      }
    }
    if (hoveredRow && !rowOwners.has(hoveredRow)) hoveredRow = null
    if (focusedRow && !rowOwners.has(focusedRow)) focusedRow = null
    targets = nextTargets
    handleCount = nextHandleCount
  }

  function clearEntries() {
    closeSettings()
    observer?.disconnect()
    observer = null
    observedAnchors = new Set()
    for (const spot of placements) spot.node.remove()
    placements = []
    index = new Map()
    targets = new Map()
    rowOwners = new Map()
    handleCount = 0
  }

  return {
    setTargets(list, lists) {
      reconcile(list, lists)
      ghosts.setLists(lists)
      syncObservation()
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
      ghosts.setHidden(controlsHidden)
      if (controlsHidden) {
        closeSettings()
        for (const spot of placements) {
          for (const member of spot.members) if (member.kind !== 'handle') member.node.hidden = true
          if (spot.members.every((member) => member.node.hidden)) spot.node.hidden = true
        }
      }
      schedule()
    },

    // The nearest target containing `el`, walking up from it. One Map lookup
    // per ancestor rather than a scan of the target list per pointer event.
    elementToTarget(el) {
      if (el?.closest?.('[data-hcms-ghost]')) return null
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
      ghosts.destroy()
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
