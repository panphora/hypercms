const SHELL_STYLE_ID = 'hcms-shell-styles'
const SHELL_BUNDLED_FLAG = 'hcms-bundled-styles-installed'
const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const styledDocs = new WeakSet()
let cssText = ''

export function setShellStyles(text) {
  cssText = text
}

export function markStylesBundled(doc) {
  // Bundler emits a <style data-hcms-bundled-styles> tag and sets this so
  // the link-based path doesn't double-install.
  if (!doc) return
  styledDocs.add(doc)
  doc[SHELL_BUNDLED_FLAG] = true
}

let titleIdCounter = 0

export function mountShell({ mountTo, side = 'right', overlay = false, showSaveButton = false, doc }) {
  ensureStyles(doc)
  const titleId = `hcms-shell-title-${++titleIdCounter}`
  const root = doc.createElement('div')
  root.setAttribute('data-hcms-shell', '')
  root.setAttribute('save-remove', '')
  root.setAttribute('save-ignore', '')
  root.setAttribute('tabindex', '-1')
  // Dialog semantics: focus is trapped + body scrolling locked, so screen
  // readers should announce this as a modal dialog with the shell title as
  // its accessible name.
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-labelledby', titleId)
  root.className = 'hcms-shell hcms-side-' + side + (overlay ? ' hcms-overlay' : '')
  root.innerHTML = `
    <header class="hcms-shell-header">
      <h2 class="hcms-shell-title" id="${titleId}">Edit</h2>
      <button type="button" class="hcms-shell-close" data-hcms-action="close" aria-label="Close">×</button>
    </header>
    <div class="hcms-shell-error" role="alert" hidden></div>
    <div data-hcms-form-root class="hcms-form"></div>
    <footer class="hcms-shell-footer"${showSaveButton ? '' : ' hidden'}>
      <button type="button" class="hcms-shell-save" data-hcms-action="save">Save</button>
    </footer>
  `

  // mountTo may be a nested element inside pageRoot. Use it as-is for the
  // visual hierarchy; engine reads/writes pass { skip: '[data-hcms-shell]' }
  // so the engine never traverses into the form regardless of where it's mounted.
  const host = mountTo || doc.body
  host.appendChild(root)

  const body = doc.body
  body.classList.add('hcms-open')
  if (overlay) body.classList.add('hcms-overlay')
  if (side === 'left') body.classList.add('hcms-side-left')

  const focusTrap = installFocusTrap(root, doc)

  return {
    root,
    formRoot: root.querySelector('[data-hcms-form-root]'),
    errorEl: root.querySelector('.hcms-shell-error'),
    saveButton: root.querySelector('.hcms-shell-save'),
    destroy() {
      focusTrap.detach()
      root.remove()
      body.classList.remove('hcms-open', 'hcms-overlay', 'hcms-side-left')
    },
    // Re-assert the shell's out-of-subtree chrome after a full-document morph
    // (e.g. a live-sync apply) wipes it: the stylesheet lives in <head> and the
    // body classes live on <body>, both outside the save-ignore shell element,
    // so hyper-morph's head-merge / class reconciliation can strip them.
    restoreChrome() {
      reensureStyles(doc)
      body.classList.add('hcms-open')
      if (overlay) body.classList.add('hcms-overlay')
      if (side === 'left') body.classList.add('hcms-side-left')
    },
  }
}

// Re-inject the shell stylesheet if a morph (or anything else) removed it.
// Unlike ensureStyles, this does NOT trust the styledDocs WeakSet: a morph can
// remove the <style> tag while the WeakSet still marks the doc as "styled", so
// a naive ensureStyles() call would no-op. Re-check the live DOM, clear the
// stale mark, and let ensureStyles rebuild from cssText.
export function reensureStyles(doc) {
  if (!doc) return
  if (doc.getElementById(SHELL_STYLE_ID) ||
      doc.querySelector('style[data-hcms-bundled-styles]')) return
  styledDocs.delete(doc)
  ensureStyles(doc)
}

function ensureStyles(doc) {
  if (!doc) return
  if (styledDocs.has(doc)) return
  if (doc[SHELL_BUNDLED_FLAG]) {
    styledDocs.add(doc)
    return
  }
  if (doc.getElementById(SHELL_STYLE_ID) || doc.querySelector('style[data-hcms-bundled-styles]')) {
    styledDocs.add(doc)
    return
  }
  if (cssText) {
    const style = doc.createElement('style')
    style.id = SHELL_STYLE_ID
    style.setAttribute('save-remove', '')
    style.textContent = cssText
    ;(doc.head || doc.documentElement).appendChild(style)
    styledDocs.add(doc)
    return
  }
  // No bundled CSS — try resolving the sibling styles.css via import.meta.url.
  // Browsers ESM-resolved imports place a co-located styles.css next to
  // hypercms.js. Falls back silently if resolution fails (e.g., bundlers
  // without an asset emitter).
  try {
    const href = new URL('./styles.css', import.meta.url).href
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.id = SHELL_STYLE_ID
    link.setAttribute('save-remove', '')
    link.href = href
    ;(doc.head || doc.documentElement).appendChild(link)
    styledDocs.add(doc)
  } catch (_) {
    // SSR or environments without import.meta.url — author can call
    // installStyles(text) manually.
  }
}

function installFocusTrap(root, doc) {
  function onKeyDown(e) {
    if (e.key !== 'Tab') return
    if (!root.contains(doc.activeElement)) return
    const focusables = Array.from(root.querySelectorAll(FOCUSABLE))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && doc.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  doc.addEventListener('keydown', onKeyDown)
  return { detach: () => doc.removeEventListener('keydown', onKeyDown) }
}
