/**
 * Pasted-text placeholders (free-code's model). A large paste isn't dumped raw
 * into the composer — instead a compact `[Pasted text #N +M lines]` chip is shown
 * and the real content is held in a Map, then expanded back on submit. Pure + no
 * OpenTUI imports → trivially unit-testable.
 *
 * The store is created ONCE per session (entry) and passed to the Composer, so it
 * survives the composer remounting when overlays open/close (a per-composer store
 * would lose a pending paste mid-compose).
 */

export interface PasteStore {
  /** Register a pasted block; returns the placeholder to insert into the input. */
  add(text: string): string
  /** Replace every `[Pasted text #N …]` placeholder with its stored content. */
  expand(input: string): string
  /** Drop all stored pastes (call after a successful submit). */
  clear(): void
}

// Matches `[Pasted text #12]` and `[Pasted text #12 +34 lines]`. The id is the key.
const REF = /\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g

export function createPasteStore(): PasteStore {
  const map = new Map<number, string>()
  let seq = 0
  return {
    add(text) {
      const id = ++seq
      map.set(id, text)
      const lines = text.split('\n').length
      return lines > 1 ? `[Pasted text #${id} +${lines} lines]` : `[Pasted text #${id}]`
    },
    // String.replace(/g) is a SINGLE left-to-right pass over the ORIGINAL string,
    // so content inserted for one ref is never re-scanned for another ref —
    // a pasted block that itself contains `[Pasted text #k]` is safe.
    expand(input) {
      return (input ?? '').replace(REF, (m, id: string) => map.get(Number(id)) ?? m)
    },
    clear() {
      map.clear()
      seq = 0
    }
  }
}

/** A paste big enough to placeholder rather than inline (conservative thresholds). */
export function shouldPlaceholder(text: string): boolean {
  return text.split('\n').length >= 4 || text.length > 400
}
