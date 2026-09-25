import { Button, DataList, Flex, Popover, Text } from '@radix-ui/themes'
import { useState } from 'react'

import { describeError } from '../lib/api'
import { applicationHub, type HubStatus, metricsHub, searchHub, useHub, useWatchedHub } from '../lib/hubs'
import type { Application } from '../system/application'
import { type Color, disabledProps } from '../ui/controls'
import { StatusDot } from '../ui/status'
import { connect, disconnect, reconnect, useSoulseek } from './soulseek'

const describeHub = ({ state, attempt }: HubStatus) =>
  state === 'stopped' ? 'not in use' : attempt === 0 ? state : `${state} (retry ${attempt})`

function describeSoulseek(data: Application | undefined, known: boolean): { color: Color; label: string } {
  if (!data || !known) return { color: 'gray', label: 'Soulseek: unknown' }
  if (data.isLoggedIn) return { color: 'green', label: data.username ? `Connected as ${data.username}` : 'Connected' }
  if (data.state.includes('Disconnecting')) return { color: 'amber', label: 'Disconnecting…' }
  if (data.isTransitioning || data.isConnected) return { color: 'amber', label: 'Connecting…' }
  if (data.retryingAt) {
    return { color: 'amber', label: `Retrying at ${new Date(data.retryingAt).toLocaleTimeString()}` }
  }
  return { color: 'red', label: 'Disconnected' }
}

type Action = 'connect' | 'retry' | 'stop' | 'reconnect' | 'disconnect'

const actionLabels: Record<Action, string> = {
  connect: 'Connect',
  retry: 'Retry now',
  stop: 'Stop trying',
  reconnect: 'Reconnect',
  disconnect: 'Disconnect',
}

const actionCalls: Record<Action, () => Promise<unknown>> = {
  connect,
  retry: connect,
  stop: disconnect,
  reconnect,
  disconnect,
}

// slskd's PUT /server while connected leaves its retry timer running, so connecting is only offered while disconnected.
function actionsFor(data: Application | undefined): Action[] {
  if (!data || data.state.includes('Disconnecting')) return []
  if (data.isConnected) return data.pendingReconnect ? ['reconnect', 'disconnect'] : ['disconnect']
  if (data.isTransitioning || data.retryingAt) return ['retry', 'stop']
  return ['connect']
}

function describeSource(data: Application | undefined, known: boolean, age: number | undefined) {
  if (data?.via === 'hub') return known ? 'live via hub' : 'hub down, polling'
  return age === undefined ? 'not polled yet' : `polled, updated ${Math.round(age / 1000)} s ago`
}

export function SoulseekIndicator() {
  const soulseek = useSoulseek()
  const { color, label } = describeSoulseek(soulseek.data, soulseek.known)
  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button variant="ghost" color="gray">
          <StatusDot color={color} />
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Content width="300px">
        <SoulseekPanel {...soulseek} />
      </Popover.Content>
    </Popover.Root>
  )
}

function SoulseekPanel({ data, error, known, age }: ReturnType<typeof useSoulseek>) {
  const [pending, setPending] = useState<Action>()
  const [actionError, setActionError] = useState<string>()
  const applicationHubStatus = useHub(applicationHub)
  const metricsHubStatus = useHub(metricsHub)
  const searchHubStatus = useWatchedHub(searchHub)
  const actions = actionsFor(data)

  async function run(action: Action) {
    setPending(action)
    setActionError(undefined)
    try {
      await actionCalls[action]()
    } catch (thrown) {
      setActionError(describeError(thrown))
    }
    setPending(undefined)
  }

  return (
    <Flex direction="column" gap="3">
      <DataList.Root size="1">
        <DataList.Item>
          <DataList.Label>State</DataList.Label>
          <DataList.Value>{data?.state ?? 'unknown'}</DataList.Value>
        </DataList.Item>
        {data?.address && (
          <DataList.Item>
            <DataList.Label>Server</DataList.Label>
            <DataList.Value>{data.address}</DataList.Value>
          </DataList.Item>
        )}
        <DataList.Item>
          <DataList.Label>Source</DataList.Label>
          <DataList.Value>{describeSource(data, known, age)}</DataList.Value>
        </DataList.Item>
        {error !== undefined && (
          <DataList.Item>
            <DataList.Label>Last poll</DataList.Label>
            <DataList.Value>{describeError(error)}</DataList.Value>
          </DataList.Item>
        )}
        <DataList.Item>
          <DataList.Label>Application hub</DataList.Label>
          <DataList.Value>{describeHub(applicationHubStatus)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Metrics hub</DataList.Label>
          <DataList.Value>{describeHub(metricsHubStatus)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Search hub</DataList.Label>
          <DataList.Value>{describeHub(searchHubStatus)}</DataList.Value>
        </DataList.Item>
      </DataList.Root>
      {data?.pendingReconnect && (
        <Text size="2" color="amber">
          Changed Soulseek settings apply after a reconnect.
        </Text>
      )}
      {actions.length > 0 && (
        <Flex gap="2">
          {actions.map((action) => (
            <Button
              key={action}
              size="1"
              variant="soft"
              color={action === 'stop' || action === 'disconnect' ? 'red' : undefined}
              loading={pending === action}
              {...disabledProps(!known)}
              onClick={() => known && void run(action)}
            >
              {actionLabels[action]}
            </Button>
          ))}
        </Flex>
      )}
      {!known && (
        <Text size="1" color="gray">
          Soulseek status unknown
        </Text>
      )}
      {actionError && (
        <Text size="1" color="red">
          {actionError}
        </Text>
      )}
    </Flex>
  )
}
