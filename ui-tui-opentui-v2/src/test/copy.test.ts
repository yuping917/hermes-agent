/**
 * Assistant-text extraction helpers (the /copy command's logic). Pure functions:
 * pull the answer text out of a live (parts) or settled (.text) assistant turn,
 * excluding reasoning/tool parts; pick the n-th newest assistant response.
 */
import { describe, expect, test } from 'vitest'

import { assistantResponses, messageText, nthAssistantResponse } from '../logic/copy.ts'
import type { Message } from '../logic/store.ts'

describe('messageText', () => {
  test('a live parts turn concatenates text parts; excludes reasoning/tool', () => {
    const m: Message = {
      role: 'assistant',
      text: '',
      parts: [
        { type: 'reasoning', id: 'p1', text: 'thinking…' },
        { type: 'text', id: 'p2', text: 'Hello' },
        { type: 'tool', id: 't1', name: 'bash', state: 'complete', resultText: 'ran' },
        { type: 'text', id: 'p3', text: ' world' }
      ]
    }
    expect(messageText(m)).toBe('Hello world')
  })

  test('trims surrounding whitespace from concatenated text parts', () => {
    const m: Message = {
      role: 'assistant',
      text: '',
      parts: [{ type: 'text', id: 'p1', text: '  spaced  ' }]
    }
    expect(messageText(m)).toBe('spaced')
  })

  test('a settled/resumed turn (no parts) returns .text', () => {
    const m: Message = { role: 'assistant', text: 'resumed answer' }
    expect(messageText(m)).toBe('resumed answer')
  })

  test('empty parts array falls back to .text', () => {
    const m: Message = { role: 'assistant', text: 'flat body', parts: [] }
    expect(messageText(m)).toBe('flat body')
  })
})

describe('assistantResponses', () => {
  test('picks only assistant rows, newest-first, non-empty', () => {
    const messages: Message[] = [
      { role: 'system', text: 'welcome' },
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'first reply' },
      { role: 'user', text: 'and?' },
      { role: 'assistant', text: '', parts: [{ type: 'text', id: 'p1', text: 'second reply' }] }
    ]
    expect(assistantResponses(messages)).toEqual(['second reply', 'first reply'])
  })

  test('skips assistant rows that resolve to empty text', () => {
    const messages: Message[] = [
      { role: 'assistant', text: 'kept' },
      { role: 'assistant', text: '', parts: [{ type: 'reasoning', id: 'r1', text: 'only thinking' }] }
    ]
    expect(assistantResponses(messages)).toEqual(['kept'])
  })

  test('empty messages → []', () => {
    expect(assistantResponses([])).toEqual([])
  })
})

describe('nthAssistantResponse', () => {
  const messages: Message[] = [
    { role: 'assistant', text: 'oldest' },
    { role: 'user', text: 'q' },
    { role: 'assistant', text: 'newest' }
  ]

  test('n=1 is the last assistant response', () => {
    expect(nthAssistantResponse(messages, 1)).toBe('newest')
  })

  test('n=2 is the previous assistant response', () => {
    expect(nthAssistantResponse(messages, 2)).toBe('oldest')
  })

  test('n past the end → undefined', () => {
    expect(nthAssistantResponse(messages, 3)).toBeUndefined()
  })

  test('no assistant responses → undefined', () => {
    expect(nthAssistantResponse([{ role: 'user', text: 'hi' }], 1)).toBeUndefined()
    expect(nthAssistantResponse([], 1)).toBeUndefined()
  })
})
