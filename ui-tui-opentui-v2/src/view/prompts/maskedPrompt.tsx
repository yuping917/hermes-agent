/**
 * MaskedPrompt — sudo (🔐) / secret (🔑) masked entry (spec §8 #6). OpenTUI's
 * `<input>` has NO native mask (only value/placeholder/maxLength), and feeding it
 * stars via `value` is a feedback loop (onInput reports the masked value), so we
 * own a hidden buffer and capture raw keystrokes via `useKeyboard`, rendering '*'
 * per char — the robust path for masked input (verified in the React build).
 *
 * Enter submits the real buffer; Esc/Ctrl+C submits empty so the agent unblocks.
 */
import { useKeyboard } from '@opentui/solid'
import { createSignal, Show } from 'solid-js'

import { useTheme } from '../theme.tsx'

export function MaskedPrompt(props: {
  icon: string
  label: string
  sub?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const theme = useTheme()
  const [value, setValue] = createSignal('')

  useKeyboard(key => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      props.onCancel()
      return
    }
    if (key.name === 'return') {
      props.onSubmit(value())
      return
    }
    if (key.name === 'backspace') {
      setValue(v => v.slice(0, -1))
      return
    }
    const ch = key.sequence ?? ''
    if (ch.length === 1 && !key.ctrl && !key.meta && ch >= ' ') setValue(v => v + ch)
  })

  return (
    <box
      style={{ borderColor: theme().color.border, flexDirection: 'column', flexShrink: 0, marginTop: 1, padding: 1 }}
      border
    >
      <text fg={theme().color.label}>
        <b>
          {props.icon} {props.label}
        </b>
      </text>
      <Show when={props.sub}>
        <text fg={theme().color.muted}>{props.sub}</text>
      </Show>
      <box style={{ flexDirection: 'row' }}>
        <text fg={theme().color.label}>{'> '}</text>
        <text fg={theme().color.text}>{'*'.repeat(value().length)}</text>
        <text fg={theme().color.accent}>▍</text>
      </box>
      <text fg={theme().color.muted}>Enter send · Esc/Ctrl+C cancel · masked</text>
    </box>
  )
}
