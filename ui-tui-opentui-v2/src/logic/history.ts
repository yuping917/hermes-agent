/**
 * Prompt history (item 6) — the SOLID side, plain TS. Up/Down cycle through the
 * prompts you've sent, scoped PER DIRECTORY: launching Hermes again in the same
 * project dir reuses that dir's prior prompts (the "bleed for the same dir" the
 * user asked for), while a session in a different dir keeps its own list.
 *
 * `createPromptHistory` is pure + injectable (initial entries + a `persist`
 * sink) so the cursor logic is unit-tested with no filesystem. The real wiring
 * uses `loadDirHistory(cwd)` / `dirHistoryPersister(cwd)` to read/append a
 * per-dir JSONL file under `$HERMES_HOME/tui-history/<hash>.jsonl` (one
 * JSON-encoded prompt per line, multiline-safe; opencode's prompt-history.jsonl
 * model, Ink's ~/.hermes/.hermes_history idea, scoped by dir).
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

const DEFAULT_MAX = 200

export interface PromptHistoryOptions {
  /** Entries already on disk for this dir (oldest → newest). */
  initial?: string[]
  /** Persist a newly pushed prompt (real use: append to the per-dir file). */
  persist?: (text: string) => void
  /** Cap on retained entries (oldest dropped). */
  max?: number
}

export interface PromptHistory {
  /** All cycleable entries (oldest → newest) — loaded prev-session + this session. */
  entries: () => string[]
  /** Record a submitted prompt (skips a consecutive duplicate) and reset the cursor. */
  push: (text: string) => void
  /** Cycle to the OLDER entry (Up). Stashes `currentInput` as the draft on the first step. */
  prev: (currentInput: string) => string | null
  /** Cycle to the NEWER entry (Down); returns the stashed draft at the bottom. */
  next: () => string | null
  /** Reset the cursor to the live draft (call on any edit). */
  reset: () => void
}

export function createPromptHistory(opts: PromptHistoryOptions = {}): PromptHistory {
  const entries = [...(opts.initial ?? [])]
  const max = opts.max ?? DEFAULT_MAX
  // `idx === entries.length` means "at the live draft" (past the newest entry).
  let idx = entries.length
  let draft = ''

  return {
    entries: () => entries.slice(),
    push(text) {
      if (!text.trim()) return
      if (entries[entries.length - 1] !== text) {
        entries.push(text)
        if (entries.length > max) entries.shift()
        opts.persist?.(text)
      }
      idx = entries.length
      draft = ''
    },
    prev(currentInput) {
      if (entries.length === 0) return null
      if (idx === entries.length) draft = currentInput // leaving the bottom — stash the draft
      if (idx > 0) idx--
      return entries[idx] ?? null
    },
    next() {
      if (idx >= entries.length) return null
      idx++
      return idx === entries.length ? draft : (entries[idx] ?? null)
    },
    reset() {
      idx = entries.length
    }
  }
}

// ── per-directory file persistence (best-effort; never throws) ──────────

function hermesHome(): string {
  return process.env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
}

/** The history file for a given working directory (keyed by a hash of the abs path). */
function dirHistoryPath(cwd: string): string {
  const key = createHash('sha1').update(cwd).digest('hex').slice(0, 16)
  return join(hermesHome(), 'tui-history', `${key}.jsonl`)
}

/** Load a directory's prior prompts (oldest → newest); [] if none / unreadable. */
export function loadDirHistory(cwd: string, max = DEFAULT_MAX): string[] {
  try {
    const raw = readFileSync(dirHistoryPath(cwd), 'utf8')
    const out: string[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const v: unknown = JSON.parse(line)
        if (typeof v === 'string') out.push(v)
      } catch {
        // skip a corrupt line — never let it break loading
      }
    }
    return out.length > max ? out.slice(out.length - max) : out
  } catch {
    return []
  }
}

/** A persister that appends each pushed prompt to the dir's JSONL file (best-effort). */
export function dirHistoryPersister(cwd: string): (text: string) => void {
  const path = dirHistoryPath(cwd)
  return text => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, JSON.stringify(text) + '\n', 'utf8')
    } catch {
      // history persistence is non-essential — a write failure must not disrupt the turn
    }
  }
}
