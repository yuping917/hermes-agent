/**
 * Shared, COALESCED terminal dimensions (item 4 — resize hardening). Raw
 * `useTerminalDimensions()` fires on every SIGWINCH tick; during a drag that's a
 * recompute/reflow storm across every width-sensitive component (tool bodies,
 * tables, status bar, banner). One provider runs the raw hook once and feeds a
 * single leading+trailing-debounced signal (opencode's createLeadingTrailingSignal
 * idiom, mirroring the gateway's 16ms event coalescing) that every consumer shares
 * — so they reflow together (no tearing) and at most once per COALESCE window.
 */
import { useTerminalDimensions } from '@opentui/solid'
import { type Accessor, createContext, createEffect, createSignal, type JSX, onCleanup, useContext } from 'solid-js'

export interface Dims {
  readonly width: number
  readonly height: number
}

const DimsContext = createContext<Accessor<Dims>>()
const COALESCE_MS = 40

export function DimensionsProvider(props: { children: JSX.Element }) {
  const raw = useTerminalDimensions()
  const [dims, setDims] = createSignal<Dims>({ height: raw().height, width: raw().width })
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0
  createEffect(() => {
    const next: Dims = { height: raw().height, width: raw().width } // track raw
    const now = Date.now()
    if (now - last >= COALESCE_MS) {
      last = now
      setDims(next) // leading edge: respond immediately to the first change
    } else {
      // trailing edge: coalesce the burst, land on the final size once it settles
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        last = Date.now()
        setDims(next)
      }, COALESCE_MS)
    }
  })
  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })
  return <DimsContext.Provider value={dims}>{props.children}</DimsContext.Provider>
}

/** Coalesced dimensions; falls back to the raw hook outside a provider (e.g. headless tests). */
export function useDimensions(): Accessor<Dims> {
  return useContext(DimsContext) ?? useTerminalDimensions()
}
