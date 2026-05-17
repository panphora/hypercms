const SHELL_STYLE_ID = 'hcms-shell-styles'
const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let stylesInjected = false
let cssText = ''

export function setShellStyles(text) {
  cssText = text
}

export function mountShell({ mountTo, side = 'right', overlay = false, showSaveButton = false, doc }) {
  ensureStyles(doc)
  const root = doc.createElement('div')
  root.setAttribute('data-hcms-shell', '')
  root.setAttribute('save-ignore', '')
  root.setAttribute('tabindex', '-1')
  root.className = 'hcms-shell hcms-side-' + side + (overlay ? ' hcms-overlay' : '')
  root.innerHTML = `
    <header class="hcms-shell-header">
      <h2 class="hcms-shell-title">Edit</h2>
      <button type="button" class="hcms-shell-close" data-hcms-action="close" aria-label="Close">×</button>
    </header>
    <div class="hcms-shell-error" role="alert" hidden></div>
    <div data-hcms-form-root class="hcms-form"></div>
    <footer class="hcms-shell-footer"${showSaveButton ? '' : ' hidden'}>
      <button type="button" class="hcms-shell-save" data-hcms-action="save">Save</button>
    </footer>
  `

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
  }
}

function ensureStyles(doc) {
  if (stylesInjected) return
  if (!cssText) return
  if (doc.getElementById(SHELL_STYLE_ID)) {
    stylesInjected = true
    return
  }
  const style = doc.createElement('style')
  style.id = SHELL_STYLE_ID
  style.textContent = cssText
  ;(doc.head || doc.documentElement).appendChild(style)
  stylesInjected = true
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
