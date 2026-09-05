import { JSDOM } from 'jsdom'

// Each test gets a fresh JSDOM realm. The previous dom's classes leak onto
// globalThis after `dom.close()`, so we MUST refresh anything used in
// cross-realm `instanceof` checks. Notably hyper-morph checks
// HTMLInputElement / HTMLOptionElement / HTMLTextAreaElement when syncing
// form state — if those reference the previous realm, the check silently
// fails and form values don't morph.
const FORCE_REFRESH = [
  'Node', 'Element', 'HTMLElement', 'HTMLTemplateElement', 'Document',
  'DocumentFragment', 'Event', 'CustomEvent', 'NodeList', 'HTMLCollection',
  'MutationObserver', 'Text', 'Comment', 'CSS',
  // Form-state-relevant classes for hyper-morph cross-realm checks:
  'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
  'HTMLOptionElement', 'HTMLAnchorElement', 'HTMLImageElement',
  'HTMLButtonElement', 'HTMLFormElement', 'HTMLLabelElement',
]

export function loadPage(html) {
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true })
  // jsdom implements no window.CSS at all, and hyper-morph calls CSS.escape the
  // moment a morph has to move an element by id — which a full-document morph
  // over a page carrying ids does. Without this the morph throws
  // ReferenceError: CSS is not defined, in the test realm only.
  if (dom.window.CSS === undefined) dom.window.CSS = { escape: escapeIdent }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  for (const k of FORCE_REFRESH) {
    if (dom.window[k] !== undefined) {
      try { globalThis[k] = dom.window[k] } catch {}
    }
  }
  for (const k of Object.getOwnPropertyNames(dom.window)) {
    if (k in globalThis) continue
    const v = dom.window[k]
    if (typeof v === 'function' || (v && typeof v === 'object')) {
      try { globalThis[k] = v } catch {}
    }
  }
  // hypercms requires window.hyperclay.Mutation. In tests we don't exercise
  // page-change-driven refresh, so a stub that satisfies the API contract is
  // enough. Tests that want to trigger refresh call cms.refresh() directly.
  installMutationStub(dom.window)
  return dom
}

// Deliberately standalone rather than reusing src/events.js's cssEscape: that
// one delegates to CSS.escape when it exists, so wiring it in as CSS.escape
// makes it call itself forever.
function escapeIdent(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c)
}

function installMutationStub(win) {
  const stub = {
    onAnyChange: (_opts, _callback) => () => {},
    onAddOrRemove: (_opts, _callback) => () => {},
    onAddElement: (_opts, _callback) => () => {},
    onRemoveElement: (_opts, _callback) => () => {},
    onAttribute: (_opts, _callback) => () => {},
    pause() {},
    resume() {},
  }
  win.hyperclay = win.hyperclay || {}
  win.hyperclay.Mutation = stub
  globalThis.hyperclay = win.hyperclay
}

export function reset(dom) {
  try { dom.window.close() } catch {}
}
