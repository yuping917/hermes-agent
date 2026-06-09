/**
 * Vitest config for the Node-26 engine (replaces `bun test`).
 *
 * Same Solid transform as the production build (scripts/build.mjs): app .tsx/.jsx
 * go through babel-preset-solid in `generate:"universal"` mode with
 * `moduleName:"@opentui/solid"`, and solid-js resolves to its CLIENT build (the
 * package `node` condition points at the SSR `server.js`, which lacks the
 * universal reactive primitives). See docs/plans/opentui-node26-build-spec.md.
 *
 * render.test.tsx mounts the native @opentui/solid test renderer, so the test
 * forks need `--experimental-ffi`. We inject it into NODE_OPTIONS here (the config
 * runs in vitest's main process before it forks workers, which inherit the env) —
 * self-contained and cross-platform, no shell wrapper needed. The other suites are
 * pure logic.
 */
import { transformAsync } from '@babel/core'
import tsPreset from '@babel/preset-typescript'
import solidPreset from 'babel-preset-solid'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)

// Ensure forked test workers load OpenTUI's native core via node:ffi.
const ffiOpts = '--experimental-ffi --no-warnings'
if (!(process.env.NODE_OPTIONS ?? '').includes('--experimental-ffi')) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${ffiOpts}`.trim()
}

const opentuiSolid = (): Plugin => ({
  name: 'opentui-solid',
  enforce: 'pre',
  async transform(code, id) {
    const path = id.split('?')[0]
    if (!/\.[cm]?[jt]sx$/.test(path) || path.includes('/node_modules/')) return null
    const out = await transformAsync(code, {
      filename: path,
      configFile: false,
      babelrc: false,
      sourceMaps: true,
      presets: [[solidPreset, { moduleName: '@opentui/solid', generate: 'universal' }], [tsPreset]]
    })
    return out?.code ? { code: out.code, map: out.map } : null
  }
})

export default defineConfig({
  plugins: [opentuiSolid()],
  resolve: {
    alias: [
      { find: /^solid-js\/store$/, replacement: require.resolve('solid-js/store/dist/store.js') },
      { find: /^solid-js$/, replacement: require.resolve('solid-js/dist/solid.js') }
    ]
  },
  test: {
    include: ['src/test/**/*.test.{ts,tsx}']
  }
})
