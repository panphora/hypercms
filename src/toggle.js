// Floating bottom-right button that toggles the CMS open/closed, so a page
// owner can reopen the CMS after closing it (the shell's X is the only other
// affordance, and nothing reopens it). Injected at page load only when the
// visitor is in edit mode AND the page actually has cms rules, so regular
// visitors and rules-less pages (hypercms rides in broad presets) never see it.
// Runtime-only chrome: no-save + snapshot-remove keep it out of every save and
// snapshot (a static no-save element written into the file would be stripped
// from disk on the first save), save-ignore keeps it out of autosave/undo,
// mirroring the shell's own attributes.

const TOGGLE_ID = 'hcms-toggle'
const STYLE_ID = 'hcms-toggle-style'

const STYLE = `
#hcms-toggle {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147482900;
  display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px;
  border: 1px solid #3a3f58; background: #14161f; color: #f2f3f7;
  font: 500 13px/1 system-ui, sans-serif; border-radius: 999px; cursor: pointer;
  box-shadow: 0 10px 28px -12px rgba(0, 0, 0, .55);
}
#hcms-toggle:hover { background: #1d2030; }
#hcms-toggle .hcms-toggle__close { display: none; }
body.hcms-open #hcms-toggle .hcms-toggle__open { display: none; }
body.hcms-open #hcms-toggle .hcms-toggle__close { display: inline; }
body.hcms-open:not(.hcms-overlay):not(.hcms-side-left) #hcms-toggle { right: calc(380px + 16px); }
body.hcms-open.hcms-overlay #hcms-toggle { display: none; }
`

// Mirrors hyperclayjs core/isAdminOfCurrentResource.js: an explicit
// ?editmode=true|false param wins, then the window.__hyperclayEditMode global
// (standalone opt-in), then the platform's isAdminOfCurrentResource cookie.
// Replicated here rather than read off window.hyperclay because the edit-mode
// module isn't part of the cms preset, so the global isn't reliably present.
export function detectEditMode({ search = '', cookie = '', forced = null } = {}) {
  const str = typeof search === 'string' ? search : ''
  const qIndex = str.indexOf('?')
  const query = qIndex === -1 ? str : str.slice(qIndex + 1)
  const param = new URLSearchParams(query).get('editmode')
  if (param) return param === 'true'
  if (forced != null) return Boolean(forced)
  return /(?:^|;\s*)isAdminOfCurrentResource=[^;]/.test(cookie)
}

export function injectToggle({ open, close, isOpen }, doc = document) {
  const existing = doc.getElementById(TOGGLE_ID)
  if (existing) return existing
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    style.setAttribute('snapshot-remove', '')
    style.textContent = STYLE
    doc.head.appendChild(style)
  }
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.id = TOGGLE_ID
  btn.setAttribute('no-save', '')
  btn.setAttribute('snapshot-remove', '')
  btn.setAttribute('save-ignore', '')
  btn.setAttribute('aria-label', 'Toggle content editor')
  btn.innerHTML = '<span class="hcms-toggle__open">Edit content</span><span class="hcms-toggle__close">Close editor</span>'
  btn.addEventListener('click', async () => {
    try {
      if (isOpen()) close()
      else await open()
    } catch (err) {
      console.warn('hypercms: toggle failed to open the CMS', err)
    }
  })
  doc.body.appendChild(btn)
  return btn
}

// Inject at page load when in edit mode and the page has cms rules. DOM-ready
// deferral matters when the module evaluates while the document is still
// parsing (the rules tag or <body> may not exist yet).
export function maybeInjectToggle(api) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const forced = window.__hyperclayEditMode != null ? window.__hyperclayEditMode : null
  if (!detectEditMode({ search: window.location.search, cookie: document.cookie, forced })) return
  const run = () => { if (document.body && api.hasRules(document)) injectToggle(api) }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
}
