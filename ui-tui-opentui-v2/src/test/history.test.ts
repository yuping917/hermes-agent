/**
 * Prompt history (item 6) — pure cursor-cycling behaviour, no filesystem.
 * Up walks older, Down walks newer back to the stashed draft; push dedupes a
 * consecutive duplicate, persists, and resets the cursor; an edit (reset) puts
 * the next Up back at the newest. Per-directory file persistence is exercised
 * only via the injected `persist` sink here.
 */
import { describe, expect, test } from 'vitest'

import { createPromptHistory } from '../logic/history.ts'

describe('prompt history — cursor cycling', () => {
  test('Up walks older entries, Down walks back to the live draft', () => {
    const h = createPromptHistory({ initial: ['first', 'second', 'third'] })
    // start typing a draft, then press Up
    expect(h.prev('draft')).toBe('third')
    expect(h.prev('draft')).toBe('second')
    expect(h.prev('draft')).toBe('first')
    expect(h.prev('draft')).toBe('first') // clamped at the oldest
    // Down walks newer, then restores the stashed draft at the bottom
    expect(h.next()).toBe('second')
    expect(h.next()).toBe('third')
    expect(h.next()).toBe('draft')
    expect(h.next()).toBeNull() // already at the bottom
  })

  test('push appends, dedupes a consecutive duplicate, persists, resets cursor', () => {
    const persisted: string[] = []
    const h = createPromptHistory({ initial: ['a'], persist: t => persisted.push(t) })
    h.push('b')
    h.push('b') // consecutive duplicate — not stored again
    h.push('c')
    expect(h.entries()).toEqual(['a', 'b', 'c'])
    expect(persisted).toEqual(['b', 'c'])
    // after push the cursor is at the bottom → Up returns the newest
    expect(h.prev('')).toBe('c')
  })

  test('reset returns the cursor to the bottom (called on edit)', () => {
    const h = createPromptHistory({ initial: ['x', 'y'] })
    expect(h.prev('')).toBe('y')
    expect(h.prev('')).toBe('x')
    h.reset() // user edited the buffer
    expect(h.prev('newdraft')).toBe('y') // next Up starts from the newest again
  })

  test('empty history: prev/next are inert', () => {
    const h = createPromptHistory()
    expect(h.prev('draft')).toBeNull()
    expect(h.next()).toBeNull()
  })

  test('max cap drops the oldest entries', () => {
    const h = createPromptHistory({ max: 2 })
    h.push('1')
    h.push('2')
    h.push('3')
    expect(h.entries()).toEqual(['2', '3'])
  })
})
