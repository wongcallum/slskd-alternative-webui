import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Flex, IconButton, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useFrom } from '../lib/media'
import type { Resource } from '../lib/store'
import { toolbarStyle } from '../ui/controls'
import { Freshness, Polling } from '../ui/status'
import { Composer } from './Composer'
import { type Target, targetKey } from './messages'

export function ChatToolbar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const sm = useFrom('sm')
  return (
    <Flex align="center" gap="3" px="4" py="2" flexShrink="0" minHeight="45px" style={toolbarStyle}>
      {!sm && (
        <IconButton asChild variant="ghost" color="gray" aria-label="Back to chats">
          <RouterLink to="/chat">
            <ArrowLeftIcon />
          </RouterLink>
        </IconButton>
      )}
      <Text weight="bold" truncate>
        {title}
      </Text>
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
  log,
}: Props) {
  const loaded = log !== undefined
  return (
    <Flex direction="column" flexGrow="1" minWidth="0">
      <ChatToolbar title={title}>
        {actions}
        <Flex ml="auto" align="center" flexShrink="0">
          <Freshness resource={resource} interval={interval} error={loaded ? error : undefined} />
        </Flex>
      </ChatToolbar>
      {instead ?? (
        <>
          {log ?? (
            <Flex flexGrow="1">
              <Polling what={target.kind === 'room' ? 'the room' : 'the conversation'} error={error} />
            </Flex>
          )}
          <Composer draftKey={targetKey(target)} placeholder={`Message ${target.name}`} send={send} />
        </>
      )}
    </Flex>
  )
}
