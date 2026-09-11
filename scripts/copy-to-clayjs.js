#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildClayjs } from './build-js.js'

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const vendorFile = path.join(rootDir, '..', 'clayjs', 'src', 'vendor', 'hypercms.vendor.js')
const isCheck = process.argv.includes('--check')

const { result } = await buildClayjs({
  outfile: vendorFile,
  write: !isCheck,
  hyperHtmlApiSource: path.join(rootDir, '..', 'hyper-html-api'),
})

if (isCheck) {
  let actual
  try {
    actual = fs.readFileSync(vendorFile, 'utf8')
  } catch {
    process.exit(1)
  }
  const expected = result.outputFiles?.[0]?.text
  process.exit(actual === expected ? 0 : 1)
}

console.log('✓ Updated clayjs/src/vendor/hypercms.vendor.js')
