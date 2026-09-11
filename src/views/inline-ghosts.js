import { inlineIcon } from '../inline-icons.js'
import { capabilitySelector } from '../lib/region-capabilities.js'

const MARKER = 'data-hcms-ghost'
const EDITOR_UI_SELECTOR = capabilitySelector('history')

function placementFor(list) {
  let parent = list.container
  let anchor = null
  while (parent && (parent.namespaceURI !== 'http://www.w3.org/1999/xhtml' || ['SELECT', 'OPTGROUP', 'DATALIST'].includes(parent.tagName))) {
    anchor = parent
    parent = parent.parentElement
  }
  return { parent, anchor }
}

export function createInlineGhosts({ doc, themeRoot, onAdd, onResize }) {
  const win = doc.defaultView
  let entries = []
  let hidden = false
  let resizeObserver = null
  const sorting = new Map()

  function setStyle(node, property, value) {
    if (node.style[property] !== value) node.style[property] = value
  }

  function protectSorting() {
    const parents = new Set(entries.map((entry) => entry.node.parentElement))
    for (const [parent, record] of sorting) {
      if (parents.has(parent) && win?.Sortable?.get(parent) === record.instance) continue
      if (record.instance.option('draggable') === record.selector) record.instance.option('draggable', record.original)
      sorting.delete(parent)
    }
    for (const parent of parents) {
      const instance = win?.Sortable?.get(parent)
      if (!instance) continue
      const current = instance.option('draggable')
      if (sorting.get(parent)?.selector === current) continue
      const original = current
      const direct = original.trim().startsWith('>')
      const selector = `${direct ? '> ' : ''}:is(${original.trim().replace(/^>\s*/, '')}):not(${EDITOR_UI_SELECTOR})`
      instance.option('draggable', selector)
      sorting.set(parent, { instance, original, selector })
    }
  }

  function update() {
    for (const entry of entries) {
      const { node, slot, list } = entry
      const boxes = list.items.filter((el) => el.isConnected).map((el) => el.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
      if (boxes.length) {
        entry.width = boxes.reduce((sum, rect) => sum + rect.width, 0) / boxes.length
        entry.height = boxes.reduce((sum, rect) => sum + rect.height, 0) / boxes.length
      }
      setStyle(node, 'width', entry.width ? `${Math.round(entry.width)}px` : '100%')
      setStyle(slot, 'height', `${Math.max(48, Math.round(entry.height || 64))}px`)
      if (slot !== node) slot.colSpan = Math.max(1, ...list.items.map((row) => [...row.children].reduce((sum, cell) => sum + (cell.colSpan || 1), 0)))
      if (node.hidden !== hidden) node.hidden = hidden
    }
    protectSorting()
  }

  function make(list, parent) {
    const parentTag = parent.tagName
    const tableRow = ['TBODY', 'THEAD', 'TFOOT', 'TABLE'].includes(parentTag)
    const node = doc.createElement(tableRow ? 'tr' : ['UL', 'OL', 'MENU'].includes(parentTag) ? 'li' : 'div')
    for (const attr of [MARKER, 'data-hcms-shell', 'editor-ui', 'no-watch', 'no-save', 'save-remove', 'snapshot-remove']) node.setAttribute(attr, '')
    node.setAttribute('draggable', 'false')
    node.setAttribute('contenteditable', 'false')
    node.className = 'hcms-shell pixel-quiet hcms-inline-ghost'
    for (const theme of ['light', 'dark']) node.classList.toggle(theme, !!themeRoot?.classList.contains(theme))
    const slot = tableRow ? doc.createElement('td') : node
    if (slot !== node) {
      slot.className = 'hcms-inline-ghost-cell'
      node.appendChild(slot)
    }
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'hcms-inline-list-button hcms-inline-list-add mirk-button mirk-button--small'
    button.setAttribute('data-hcms-list-action', 'add')
    button.innerHTML = `<span class="mirk-button__label">${inlineIcon('add')}<span>Add</span></span>`
    slot.appendChild(button)
    const entry = { node, slot, button, list, width: 0, height: 0 }
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onAdd(entry.list)
    })
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click']) node.addEventListener(type, (event) => event.stopPropagation())
    node.addEventListener('dragstart', (event) => { event.preventDefault(); event.stopPropagation() })
    return entry
  }

  return {
    setLists(lists) {
      const unused = new Set(entries)
      const next = []
      const owned = new Set(entries.map(entry => entry.node))
      const cleanedParents = new Set()
      for (const list of lists || []) {
        if (!list.container || !list.container.isConnected) continue
        const { parent, anchor } = placementFor(list)
        if (!parent) continue
        if (!cleanedParents.has(parent)) {
          for (const stale of parent.querySelectorAll(`:scope > [${MARKER}]`)) {
            if (!owned.has(stale)) stale.remove()
          }
          cleanedParents.add(parent)
        }
        const entry = entries.find((candidate) => unused.has(candidate) && candidate.list.container === list.container && candidate.list.path.join('.') === list.path.join('.')) || make(list, parent)
        unused.delete(entry)
        entry.list = list
        entry.button.setAttribute('data-hcms-list', list.path.join('.'))
        entry.button.setAttribute('aria-label', `Add to ${list.path.join('.') || 'the list'}`)
        const last = anchor || list.items.filter((el) => el.parentElement === parent).at(-1)
        if (last) {
          if (last.nextSibling !== entry.node) last.after(entry.node)
        } else if (entry.node.parentElement !== parent) parent.appendChild(entry.node)
        next.push(entry)
      }
      for (const entry of unused) entry.node.remove()
      entries = next
      resizeObserver?.disconnect()
      if (!resizeObserver && typeof win?.ResizeObserver === 'function') resizeObserver = new win.ResizeObserver(() => { update(); onResize?.() })
      for (const entry of entries) for (const item of entry.list.items) resizeObserver?.observe(item)
      update()
    },
    update,
    setHidden(value) { hidden = !!value; update() },
    destroy() {
      resizeObserver?.disconnect()
      for (const entry of entries) entry.node.remove()
      entries = []
      protectSorting()
    },
  }
}
