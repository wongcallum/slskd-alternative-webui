import { Box, Flex, Progress } from '@radix-ui/themes'

import { formatBytes, formatProgress } from '../lib/format'
import { Busy, DismissibleText } from '../ui/status'
import { type Browse, dismissFailure, type Failure } from './browse'

export function describeBrowse(running: Browse) {
  if (running.phase === 'waiting') return 'Waiting for a response…'
  if (running.phase === 'receiving') return `Receiving the share: ${formatProgress(running.transferred, running.total)}`
  if (running.phase === 'loading') return `Loading from slskd: ${formatBytes(running.loaded)}`
  return 'Processing…'
}

export function BrowseProgress({ running }: { running: Browse }) {
  return (
    <Flex align="center" gap="3" minWidth="0">
      <Busy>{describeBrowse(running)}</Busy>
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
    <DismissibleText title={failure.message} onDismiss={() => dismissFailure(username)}>
      {failure.message}
    </DismissibleText>
  )
}
