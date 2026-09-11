import * as hypercms from './hypercms-bundle.js'

if (typeof window !== 'undefined' && !window.__hyperclayNoAutoExport) {
  window.hyperclay = window.hyperclay || {}
  window.hyperclay.hypercms = hypercms.cms
  window.h = window.hyperclay
}

export const cms = hypercms.cms
export default hypercms
