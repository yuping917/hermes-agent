/**
 * DEV BENCH — NOT a test, NOT production code. Throwaway memory-measurement
 * harness for tuning the rolling `HERMES_TUI_MAX_MESSAGES` cap. Mounts the
 * production `<App store={createSessionStore()}>` under the `@opentui/solid` test
 * renderer and samples `process.memoryUsage()` + the mounted-renderable count +
 * `getAllocatorStats().activeAllocations`, forcing `global.gc()` before each
 * sample. Excluded from the test run (not a *.test.ts) and lint-clean.
 *
 * It pushes a REALISTIC heavy-session fixture (scripts/fixture.ts) — varied user
 * turns + fat multi-part assistant turns (markdown + reasoning + several tool
 * headers) — because per-message size varies hugely, so message-count is only a
 * LOOSE memory proxy and we're choosing a cap default.
 *
 *   node scripts/build.mjs scripts/mem-bench.tsx .bench   # build once (Solid+TS → JS)
 *   Uncapped:  MEM_BENCH_TOTAL=8000 HERMES_TUI_MAX_MESSAGES=100000 \
 *     node --experimental-ffi --expose-gc --no-warnings .bench/mem-bench.js
 *   Capped:    MEM_BENCH_TOTAL=8000 HERMES_TUI_MAX_MESSAGES=1500 \
 *     node --experimental-ffi --expose-gc --no-warnings .bench/mem-bench.js
 *
 * Run each cap as a SEPARATE node invocation so the WASM/native heap starts fresh.
 * The matrix loop:
 *   for cap in 400 1500 3000 6000 100000; do \
 *     MEM_BENCH_TOTAL=8000 HERMES_TUI_MAX_MESSAGES=$cap \
 *       node --experimental-ffi --expose-gc --no-warnings .bench/mem-bench.js; done
 *
 * Signal: native `getAllocatorStats().activeAllocations` (the Zig-side allocator
 * count — every live renderable/Yoga subtree contributes) and the recursive
 * renderable descendant count under `renderer.root`. RSS is reported too but is
 * noisy and grow-only (WASM linear memory never returns to the OS), so the
 * meaningful comparison is the STEADY-STATE plateau: capped should flatten after
 * ~CAP messages; uncapped should keep climbing.
 *
 * GC: forces `global.gc()` (synchronous) before each sample to measure RETAINED
 * memory, not garbage — run Node with `--expose-gc` or the GC call is a no-op.
 *
 * RESUME PATH: after the live push matrix, builds the full fixture as a settled
 * Message[] and `commitSnapshot`s it (the resume path), reporting mounted nodes +
 * RSS — verifying the slice-before-set fix bounds resume mounting to ≤ cap.
 */
import { resolveRenderLib } from '@opentui/core'
import type { Renderable } from '@opentui/core'
import { testRender } from '@opentui/solid'

import { createSessionStore } from '../src/logic/store.ts'
import { App } from '../src/view/App.tsx'
import { ThemeProvider } from '../src/view/theme.tsx'
import { applyTurn, materialize, rowsPerTurn } from './fixture.ts'

const lib = resolveRenderLib()

const TOTAL = Number.parseInt(process.env.MEM_BENCH_TOTAL ?? '8000', 10)
const SAMPLE_EVERY = Number.parseInt(process.env.MEM_BENCH_SAMPLE ?? '500', 10)
const cap = process.env.HERMES_TUI_MAX_MESSAGES ?? '(default 400)'

const MB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/** Force a synchronous full GC to measure RETAINED memory. No-op without `node --expose-gc`. */
const forceGc = (): void => {
  const gc = (globalThis as { gc?: () => void }).gc
  if (gc) gc()
}

/** Recursively count every Renderable under root (a proxy for live Yoga nodes). */
function descendantCount(node: Renderable): number {
  let n = 0
  for (const child of node.getChildren()) n += 1 + descendantCount(child)
  return n
}

