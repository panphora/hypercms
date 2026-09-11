const paths = {
  edit: 'M8 10h2v6H8zm2 4h4v2h-4zm0-6h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zm-4 0h2v2h-2z',
  'move-up': 'M11 4h2v2h2v2h2v2h2v2h-4v-2h-2v10h-2V10H9v2H5v-2h2V8h2V6h2z',
  'move-down': 'M11 4h2v10h2v-2h4v2h-2v2h-2v2h-2v2h-2v-2H9v-2H7v-2H5v-2h4v2h2z',
  remove: 'M5 5h3v3h3v3h2V8h3V5h3v3h-3v3h-3v2h3v3h3v3h-3v-3h-3v-3h-2v3H8v3H5v-3h3v-3h3v-2H8V8H5z',
  add: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
}

export function inlineIcon(name) {
  const viewBox = name === 'edit' ? '6 0 18 18' : '0 0 24 24'
  const shape = name === 'settings'
    ? '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>'
    : `<path d="${paths[name]}"/>`
  return `<svg class="hcms-inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">${shape}</svg>`
}
