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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ))
}

export function mountShell({
  mountTo,
  side = 'right',
  overlay = false,
  showSaveButton = false,
  title = 'Page content',
  eyebrow = 'Edit',
  theme = null,
  doc,
}) {
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
  // pixel-quiet is the baked-in look; an optional theme pins light/dark
  // (otherwise the panel follows the OS via prefers-color-scheme).
  const themeClass = theme === 'dark' ? ' dark' : theme === 'light' ? ' light' : ''
  root.className =
    'hcms-shell pixel-quiet hcms-side-' + side + (overlay ? ' hcms-overlay' : '') + themeClass
  const titleHtml = escapeHtml(title)
  const eyebrowHtml = escapeHtml(eyebrow)
  // Pixel Quiet shell: a scroll-away header + in-flow Save inside .hcms-shell-body,
  // with a condensed minibar pinned to the panel top once the header scrolls out.
  // Close + Save are real mirk buttons. The .hcms-* hooks stay so the engine and
  // events bind exactly as before; only the chrome shape changed.
  // The Save button has no wiring here: [trigger-save] is the hyperclayjs save
  // attribute — its save system (or its view-mode notice) handles the click.
  // Standalone hosts delegate their own [trigger-save] click listener.
  root.innerHTML = `
    <div class="hcms-shell-minibar" aria-hidden="true">
      <span class="hcms-shell-minibar-title">${titleHtml}</span>
      <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
        <span class="mirk-button__label">×</span>
      </button>
    </div>
    <div class="hcms-shell-body">
      <header class="hcms-shell-header">
        <div class="hcms-shell-heading">
          <div class="hcms-shell-eyebrow">${eyebrowHtml}</div>
          <h2 class="hcms-shell-title" id="${titleId}">${titleHtml}</h2>
        </div>
        <button type="button" class="hcms-shell-close mirk-button mirk-button--small" data-hcms-action="close" aria-label="Close">
          <span class="mirk-button__label">×</span>
        </button>
      </header>
      <div class="hcms-shell-notice" role="status" hidden></div>
      <div class="hcms-shell-error" role="alert" hidden></div>
      <div data-hcms-form-root class="hcms-form"></div>
      <footer class="hcms-shell-footer"${showSaveButton ? '' : ' hidden'}>
        <button type="button" class="hcms-shell-save mirk-button" trigger-save>
          <span class="mirk-button__label">Save</span>
        </button>
      </footer>
    </div>
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
  const condense = installCondenseOnScroll(root)

  return {
    root,
    formRoot: root.querySelector('[data-hcms-form-root]'),
    noticeEl: root.querySelector('.hcms-shell-notice'),
    errorEl: root.querySelector('.hcms-shell-error'),
    saveButton: root.querySelector('.hcms-shell-save'),
    destroy() {
      focusTrap.detach()
      condense.detach()
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
    // save-ignore mirrors the shell root so a full-document morph (e.g. a live-sync
    // head-merge) preserves the stylesheet instead of stripping it; without it the
    // style survives only via restoreChrome's reactive re-injection.
    style.setAttribute('save-ignore', '')
    style.textContent = cssText
    ;(doc.head || doc.documentElement).appendChild(style)
    styledDocs.add(doc)
    return
  }
  // No bundled CSS — try resolving the sibling generated theme via
  // import.meta.url. Browsers ESM-resolved imports place a co-located
  // theme.generated.css next to hypercms.js. Falls back silently if resolution
  // fails (e.g., bundlers without an asset emitter).
  try {
    const href = new URL('./theme.generated.css', import.meta.url).href
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.id = SHELL_STYLE_ID
    link.setAttribute('save-remove', '')
    link.setAttribute('save-ignore', '')
    link.href = href
    ;(doc.head || doc.documentElement).appendChild(link)
    styledDocs.add(doc)
  } catch (_) {
    // No bundled CSS and no resolvable co-located theme (e.g. the IIFE bundle,
    // where import.meta is undefined). Warn loudly rather than mount a silently
    // unstyled shell — the host must call installStyles(themeText) before opening.
    console.warn(
      'hypercms: shell stylesheet not applied — cssText is empty and the ' +
      'co-located theme fallback is unavailable. Call installStyles(themeText) ' +
      'before opening the CMS.'
    )
  }
}

// Reveal the condensed minibar once the full header scrolls out of the body
// (pixel-quiet decision 0003). Passive listener; toggles .is-condensed on the
// shell root when scrollTop passes the header height. No-op if the body or
// header is missing (e.g. a custom mount that omits them).
function installCondenseOnScroll(root) {
  const bodyEl = root.querySelector('.hcms-shell-body')
  const header = root.querySelector('.hcms-shell-header')
  if (!bodyEl || !header || typeof bodyEl.addEventListener !== 'function') {
    return { detach() {} }
  }
  const reveal = () => {
    const trigger = (header.offsetHeight || 0) - 12
    root.classList.toggle('is-condensed', bodyEl.scrollTop > trigger)
  }
  bodyEl.addEventListener('scroll', reveal, { passive: true })
  reveal()
  return { detach() { bodyEl.removeEventListener('scroll', reveal) } }
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
