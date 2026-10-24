// Icons for the variant control. Each is a 32x20 outline drawing in
// currentColor; a page names one in data-hcms-options ("2:cols-2"), never
// supplies markup of its own.

const svg = (body) =>
  `<svg viewBox="0 0 32 20" width="32" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${body}</svg>`
const box = (x, y, w, h, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1"${extra}/>`
const line = (x1, y, x2) => `<path d="M${x1} ${y}H${x2}"/>`
const solid = ' fill="currentColor" fill-opacity="0.3"'

export const VARIANT_ICONS = Object.freeze({
  'cols-1': { label: 'One column', svg: svg(box(2, 2, 28, 16)) },
  'cols-2': { label: 'Two columns', svg: svg(box(2, 2, 13, 16) + box(17, 2, 13, 16)) },
  'cols-3': { label: 'Three columns', svg: svg(box(2, 2, 8, 16) + box(12, 2, 8, 16) + box(22, 2, 8, 16)) },
  'cols-4': { label: 'Four columns', svg: svg(box(2, 2, 5.5, 16) + box(9.5, 2, 5.5, 16) + box(17, 2, 5.5, 16) + box(24.5, 2, 5.5, 16)) },
  'media-left': { label: 'Image left', svg: svg(box(2, 3, 12, 14, solid) + line(18, 6, 30) + line(18, 10, 30) + line(18, 14, 26)) },
  'media-right': { label: 'Image right', svg: svg(box(18, 3, 12, 14, solid) + line(2, 6, 14) + line(2, 10, 14) + line(2, 14, 10)) },
  'media-top': { label: 'Image on top', svg: svg(box(2, 2, 28, 8, solid) + line(2, 14, 30) + line(2, 17, 22)) },
  list: { label: 'List', svg: svg(line(3, 5, 4) + line(8, 5, 29) + line(3, 10, 4) + line(8, 10, 29) + line(3, 15, 4) + line(8, 15, 29)) },
  cards: { label: 'Cards', svg: svg(box(2, 2, 13, 7) + box(17, 2, 13, 7) + box(2, 11, 13, 7) + box(17, 11, 13, 7)) },
  centered: { label: 'Centered', svg: svg(line(6, 5, 26) + line(9, 10, 23) + line(11, 15, 21)) },
  'card-flat': { label: 'Flat', svg: svg(box(5, 3, 22, 14)) },
  'card-raised': { label: 'Raised', svg: svg(box(7, 5, 22, 14, ' stroke-opacity="0.35"') + box(4, 2, 22, 14, ' fill="var(--mirk-bg, transparent)"')) },
})
