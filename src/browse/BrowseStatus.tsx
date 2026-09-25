import { Box, Flex, Progress } from '@radix-ui/themes'

import { formatBytes, formatProgress } from '../lib/format'
import { Busy, DismissibleText } from '../ui/status'
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
      <Busy>{text}</Busy>
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
    <DismissibleText title={failure.error} onDismiss={() => dismissFailure(username)}>
      {failure.error}
    </DismissibleText>
  )
}
