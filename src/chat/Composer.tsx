import { PaperPlaneIcon } from '@radix-ui/react-icons'
import { Box, IconButton, Text, TextField } from '@radix-ui/themes'
import { type KeyboardEvent, useState } from 'react'

import { describeError } from '../lib/api'
import { useTouch } from '../lib/media'
import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps, GateTip } from '../ui/controls'
import { drafts } from './messages'

type Props = { draftKey: string; placeholder: string; send: (text: string) => Promise<void> }

// The text stays until slskd has taken it, so a failed send can be retried as it is.
export function Composer({ draftKey, placeholder, send }: Props) {
  const gate = useSoulseekGate()
  const touch = useTouch()
  const text = useAtom(drafts).get(draftKey) ?? ''
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const blank = text.trim() === ''
  const reason = gate ?? (blank ? 'Type a message' : undefined)

  const setText = (value: string) =>
    drafts.set((current) => {
      const next = new Map(current)
      if (value === '') next.delete(draftKey)
      else next.set(draftKey, value)
      return next
    })

  async function submit() {
    if (reason !== undefined || sending) return
    setSending(true)
    setError(undefined)
    try {
      await send(text)
      if ((drafts.get().get(draftKey) ?? '') === text) setText('')
    } catch (thrown) {
      setError(describeError(thrown))
    }
    setSending(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <Box px="4" py="3" flexShrink="0" style={{ boxShadow: 'inset 0 1px 0 0 var(--gray-a5)' }}>
      <TextField.Root
        size="2"
        autoFocus={!touch}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      >
        <TextField.Slot side="right">
          <GateTip gate={reason} label="Send">
            <IconButton
              size="1"
              variant="ghost"
              aria-label="Send"
              loading={sending}
              {...disabledProps(reason !== undefined)}
              onClick={() => void submit()}
            >
              <PaperPlaneIcon />
            </IconButton>
          </GateTip>
        </TextField.Slot>
      </TextField.Root>
      {(error ?? gate) !== undefined && (
        <Text as="p" size="1" mt="1" color={error === undefined ? 'gray' : 'red'}>
          {error ?? gate}
        </Text>
      )}
    </Box>
  )
}
