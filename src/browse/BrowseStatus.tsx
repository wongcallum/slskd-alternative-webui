import { Cross2Icon } from '@radix-ui/react-icons'
import { Box, Flex, IconButton, Progress, Spinner, Text } from '@radix-ui/themes'

import { formatBytes, formatProgress } from '../lib/format'
import { stop } from '../ui/table'
import { type Browse, dismissFailure, type Failure } from './browse'

export function BrowseProgress({ running }: { running: Browse }) {
  let text: string
  if (running.phase === 'waiting') text = 'Waiting for a response…'
  else if (running.phase === 'receiving') {
    text = `Receiving the share: ${formatProgress(running.transferred, running.total)}`
  } else if (running.phase === 'loading') text = `Loading from slskd: ${formatBytes(running.loaded)}`
  else text = 'Processing…'
  return (
    <Flex align="center" gap="3" minWidth="0">
      <Spinner size="1" />
      <Text size="2" color="gray" truncate>
        {text}
      </Text>
      {running.phase === 'receiving' && running.total > 0 && (
        <Box width="120px" flexShrink="0">
          <Progress size="1" value={Math.min(100, (100 * running.transferred) / running.total)} />
        </Box>
      )}
    </Flex>
  )
}

export function FailureLine({ username, failure }: { username: string; failure: Failure }) {
  return (
    <Flex align="center" gap="1" minWidth="0">
      <Text size="2" color="red" truncate title={failure.error}>
        {failure.error}
      </Text>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        aria-label="Dismiss"
        onClick={(event) => {
          stop(event)
          dismissFailure(username)
        }}
      >
        <Cross2Icon />
      </IconButton>
    </Flex>
  )
}
