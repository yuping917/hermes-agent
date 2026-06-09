/**
 * Assistant-text extraction (the `/copy [n]` command's pure logic). An assistant
 * turn's answer lives in `parts` (the `type:'text'` fragments, concatenated) while
 * live, OR in `.text` once settled/resumed. We copy the ANSWER only — reasoning and
 * tool parts are excluded. `nthAssistantResponse` indexes newest-first (1-based).
 *
 * NB: mouse-selection copies the RENDERED text verbatim (native OpenTUI selection,
 * `selection.getSelectedText()`), not markdown source — markers are concealed in the
 * pretty render and can't be recovered from a partial selection (user's choice). The
 * source-bearing path is this `/copy` command, which copies a whole response's source.
 */
import type { Message } from './store.ts'

/** The answer text of one message: concat the `text` parts (trimmed) when live, else `.text`. */
export function messageText(m: Message): string {
  if (m.parts && m.parts.length) {
    return m.parts
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('')
      .trim()
  }
  return m.text
}

/** Newest-first list of the non-empty answer text for every assistant message. */
export function assistantResponses(messages: Message[]): string[] {
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    const text = messageText(m)
    if (text) out.push(text)
  }
  return out
}

/** The n-th newest assistant response (1-based; n=1 → last). `undefined` if out of range. */
export function nthAssistantResponse(messages: Message[], n: number): string | undefined {
  return assistantResponses(messages)[n - 1]
}
