import { Flex, Text } from '@radix-ui/themes'

import type { Presence } from '../lib/db'
import type { Color } from '../ui/controls'
import { DismissibleText, StatusDot } from '../ui/status'
import { dismissLookupErrors, type LookupErrors } from './users'

const presenceColors: Record<Presence, Color> = { Online: 'green', Away: 'amber', Offline: 'gray' }

export function PresenceLabel({ presence, size = '2' }: { presence: Presence; size?: '1' | '2' }) {
  return (
    <Flex align="center" gap="2">
      <StatusDot color={presenceColors[presence]} />
      <Text size={size}>{presence}</Text>
    </Flex>
  )
}

// An offline user's missing profile shows in gray rather than red.
function describeLookupErrors(errors: LookupErrors) {
  const lines: string[] = []
  if (errors.status !== undefined) lines.push(`Couldn't get the status: ${errors.status}`)
  if (errors.info !== undefined) lines.push(`Couldn't get the profile: ${errors.info}`)
  if (errors.notStored !== undefined) lines.push(`Couldn't store the profile: ${errors.notStored}`)
  const quiet = errors.status === undefined && errors.notStored === undefined && errors.info === 'Appears to be offline'
  return { lines, color: quiet ? 'gray' : 'red' } as const
}

export function LookupErrorLine({ username, errors }: { username: string; errors: LookupErrors }) {
  const { lines, color } = describeLookupErrors(errors)
  return (
    <DismissibleText color={color} title={lines.join('\n')} onDismiss={() => dismissLookupErrors(username)}>
      {lines.join('. ')}
    </DismissibleText>
  )
}
