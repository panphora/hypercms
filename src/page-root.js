// The CMS reads and writes the whole document, so a rule can bind <html> (the
// page's theme properties) or the <head>. Everything that needs an element to
// stand for the page (event payloads and dispatch, structural rollback, the
// inline view's page listeners) keeps using <body>, where the content lives.
export function contentRoot(pageRoot) {
  if (pageRoot && pageRoot.nodeType === 9) return pageRoot.body || pageRoot.documentElement
  return pageRoot
}
