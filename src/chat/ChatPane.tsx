import { Flex, Heading } from '@radix-ui/themes'
import { type ReactNode, type Ref, useRef } from 'react'

import { useFrom } from '../lib/media'
import type { Resource } from '../lib/store'
import { barHeight, toolbarStyle } from '../ui/controls'
import { BackLink } from '../ui/nav'
import { Freshness, Polling } from '../ui/status'
import { Composer } from './Composer'
import { LogScroll } from './MessageLog'
import { type Target, targetKey } from './messages'

export function ChatToolbar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const sm = useFrom('sm')
  return (
    <Flex align="center" gap="3" px="4" py="2" flexShrink="0" minHeight={barHeight} style={toolbarStyle}>
      {!sm && <BackLink to="/chat" label="Back to chats" />}
      <Heading size="4" truncate>
        {title}
      </Heading>
      {children}
    </Flex>
  )
}

type Props = {
  target: Target
  title?: ReactNode
  actions?: ReactNode
  // Shown instead of the log and the composer.
  instead?: ReactNode
  resource: Resource<unknown>
  interval: number
  error: unknown
  send: (text: string) => Promise<void>
  inputRef?: Ref<HTMLInputElement>
  // Undefined until the messages have loaded.
  log?: ReactNode
}

export function ChatPane({
  target,
  title = target.name,
  actions,
  instead,
  resource,
  interval,
  error,
  send,
  inputRef,
  log,
}: Props) {
  const logScroll = useRef<HTMLDivElement>(null)
  return (
    <Flex direction="column" flexGrow="1" minWidth="0">
      <ChatToolbar title={title}>
        {actions}
        <Flex ml="auto" align="center" flexShrink="0">
          <Freshness resource={resource} interval={interval} />
        </Flex>
      </ChatToolbar>
      {instead ?? (
        <LogScroll value={logScroll}>
          {log ?? (
            <Flex flexGrow="1">
              <Polling what={target.kind === 'room' ? 'the room' : 'the conversation'} error={error} />
            </Flex>
          )}
          <Composer
            draftKey={targetKey(target)}
            placeholder={`Message ${target.name}`}
            send={send}
            inputRef={inputRef}
          />
        </LogScroll>
      )}
    </Flex>
  )
}
