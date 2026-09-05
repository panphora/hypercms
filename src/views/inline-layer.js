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
  let observer = null
  let frame = 0
  let listening = false

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
  }

  return {
    setTargets(targets) {
      clearEntries()
      for (const target of targets || []) {
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
    destroy() {
      if (frame && win) win.cancelAnimationFrame(frame)
      frame = 0
      unlisten()
      clearEntries()
    },
  }
}