async function main(): Promise<void> {
  const store = createSessionStore()
  store.apply({ type: 'gateway.ready' })

  const setup = await testRender(
    () => (
      <ThemeProvider theme={() => store.state.theme}>
        <App store={store} />
      </ThemeProvider>
    ),
    { width: 100, height: 40, exitOnCtrlC: false }
  )
  await setup.renderOnce()
  await setup.flush()

  process.stdout.write(
    `\n=== mem-bench (REALISTIC fixture)  cap=${cap}  total=${TOTAL}  sampleEvery=${SAMPLE_EVERY} ===\n`
  )
  process.stdout.write(
    'pushes | msgs | rss(MB) | heapUsed(MB) | external(MB) | arrayBuf(MB) | activeAllocs | renderables\n'
  )
  process.stdout.write(
    '-------+------+---------+--------------+--------------+--------------+--------------+------------\n'
  )

  async function sample(pushes: number): Promise<void> {
    await setup.renderOnce()
    await setup.flush()
    forceGc() // synchronous, full GC — measure retained, not garbage
    const m = process.memoryUsage()
    const alloc = lib.getAllocatorStats()
    const renderables = descendantCount(setup.renderer.root)
    const cols = [
      String(pushes).padStart(6),
      String(store.state.messages.length).padStart(4),
      MB(m.rss).padStart(7),
      MB(m.heapUsed).padStart(12),
      MB(m.external).padStart(12),
      MB(m.arrayBuffers).padStart(12),
      String(alloc.activeAllocations).padStart(12),
      String(renderables).padStart(11)
    ]
    process.stdout.write(cols.join(' | ') + '\n')
  }

  await sample(0)
  // Pump turns inline, sampling each time the cumulative produced-row count crosses
  // a SAMPLE_EVERY boundary. Sampling is async (renderOnce/flush/gc), so it lives
  // in the loop rather than a sync callback. Mounting is synchronous in Solid, so a
  // render pass at the boundary reflects the just-pushed turns.
  let pushed = 0
  let nextSample = SAMPLE_EVERY
  let turn = 0
  while (pushed < TOTAL) {
    applyTurn(store, turn)
    pushed += rowsPerTurn(turn)
    turn++
    if (pushed >= nextSample) {
      await sample(Math.min(pushed, TOTAL))
      while (nextSample <= pushed) nextSample += SAMPLE_EVERY
    }
  }

  // Tear down the live push tree BEFORE the resume path so its mounted nodes don't
  // pollute the process-wide RSS the resume sample reads. (The renderable COUNT is
  // already isolated per-renderer-root, but RSS is process-global.)
  store.clearTranscript()
  setup.renderer.destroy()
  forceGc()

  // ── RESUME PATH: build the full settled fixture and commitSnapshot it (the
  // resume hydrate path). Verifies the slice-before-set fix bounds resume mounting
  // to ≤ cap — mounting 8000 settled msgs at cap=1500 should mount ~1500-worth of
  // rows, NOT 8000-worth. Done on a FRESH store + renderer so the live-push history
  // above doesn't skew the count.
  const resumeStore = createSessionStore()
  resumeStore.apply({ type: 'gateway.ready' })
  const resumeSetup = await testRender(
    () => (
      <ThemeProvider theme={() => resumeStore.state.theme}>
        <App store={resumeStore} />
      </ThemeProvider>
    ),
    { width: 100, height: 40, exitOnCtrlC: false }
  )
  await resumeSetup.renderOnce()
  await resumeSetup.flush()

  const fullFixture = materialize(TOTAL)
  resumeStore.beginBuffer()
  resumeStore.commitSnapshot(fullFixture)
  await resumeSetup.renderOnce()
  await resumeSetup.flush()
  forceGc()
  const rm = process.memoryUsage()
  const ralloc = lib.getAllocatorStats()
  const rrenderables = descendantCount(resumeSetup.renderer.root)
  process.stdout.write('\n--- resume path (commitSnapshot of the full fixture) ---\n')
  process.stdout.write(`fixture msgs built : ${fullFixture.length}\n`)
  process.stdout.write(`mounted msgs (cap) : ${resumeStore.state.messages.length}\n`)
  process.stdout.write(`mounted renderables: ${rrenderables}\n`)
  process.stdout.write(`activeAllocations  : ${ralloc.activeAllocations}\n`)
  process.stdout.write(`rss(MB)            : ${MB(rm.rss)}\n`)

  resumeSetup.renderer.destroy()
}

await main()
