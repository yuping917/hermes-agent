/**
 * Runtime composition — the single edge where layers are provided and the
 * program is run (spec v4 §3.1). Layers are provided HERE by the caller
 * (the launcher entry), never inside components. Mirrors opencode
 * `cli/tui/layer.ts:6` + `cli/cmd/tui.ts` runMain.
 */
import { Layer } from 'effect'

import type { GatewayService } from './gateway/GatewayService.ts'

/**
 * The application layer. Phase 0 takes the GatewayService layer as a parameter
 * so the entry can choose Fake (dev/test) or — from Phase 1 — the live
 * `tui_gateway`-spawning layer. Compose additional boundary services
 * (Config, Theme-with-IO) here as they land.
 */
export const makeAppLayer = (gateway: Layer.Layer<GatewayService>) => Layer.mergeAll(gateway)
