// The visible layer of the inline view: one handle per non-text target, drawn
// over the page and kept in step with it.
//
// Two mechanisms, kept deliberately separate, because merging them was the first
// draft's mistake (plan §3.1.2 and §3.5). An IntersectionObserver answers "is
// this anchor showing", and it accounts for an overflow:hidden ancestor clipping
// an anchor that is still inside the viewport, which no viewport comparison can
// see. It does NOT fire when a visible element merely moves, so it can never
// drive placement. Placement is a separate frame-coalesced pass driven by scroll
// and resize.

import { placeHandle } from '../place.js'
import { isAnchorable } from '../anchor.js'

export function createInlineLayer({ doc, layerEl, onActivate }) {
  const win = doc.defaultView
  let entries = []
  let index = new Map()
  // Every resolved target, keyed by the page element it sits on — not just the
  // ones that got a handle. The highlight and the page-level click have to
  // reach a text or a native target too, and neither of those has an entry.
  let targets = new Map()
  let observer = null
  let frame = 0
  let listening = false
  let follower = null
  let highlighted = null

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

  function placeAll() {
    if (!win) return
    const viewport = { width: win.innerWidth, height: win.innerHeight }
    for (const entry of entries) {
      if (!entry.visible) {
        entry.handle.hidden = true
        continue
      }
      // hidden must come off BEFORE measuring: a hidden handle has a zero rect.
      entry.handle.hidden = false
      const anchor = entry.target.el.getBoundingClientRect()
      const handle = entry.handle.getBoundingClientRect()
      const { x, y } = placeHandle({ anchor, handle, viewport })
      entry.handle.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    placeHighlight()
    follower?.()
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
      for (const entry of entries) entry.visible = true
      return
    }
    observer = new win.IntersectionObserver((records) => {
      let changed = false
      for (const record of records) {
        const entry = index.get(record.target)
        if (!entry) continue
        if (entry.visible !== record.isIntersecting) {
          entry.visible = record.isIntersecting
          changed = true
        }
      }
      if (changed) schedule()
    }, { threshold: 0 })
    for (const entry of entries) observer.observe(entry.target.el)
  }

  function listen() {
    if (listening || !win) return
    // capture, so a scroll inside an overflow container reaches us too. A
    // handle over a target inside a scrolling panel has to track that panel,
    // and a scroll event on it does not bubble to the window.
    win.addEventListener('scroll', schedule, { passive: true, capture: true })
    win.addEventListener('resize', schedule, { passive: true })
    listening = true
  }

  function unlisten() {
    if (!listening || !win) return
    win.removeEventListener('scroll', schedule, { capture: true })
    win.removeEventListener('resize', schedule)
    listening = false
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

  function clearEntries() {
    observer?.disconnect()
    observer = null
    for (const entry of entries) entry.handle.remove()
    entries = []
    index = new Map()
    targets = new Map()
  }

  return {
    setTargets(list) {
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
        const entry = { target, handle: makeHandle(target), visible: false }
        entries.push(entry)
        index.set(target.el, entry)
        layerEl.appendChild(entry.handle)
      }
      observe()
      listen()
      schedule()
    },
    refresh: schedule,
    get count() { return entries.length },

    // The nearest target containing `el`, walking up from it. One Map lookup
    // per ancestor rather than a scan of the target list per pointer event.
    elementToTarget(el) {
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const target = targets.get(node)
        if (target) return target
      }
      return null
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
      highlight.remove()
      unlisten()
      clearEntries()
    },
  }
}
