#!/usr/bin/env node

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

import { assertSharedHyperMorph } from './shared-hyper-morph.js'

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

function hyperMorphPlugin({ source, external } = {}) {
  const resolvedImporters = []
  return {
    resolvedImporters,
    plugin: {
      name: external ? 'external-shared-hyper-morph' : 'corrected-hyper-morph-source',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^hyper-morph$/ }, (args) => {
          resolvedImporters.push(path.resolve(args.resolveDir, args.importer))
          if (external) return { path: './hyper-morph.vendor.js', external: true }
          if (source) return { path: path.resolve(source) }
          return null
        })
      },
    },
  }
}

function hyperHtmlApiPlugin(source) {
  const resolvedImports = []
  const entries = {
    '': 'src/hyper-html-api.js',
    engine: 'src/engine/index.js',
    dom: 'src/adapters/dom.js',
    data: 'src/data.js',
    cms: 'src/cms/index.js',
  }
  return {
    resolvedImports,
    plugin: {
      name: 'local-hyper-html-api-source',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^hyper-html-api(?:\/(.*))?$/ }, args => {
          const suffix = args.path.includes('/') ? args.path.slice(args.path.indexOf('/') + 1) : ''
          const entry = entries[suffix]
          if (!entry) throw new Error(`unsupported local hyper-html-api subpath: ${args.path}`)
          resolvedImports.push(args.path)
          return { path: path.resolve(source, entry) }
        })
      },
    },
  }
}

export async function buildStandalone({ outfile, hyperMorphSource, hyperHtmlApiSource, write = true } = {}) {
  const resolver = hyperMorphPlugin({ source: hyperMorphSource })
  const htmlResolver = hyperHtmlApiSource ? hyperHtmlApiPlugin(hyperHtmlApiSource) : null
  const result = await build({
    entryPoints: [path.join(rootDir, 'src', 'hypercms-bundle.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'hypercms',
    loader: { '.css': 'text' },
    outfile,
    write,
    metafile: true,
    plugins: [hyperMorphSource ? resolver.plugin : null, htmlResolver?.plugin].filter(Boolean),
  })
  if (hyperMorphSource && resolver.resolvedImporters.length === 0) {
    throw new Error('corrected standalone build resolved zero hyper-morph imports')
  }
  if (htmlResolver && htmlResolver.resolvedImports.length === 0) throw new Error('local build resolved zero hyper-html-api imports')
  return { result, resolvedImporters: resolver.resolvedImporters }
}

export async function buildClayjs({ outfile, hyperHtmlApiSource, write = true, verify = true } = {}) {
  const resolver = hyperMorphPlugin({ external: true })
  const htmlResolver = hyperHtmlApiSource ? hyperHtmlApiPlugin(hyperHtmlApiSource) : null
  const result = await build({
    entryPoints: [path.join(rootDir, 'src', 'hypercms-clayjs.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    loader: { '.css': 'text' },
    outfile,
    write: false,
    metafile: true,
    plugins: [resolver.plugin, htmlResolver?.plugin].filter(Boolean),
  })
  let provenance = null
  if (verify) {
    provenance = await assertSharedHyperMorph({
      rootDir,
      resolvedImporters: resolver.resolvedImporters,
    })
  }
  if (htmlResolver && htmlResolver.resolvedImports.length === 0) throw new Error('local build resolved zero hyper-html-api imports')
  if (write) {
    if (!outfile) throw new Error('ClayJS output path is required when write is enabled')
    if (!fs.existsSync(path.dirname(outfile))) {
      throw new Error(`ClayJS output folder does not exist at ${path.dirname(outfile)}`)
    }
    fs.writeFileSync(outfile, result.outputFiles[0].contents)
  }
  return { result, resolvedImporters: resolver.resolvedImporters, provenance }
}

function readArg(name) {
  const exact = process.argv.indexOf(name)
  if (exact !== -1) return process.argv[exact + 1]
  const prefix = `${name}=`
  const joined = process.argv.find((arg) => arg.startsWith(prefix))
  return joined ? joined.slice(prefix.length) : null
}

async function main() {
  const standalone = process.argv.includes('--standalone')
  const clayjs = process.argv.includes('--clayjs')
  if (standalone === clayjs) throw new Error('choose exactly one of --standalone or --clayjs')

  const sourceArg = readArg('--hyper-morph-source')
  const hyperMorphSource = sourceArg ? path.resolve(rootDir, sourceArg) : null
  const htmlSourceArg = readArg('--hyper-html-api-source')
  const hyperHtmlApiSource = htmlSourceArg ? path.resolve(rootDir, htmlSourceArg) : null
  const outputArg = readArg('--outfile')
  const outfile = outputArg
    ? path.resolve(rootDir, outputArg)
    : hyperMorphSource
      ? path.join(os.tmpdir(), 'hypercms.corrected.min.js')
      : path.join(rootDir, 'dist', standalone ? 'hypercms.min.js' : 'hypercms.clayjs.js')

  if (standalone) await buildStandalone({ outfile, hyperMorphSource, hyperHtmlApiSource })
  else await buildClayjs({ outfile, hyperHtmlApiSource })
  console.log(`built ${outfile}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
