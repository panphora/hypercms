// The vendored bundle inlines whatever is sitting in node_modules, so building
// against a dependency that does not satisfy package.json writes a stale library
// into two OTHER repos and reports success. That is how hyper-html-api 0.7.0's
// row-identity work would have shipped to hyperclayjs and clayjs as 0.6.5.
//
// npm already knows the tree is wrong. This makes it fatal at the one moment the
// artifact leaves this repo. Only prod dependencies are checked, because only
// those are bundled; a devDependency out of range is not this script's business.

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export function assertDepsInRange(rootDir, { silent = false } = {}) {
  let prodDeps
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
    prodDeps = Object.keys(pkg.dependencies || {})
  } catch {
    return
  }
  if (!prodDeps.length) return

  let raw
  try {
    raw = execFileSync('npm', ['ls', '--json', '--depth=0'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (err) {
    // npm ls exits nonzero precisely when it finds problems, and still writes
    // the tree to stdout. That is the case this exists for, so read it.
    raw = err.stdout
  }

  let tree
  try {
    tree = JSON.parse(raw)
  } catch {
    // No readable tree means no judgement to make. Never block on that.
    return
  }

  const installed = tree.dependencies || {}
  const bad = prodDeps
    .filter((name) => installed[name] && installed[name].invalid)
    .map((name) => `  ${name}@${installed[name].version} does not satisfy ${installed[name].invalid}`)

  if (!bad.length) return
  if (silent) process.exit(1)
  console.error(
    'Error: refusing to vendor against an out-of-range dependency.\n' +
      bad.join('\n') +
      '\n\nThe bundle inlines node_modules, so copying now would write a stale\n' +
      'library into the client repos and report success. Run "npm install" first.',
  )
  process.exit(1)
}
