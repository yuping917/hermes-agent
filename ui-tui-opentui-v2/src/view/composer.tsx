/**
 * Composer — the input row (spec v4 §2). A native <textarea> captured by ref;
 * Enter submits, the input clears imperatively, and a live slash-completion
 * dropdown renders ABOVE it as you type `/…` (spec §1 completions).
 *
 * Gotchas (§8 #3): `flexShrink:0` so it never collapses onto its rule; clear via
 * `.clear()` (NOT key-remount); a `submitting` re-entrancy guard.
 *
 * Completions: `onContentChange` reports the text → `onType` (entry boundary)
 * queries `complete.slash` and fills `completions()`. The textarea owns key input
 * (so live-refine-by-typing works), so we use Tab to accept the top match and Esc
 * to dismiss (arrow-nav would fight the textarea's cursor; a polish item).
 * `onSubmit`/`onType` are plain callbacks wired by the entry — no Effect here.
 *
 * Always-active input (item 2): the textarea focuses on mount, on click
 * (onMouseDown), and reclaims focus on the next PRINTABLE keystroke if focus ever
 * drifted off (e.g. the transcript scrollbox grabbed it on a mouse-scroll). Nav
 * keys are left alone so keyboard transcript-scroll still works (opencode keeps
 * the prompt focused via a reactive effect; here a keystroke net is enough since
 * the composer remounts+refocuses whenever an overlay closes).
 */
import { type PasteEvent, type TextareaRenderable } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { For, onMount, Show } from 'solid-js'

import type { CompletionItem } from '../logic/store.ts'
import type { PromptHistory } from '../logic/history.ts'
import { type PasteStore, shouldPlaceholder } from '../logic/pastes.ts'
import { useDimensions } from './dimensions.tsx'
import { useTheme } from './theme.tsx'

const GUTTER = 2

/** Keys that must NOT steal focus back to the composer (scroll/edit/nav). */
const NAV_KEYS = new Set([
  'return',
  'linefeed',
  'tab',
  'escape',
  'backspace',
  'delete',
  'insert',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'clear',
  'menu'
])

/** A printable, unmodified key press (recoverable into the textarea). */
function isPrintableKey(k: {
  name: string
  ctrl: boolean
  meta: boolean
  option: boolean
  super?: boolean
  sequence: string
  eventType?: string
}): boolean {
  return (
    k.eventType !== 'release' &&
    !k.ctrl &&
    !k.meta &&
    !k.option &&
    !k.super &&
    !NAV_KEYS.has(k.name) &&
    typeof k.sequence === 'string' &&
    k.sequence.length >= 1 &&
    (k.sequence.codePointAt(0) ?? 0) >= 0x20
  )
}

