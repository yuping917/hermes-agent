/**
 * Python resolution for spawning the `tui_gateway` — mirrors Ink's
 * `resolvePython` (ui-tui/src/gatewayClient.ts:45-64) EXACTLY so behavior is
 * identical across engines (spec v4 §4). NEVER "probe any python".
 *
 * Order: HERMES_PYTHON / PYTHON env → $VIRTUAL_ENV (bin/python or
 * Scripts/python.exe) → <root>/.venv → <root>/venv → bare `python3` (`python`
 * on win32) on PATH. The source root is HERMES_PYTHON_SRC_ROOT (the launcher
 * sets it) so the child resolves modules against the right checkout.
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function resolvePython(root: string): string {
  const configured = process.env.HERMES_PYTHON?.trim() || process.env.PYTHON?.trim()
  if (configured) return configured

  const venv = process.env.VIRTUAL_ENV?.trim()

  const hit = [
    venv && resolve(venv, 'bin/python'),
    venv && resolve(venv, 'Scripts/python.exe'),
    resolve(root, '.venv/bin/python'),
    resolve(root, '.venv/bin/python3'),
    resolve(root, 'venv/bin/python'),
    resolve(root, 'venv/bin/python3')
  ].find(p => p && existsSync(p))

  return hit || (process.platform === 'win32' ? 'python' : 'python3')
}

/** The Hermes checkout root used as PYTHONPATH / HERMES_PYTHON_SRC_ROOT for the child. */
export function resolveSrcRoot(): string {
  const configured = process.env.HERMES_PYTHON_SRC_ROOT?.trim()
  if (configured) return configured
  // Fallback (no launcher env): walk up from this module to the Hermes checkout
  // root — the dir holding the `hermes_cli` package / `pyproject.toml`. Bundle-
  // agnostic, so it works whether running the source tree (.../src/boundary/gateway)
  // or the built `dist/main.js`. (Under the real launcher this never runs — the
  // launcher always sets HERMES_PYTHON_SRC_ROOT.)
  let dir = import.meta.dirname
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'hermes_cli')) || existsSync(resolve(dir, 'pyproject.toml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(import.meta.dirname, '../../../../')
}
