import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) throw new Error(`${label} version "${value}" is not X.Y.Z`)
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

export function satisfiesSupportedRange(versionText, range) {
  const version = parseVersion(versionText, 'HyperMorph')
  const exact = /^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (exact) return compareVersions(version, exact.slice(1).map(Number)) === 0

  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (!caret) {
    throw new Error(`unsupported hyper-morph dependency range "${range}"; use an exact or caret X.Y.Z range`)
  }
  const minimum = caret.slice(1).map(Number)
  let maximum
  if (minimum[0] > 0) maximum = [minimum[0] + 1, 0, 0]
  else if (minimum[1] > 0) maximum = [0, minimum[1] + 1, 0]
  else maximum = [0, 0, minimum[2] + 1]
  return compareVersions(version, minimum) >= 0 && compareVersions(version, maximum) < 0
}

function readJson(file, label) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`${label} is unreadable at ${file}: ${error.message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} is invalid JSON at ${file}: ${error.message}`)
  }
}

function findPackage(importer) {
  let directory = path.dirname(path.resolve(importer))
  for (;;) {
    const file = path.join(directory, 'package.json')
    if (fs.existsSync(file)) return { file, pkg: readJson(file, 'importer package') }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`cannot find a package.json for hyper-morph importer ${importer}`)
}

async function expectedStandalone(morphRoot) {
  const source = path.join(morphRoot, 'src', 'hyper-morph.js')
  if (!fs.existsSync(source)) throw new Error(`HyperMorph source is missing at ${source}`)
  const requireFromMorph = createRequire(path.join(morphRoot, 'package.json'))
  let esbuild
  try {
    esbuild = requireFromMorph('esbuild')
  } catch (error) {
    throw new Error(`HyperMorph build dependency is unavailable from ${morphRoot}: ${error.message}`)
  }
  const result = await esbuild.build({
    entryPoints: [source],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'HyperMorph',
    write: false,
  })
  const output = result.outputFiles?.[0]?.text
  if (!output) throw new Error('HyperMorph source rebuild produced no bytes')
  return output
}

function assertExactFile(file, expected, label) {
  let actual
  try {
    actual = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`${label} is unreadable at ${file}: ${error.message}`)
  }
  if (actual !== expected) throw new Error(`${label} is stale at ${file}`)
}

export async function assertSharedHyperMorph({
  rootDir,
  workspace = path.dirname(rootDir),
  resolvedImporters,
  morphRoot = path.join(workspace, 'hyper-morph'),
  distFile = path.join(morphRoot, 'dist', 'hyper-morph.min.js'),
  vendorFile = path.join(workspace, 'clayjs', 'src', 'vendor', 'hyper-morph.vendor.js'),
} = {}) {
  if (!rootDir) throw new Error('rootDir is required')
  if (!Array.isArray(resolvedImporters) || resolvedImporters.length === 0) {
    throw new Error('shared CMS build resolved zero hyper-morph imports')
  }

  const morphPackage = readJson(path.join(morphRoot, 'package.json'), 'HyperMorph package')
  const version = morphPackage.version
  parseVersion(version, 'HyperMorph')

  const packages = new Map()
  for (const importer of resolvedImporters) {
    const found = findPackage(importer)
    packages.set(found.file, found.pkg)
  }
  if (packages.size === 0) throw new Error('shared CMS build found zero importing packages')
  for (const pkg of packages.values()) {
    const range = pkg.dependencies?.['hyper-morph']
    if (!range) throw new Error(`${pkg.name || 'unnamed package'} imports hyper-morph without declaring it`)
    if (!satisfiesSupportedRange(version, range)) {
      throw new Error(`hyper-morph@${version} does not satisfy ${pkg.name || 'unnamed package'} range ${range}`)
    }
  }

  const expectedDist = await expectedStandalone(morphRoot)
  assertExactFile(distFile, expectedDist, 'HyperMorph distribution')

  const formatUrl = pathToFileURL(path.join(morphRoot, 'scripts', 'vendor-format.js')).href
  let buildVendor
  try {
    ;({ buildVendor } = await import(formatUrl))
  } catch (error) {
    throw new Error(`HyperMorph vendor format is unavailable: ${error.message}`)
  }
  assertExactFile(vendorFile, buildVendor(expectedDist), 'ClayJS HyperMorph vendor')

  return {
    version,
    importerPackages: [...packages.values()].map((pkg) => pkg.name || '(unnamed)'),
    distBytes: Buffer.byteLength(expectedDist),
  }
}
