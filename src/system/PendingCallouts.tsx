import { ExclamationTriangleIcon } from '@radix-ui/react-icons'
import { Button, Callout, Flex, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { browses } from '../browse/browse'
import { useAtom } from '../lib/store'
import { useRun } from '../lib/useRun'
import { useSession } from '../session/session'
import { reconnect } from '../soulseek/soulseek'
import { ActionButton, ConfirmButton } from '../ui/controls'
import { type Application, rescanNeeded } from './application'
import { lifecycle, restart } from './lifecycle'

export function PendingCallout({ error, children }: { error?: string; children: ReactNode }) {
  return (
    // Callout is a grid that sizes its columns to their content, so a flex row lets the action sit at the far end.
    <Callout.Root color="amber" size="1" style={{ display: 'flex' }}>
      <Callout.Icon>
        <ExclamationTriangleIcon />
      </Callout.Icon>
      <Flex direction="column" gap="1" flexGrow="1">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          {children}
        </Flex>
        {error !== undefined && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
      </Flex>
    </Callout.Root>
  )
}

const outOfDate = "slskd's state is out of date"

export function useLifecycleGate(known: boolean) {
  const { phase } = useAtom(lifecycle)
  if (phase === 'restarting') return 'slskd is restarting'
  if (phase === 'shutDown') return 'slskd is shut down'
  return known ? undefined : outOfDate
}

export function RestartButton({ known, color }: { known: boolean; color?: 'amber' }) {
  const gate = useLifecycleGate(known)
  const browsing = useAtom(browses).size > 0
  const authenticated = useSession().status === 'authenticated'
  return (
    <ConfirmButton
      label="Restart"
      color={color}
      gate={gate ?? (browsing ? 'Wait for the browse to finish' : undefined)}
      title="Restart slskd?"
      description={[
        'Transfers stop, and unfinished downloads are enqueued again once slskd logs in, but into its default folders.',
        ...(authenticated ? ['Everyone is logged out.'] : []),
        'If slskd is still answering a request, such as a browse, the restart fails and slskd has to be started by hand.',
      ].join(' ')}
      action="Restart"
      onConfirm={() => void restart()}
    />
  )
}

export function PendingCallouts({ data, known }: { data: Application; known: boolean }) {
  const reconnecting = useRun()
  const rescan = rescanNeeded(data)
  if (!data.pendingRestart && !data.pendingReconnect && !rescan) return null
  return (
    <Flex direction="column" gap="2">
      {data.pendingRestart && (
        <PendingCallout>
          <Callout.Text>Changed settings apply after a restart.</Callout.Text>
          <RestartButton known={known} color="amber" />
        </PendingCallout>
      )}
      {data.pendingReconnect && (
        <PendingCallout error={reconnecting.error}>
          <Callout.Text>Changed Soulseek settings apply after a reconnect.</Callout.Text>
          <ActionButton
            label="Reconnect"
            color="amber"
            loading={reconnecting.running}
            gate={known ? undefined : 'Soulseek status unknown'}
            onClick={() => reconnecting.run(reconnect)}
          />
        </PendingCallout>
      )}
      {rescan && (
        <PendingCallout>
          <Callout.Text>Shares need a rescan.</Callout.Text>
          <Button asChild size="1" variant="soft" color="amber">
            <RouterLink to="/system/shares">Open Shares</RouterLink>
          </Button>
        </PendingCallout>
      )}
    </Flex>
  )
}
