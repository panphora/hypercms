#!/usr/bin/env node

// The clayjs half of delivery. Its twin, copy-to-hyperclayjs.js, writes the other
// client; the two bundles must stay byte-identical, so the wrapper below has to
// match that script's exactly.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { assertDepsInRange } from './assert-deps-in-range.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const workspace = path.join(rootDir, '..')

const distFile = path.join(rootDir, 'dist', 'hypercms.min.js')

const WRAPPER_CODE = `
// Auto-export to window unless suppressed by loader.
// Per hypercms plan locked decision 3: flatten to hyperclay.hypercms.open(),
// not hyperclay.hypercms.cms.open().
if (!window.__hyperclayNoAutoExport) {
  window.hyperclay = window.hyperclay || {};
  window.hyperclay.hypercms = hypercms.cms;
  window.h = window.hyperclay;
}

export const cms = hypercms.cms;
export default hypercms;
`

// Every clayjs copy of hypercms, in one list. A missing path is a failure, not a
// destination to skip quietly: a delivery that silently reaches one client and not
// the other is how this bug class stayed invisible, with the clayjs copy drifting
// behind while the script reported success.
const DESTINATIONS = ['clayjs/src/vendor/hypercms.vendor.js']

const isCheck = process.argv.includes('--check')

if (!fs.existsSync(distFile)) {
  if (isCheck) process.exit(1)
  console.error('Error: dist/hypercms.min.js not found. Run "npm run build" first.')
  process.exit(1)
}

assertDepsInRange(rootDir, { silent: isCheck })

const expected = fs.readFileSync(distFile, 'utf8').trim() + '\n' + WRAPPER_CODE

if (isCheck) {
  const stale = DESTINATIONS.some(destination => {
    const file = path.join(workspace, destination)
    if (!fs.existsSync(file)) return true
    return fs.readFileSync(file, 'utf8') !== expected
  })
  process.exit(stale ? 1 : 0)
}

const missing = DESTINATIONS.filter(
  destination => !fs.existsSync(path.dirname(path.join(workspace, destination)))
)
if (missing.length) {
  missing.forEach(destination => {
    console.error(`Error: destination folder not found for ${destination}`)
  })
  console.error(`Every destination is resolved against ${workspace}.`)
  process.exit(1)
}

DESTINATIONS.forEach(destination => {
  fs.writeFileSync(path.join(workspace, destination), expected, 'utf8')
  console.log(`✓ Updated ${destination}`)
})
