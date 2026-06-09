/**
 * Build the OpenTUI v2 Solid app for Node 26 (no Bun).
 *
 * Mirrors OpenTUI's own Node recipe (`~/github/opentui/.../run-node26.mjs` +
 * `packages/solid/scripts/solid-transform.ts`): apply babel-preset-solid in
 * `generate:"universal"` mode with `moduleName:"@opentui/solid"` to every app
 * .tsx/.jsx, and force solid-js to its CLIENT/universal build (the package's
 * `node` export condition points at the SSR `server.js`, which lacks the
 * reactive primitives the universal renderer needs).
 *
 * `@opentui/core` stays EXTERNAL: it resolves its per-arch native `libopentui.so`
 * (and the tree-sitter worker) from its own package dir via `import.meta.url`;
 * bundling it would break those paths.
 *
 * Run with the Node that will launch the app:
 *   node scripts/build.mjs                       # → dist/main.js (app entry)
 *   node scripts/build.mjs <entry.tsx> <outdir>  # build an arbitrary entry (smokes/spikes)
 * Launch:
 *   node --experimental-ffi --no-warnings dist/main.js
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { transformAsync } from '@babel/core'
import tsPreset from '@babel/preset-typescript'
import solidPreset from 'babel-preset-solid'
import * as esbuild from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** esbuild plugin that reproduces @opentui/solid's transform + solid-js resolution. */
const opentuiSolid = {
  name: 'opentui-solid',
  setup(build) {
    // App JSX (.tsx/.jsx, never node_modules) → babel-preset-solid (universal).
    build.onLoad({ filter: /\.[cm]?[jt]sx$/ }, async args => {
      if (args.path.includes('/node_modules/')) return null
      const code = await readFile(args.path, 'utf8')
      const out = await transformAsync(code, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        presets: [[solidPreset, { moduleName: '@opentui/solid', generate: 'universal' }], [tsPreset]]
      })
      return { contents: out?.code ?? '', loader: 'js' }
    })

    // Force the universal/client solid-js build (node condition → server.js otherwise).
    build.onResolve({ filter: /^solid-js$/ }, () => ({ path: require.resolve('solid-js/dist/solid.js') }))
    build.onResolve({ filter: /^solid-js\/store$/ }, () => ({ path: require.resolve('solid-js/store/dist/store.js') }))
  }
}

const [, , entryArg, outdirArg] = process.argv
const entry = entryArg ? resolve(process.cwd(), entryArg) : resolve(root, 'src/entry/main.tsx')
const outdir = outdirArg ? resolve(process.cwd(), outdirArg) : resolve(root, 'dist')

await esbuild.build({
  entryPoints: [entry],
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node26',
  splitting: true,
  sourcemap: true,
  logLevel: 'info',
  // Native blob + tree-sitter worker resolve from @opentui/core's own dir at runtime.
  external: ['@opentui/core', '@opentui/core/*'],
  plugins: [opentuiSolid],
  define: { 'process.env.OPENTUI_BUN_ONLY_EXAMPLES': '"false"' }
})