export function Composer(props: {
  onSubmit: (text: string) => void
  onType?: ((text: string) => void) | undefined
  completions?: (() => CompletionItem[]) | undefined
  completionFrom?: (() => number) | undefined
  onDismiss?: (() => void) | undefined
  history?: PromptHistory | undefined
  onImagePaste?: (() => void) | undefined
  pasteStore?: PasteStore | undefined
}) {
  const theme = useTheme()
  const dims = useDimensions()
  // Auto-expand the input up to ~a third of the screen, then it scrolls internally
  // (opencode's prompt: minHeight 1, maxHeight max(6, ⌊rows/3⌋)).
  const maxHeight = () => Math.max(6, Math.floor(dims().height / 3))
  let ta: TextareaRenderable | undefined
  let submitting = false
  const completions = () => props.completions?.() ?? []

  /** Replace the textarea content and park the cursor at the end (history recall). */
  const setBuffer = (text: string) => {
    if (!ta) return
    ta.setText(text)
    ta.cursorOffset = text.length
  }

  const submit = () => {
    if (submitting || !ta) return
    // Expand any `[Pasted text #N]` placeholders back to their full content before
    // sending (item: pasted-text). No-op when nothing was placeheld.
    const text = (props.pasteStore?.expand(ta.plainText) ?? ta.plainText).trim()
    if (!text) return
    submitting = true
    props.onSubmit(text)
    props.history?.push(text)
    ta.clear()
    props.pasteStore?.clear()
    props.onDismiss?.()
    submitting = false
  }

  useKeyboard(key => {
    // 1) completion accept (Tab) / dismiss (Esc) while the dropdown is open
    if (completions().length > 0) {
      if (key.name === 'tab') {
        const top = completions()[0]
        if (top && ta) {
          // splice only the token being completed (slash-arg / @-mention), not the
          // whole line — `completionFrom` is the gateway's replace_from / token start.
          const from = props.completionFrom?.() ?? 0
          const before = ta.plainText.slice(0, Math.min(Math.max(0, from), ta.plainText.length))
          setBuffer(before + top.text + ' ')
          props.onDismiss?.()
        }
        return
      }
      if (key.name === 'escape') {
        props.onDismiss?.()
        return
      }
    }
    // 2) prompt history (item 6): Up at the first line → older prompt; Down at the
    // last line → newer/draft. At the boundary the textarea's own up/down is a
    // no-op, so there's no conflict; mid-buffer it falls through to cursor moves.
    if (ta && props.history) {
      if (key.name === 'up' && ta.logicalCursor.row === 0) {
        const entry = props.history.prev(ta.plainText)
        if (entry !== null) setBuffer(entry)
        return
      }
      if (key.name === 'down' && ta.logicalCursor.row === ta.lineCount - 1) {
        const entry = props.history.next()
        if (entry !== null) setBuffer(entry)
        return
      }
      // any edit resets the recall cursor so the next Up starts from the bottom
      if (key.name === 'backspace' || key.name === 'delete' || isPrintableKey(key)) {
        props.history.reset()
      }
    }
    // 3) always-active input (item 2): a printable key while the textarea lost
    // focus reclaims it. The renderer runs this GLOBAL handler BEFORE routing the
    // key to the focused renderable, so after focus() the SAME keystroke is still
    // delivered to the (now-focused) textarea — do NOT insert it here too, or the
    // first letter doubles. Nav/scroll keys are untouched.
    if (ta && !ta.focused && isPrintableKey(key)) {
      ta.focus()
    }
  })

  onMount(() => ta?.focus())

  return (
    <box style={{ flexDirection: 'column', flexShrink: 0 }}>
      <Show when={completions().length > 0}>
        <box
          style={{
            backgroundColor: theme().color.completionBg,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1
          }}
        >
          {/* the completion dropdown is transient input chrome (menu rows + the
              key-hint) — not transcript content — so it's excluded from mouse
              selection (item 4). */}
          <For each={completions().slice(0, 8)}>
            {(c, i) => (
              <text selectable={false} fg={i() === 0 ? theme().color.accent : theme().color.text}>
                {c.display || c.text}
                {c.meta ? `  ${c.meta}` : ''}
              </text>
            )}
          </For>
          <text selectable={false} fg={theme().color.muted}>
            Tab complete · Esc dismiss
          </text>
        </box>
      </Show>
      {/* prompt glyph + textarea — the glyph (item 3) marks the input line so the
          composer is distinguished by structure (glyph + the status-bar rule above),
          not a background tint. */}
      <box style={{ flexDirection: 'row', flexShrink: 0 }}>
        <box style={{ flexShrink: 0, width: GUTTER }}>
          <text selectable={false}>
            <span style={{ fg: theme().color.prompt }}>{theme().brand.prompt}</span>
          </text>
        </box>
        <textarea
          ref={el => (ta = el)}
          minHeight={1}
          maxHeight={maxHeight()}
          style={{ flexGrow: 1, minWidth: 0 }}
          placeholder={theme().brand.welcome}
          placeholderColor={theme().color.muted}
          textColor={theme().color.text}
          cursorColor={theme().color.accent}
          keyBindings={[{ action: 'submit', name: 'return' }]}
          onMouseDown={() => ta?.focus()}
          onSubmit={submit}
          onPaste={(e: PasteEvent) => {
            const text = new TextDecoder().decode(e.bytes)
            // An empty bracketed paste = an image-only clipboard (item 1) — read + attach it.
            if (text.trim() === '') {
              e.preventDefault()
              props.onImagePaste?.()
              return
            }
            // A large paste becomes a compact `[Pasted text #N +M lines]` chip instead
            // of flooding the input; the real text is expanded back on submit.
            if (props.pasteStore && shouldPlaceholder(text)) {
              e.preventDefault()
              ta?.insertText(props.pasteStore.add(text))
              return
            }
            // small pastes fall through to the textarea's native insert
          }}
          onContentChange={() => props.onType?.(ta?.plainText ?? '')}
        />
      </box>
    </box>
  )
}
