#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { assertDepsInRange } from './assert-deps-in-range.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const distFile = path.join(rootDir, 'dist', 'hypercms.min.js')
const vendorFile = path.join(rootDir, '..', 'hyperclayjs', 'src', 'vendor', 'hypercms.vendor.js')

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

const isCheck = process.argv.includes('--check')

if (!fs.existsSync(distFile)) {
  if (isCheck) process.exit(1)
  console.error('Error: dist/hypercms.min.js not found. Run "npm run build" first.')
  process.exit(1)
}

assertDepsInRange(rootDir, { silent: isCheck })

const minified = fs.readFileSync(distFile, 'utf8').trim()
const expected = minified + '\n' + WRAPPER_CODE

if (isCheck) {
  if (!fs.existsSync(vendorFile)) process.exit(1)
  const actual = fs.readFileSync(vendorFile, 'utf8')
  process.exit(actual === expected ? 0 : 1)
}

const vendorDir = path.dirname(vendorFile)
if (!fs.existsSync(vendorDir)) {
  console.error(`Error: hyperclayjs vendor folder not found at ${vendorDir}`)
  console.error('Make sure hyperclayjs is in the parent directory.')
  process.exit(1)
}

fs.writeFileSync(vendorFile, expected, 'utf8')
console.log('✓ Updated hyperclayjs/src/vendor/hypercms.vendor.js')
