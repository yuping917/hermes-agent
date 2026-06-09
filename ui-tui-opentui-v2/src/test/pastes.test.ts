/**
 * Pasted-text store test — add returns a placeholder, expand restores the real
 * content, multiple pastes round-trip, unknown refs pass through, single-pass
 * replace keeps a self-referential paste safe. (input polish.)
 */
import { describe, expect, test } from 'vitest'

import { createPasteStore, shouldPlaceholder } from '../logic/pastes.ts'

describe('createPasteStore', () => {
  test('add returns a numbered placeholder with the line count', () => {
    const s = createPasteStore()
    expect(s.add('a\nb\nc')).toBe('[Pasted text #1 +3 lines]')
    expect(s.add('single line')).toBe('[Pasted text #2]') // 1 line → no "+N lines"
  })

  test('expand restores the real content for each ref', () => {
    const s = createPasteStore()
    const p1 = s.add('FIRST\nblock')
    const p2 = s.add('SECOND')
    const input = `before ${p1} middle ${p2} after`
    expect(s.expand(input)).toBe('before FIRST\nblock middle SECOND after')
  })

  test('unknown ref is left as-is (e.g. user typed it, or it was cleared)', () => {
    const s = createPasteStore()
    expect(s.expand('look [Pasted text #99] here')).toBe('look [Pasted text #99] here')
  })

  test('single-pass replace: a pasted block containing a ref literal is NOT re-expanded', () => {
    const s = createPasteStore()
    const p1 = s.add('code with [Pasted text #2] inside')
    s.add('SHOULD-NOT-APPEAR')
    // expanding the input replaces #1 with its content; the #2 inside that content
    // is not re-scanned, so SHOULD-NOT-APPEAR never leaks in.
    expect(s.expand(`x ${p1}`)).toBe('x code with [Pasted text #2] inside')
  })

  test('clear drops stored pastes and resets ids', () => {
    const s = createPasteStore()
    const p = s.add('gone')
    s.clear()
    expect(s.expand(p)).toBe(p) // no longer expandable
    expect(s.add('fresh')).toBe('[Pasted text #1]') // seq reset
  })

  test('shouldPlaceholder: ≥4 lines OR >400 chars', () => {
    expect(shouldPlaceholder('a\nb\nc\nd')).toBe(true) // 4 lines
    expect(shouldPlaceholder('a\nb\nc')).toBe(false) // 3 lines
    expect(shouldPlaceholder('x'.repeat(401))).toBe(true) // long
    expect(shouldPlaceholder('short')).toBe(false)
  })
})
