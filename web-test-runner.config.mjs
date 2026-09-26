import { chromeLauncher } from '@web/test-runner-chrome'
import { importMapsPlugin } from '@web/dev-server-import-maps'

// Browser test tier for hypercms. rootDir is the workspace root (parent of
// hypercms) so specs can import sibling packages by relative path that are NOT
// npm-resolvable: ../src/hypercms.js and ../../hyper-undo/src/index.js.
// concurrency:1 because specs mutate the shared window.hyperclay.undo singleton.
// The import map mirrors hyper-html-api's runner: hypercms -> hyper-html-api ->
// cms/node-content.js imports the bare specifier 'hyper-morph', a sibling
// workspace package (not an npm dep), so map it to its served source.
export default {
  files: 'test-browser/**/*.test.js',
  nodeResolve: true,
  rootDir: '../',
  concurrency: 1,
  plugins: [
    importMapsPlugin({
      inject: {
        importMap: {
          imports: {
            'hyper-morph': '/hyper-morph/src/hyper-morph.js',
          },
        },
      },
    }),
  ],
  browsers: [
    chromeLauncher({ launchOptions: { headless: true, args: ['--no-sandbox'] } }),
  ],
  testFramework: { config: { timeout: '10000' } },
}
