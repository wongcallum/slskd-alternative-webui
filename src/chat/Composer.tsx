import { PaperPlaneIcon } from '@radix-ui/react-icons'
import { Box, IconButton, TextField } from '@radix-ui/themes'
import { type KeyboardEvent, type Ref, useContext } from 'react'

import { useTouch } from '../lib/media'
import { useAtom } from '../lib/store'
import { useRun } from '../lib/useRun'
import { useSoulseekGate } from '../soulseek/soulseek'
import { disabledProps, GateTip, mainField } from '../ui/controls'
import { ActionNote } from '../ui/status'
import { LogScroll } from './MessageLog'
import { drafts, setDraft } from './messages'

type Props = {
  draftKey: string
  placeholder: string
  send: (text: string) => Promise<void>
  inputRef?: Ref<HTMLInputElement>
}

// The text stays until slskd has taken it, so a failed send can be retried as it is.
export function Composer({ draftKey, placeholder, send, inputRef }: Props) {
  const gate = useSoulseekGate()
  const touch = useTouch()
  const text = useAtom(drafts).get(draftKey) ?? ''
  const log = useContext(LogScroll)
  const { running: sending, message, run } = useRun()
  const blank = text.trim() === ''
  const reason = gate ?? (blank ? 'Type a message' : undefined)

  const setText = (value: string) => setDraft(draftKey, value)

  function submit() {
    if (reason !== undefined || sending) return
    run(async () => {
      await send(text)
      if ((drafts.get().get(draftKey) ?? '') === text) setText('')
    })
  }

  // PageUp and PageDown scroll the log, which a single-line field has no use for.
  function onKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const scroller = log?.current
      if (scroller === null || scroller === undefined) return
      event.preventDefault()
      scroller.scrollBy({ top: (event.key === 'PageUp' ? -1 : 1) * scroller.clientHeight * 0.9 })
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    submit()
  }

  return (
    <Box
      px={{ initial: '3', sm: '4' }}
      py={{ initial: '2', sm: '3' }}
      flexShrink="0"
      style={{ boxShadow: 'inset 0 1px 0 0 var(--gray-a5)' }}
    >
      <TextField.Root
        ref={inputRef}
        size={{ initial: '3', sm: '2' }}
        autoFocus={!touch}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        {...mainField(true)}
      >
        <TextField.Slot side="right">
          <GateTip gate={reason} label="Send">
            <IconButton
              size={{ initial: '2', sm: '1' }}
              variant="ghost"
              aria-label="Send"
              loading={sending}
              {...disabledProps(reason !== undefined)}
              onClick={submit}
            >
              <PaperPlaneIcon />
            </IconButton>
          </GateTip>
        </TextField.Slot>
      </TextField.Root>
      <ActionNote message={message} gate={gate} size="1" mt="1" />
    </Box>
  )
}
