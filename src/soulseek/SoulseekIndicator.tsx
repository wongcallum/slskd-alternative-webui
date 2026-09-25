import { Button, DataList, Flex, Popover, Text } from '@radix-ui/themes'
import { useState } from 'react'
import { describeError } from '../lib/api'
import { applicationHub, type HubStatus, metricsHub, searchHub, useHub, useWatchedHub } from '../lib/hubs'
import { type Color, disabledProps } from '../ui/controls'
import { connect, disconnect, type Soulseek, useSoulseek } from './soulseek'

function StatusDot({ color }: { color: Color }) {
  return (
    <span
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: `var(--${color}-9)`,
      }}
    />
  )
}

const describeHub = ({ state, attempt }: HubStatus) =>
  state === 'stopped' ? 'not in use' : attempt === 0 ? state : `${state} (retry ${attempt})`

function describeSoulseek(data: Soulseek | undefined, known: boolean): { color: Color; label: string } {
  if (!data || !known) return { color: 'gray', label: 'Soulseek: unknown' }
  if (data.isLoggedIn) return { color: 'green', label: data.username ? `Connected as ${data.username}` : 'Connected' }
  if (data.state.includes('Disconnecting')) return { color: 'amber', label: 'Disconnecting…' }
  if (data.isTransitioning || data.isConnected) return { color: 'amber', label: 'Connecting…' }
  if (data.retryingAt) {
    return { color: 'amber', label: `Retrying at ${new Date(data.retryingAt).toLocaleTimeString()}` }
  }
  return { color: 'red', label: 'Disconnected' }
}

type Action = 'connect' | 'retry' | 'stop' | 'disconnect'

const actionLabels: Record<Action, string> = {
  connect: 'Connect',
  retry: 'Retry now',
  stop: 'Stop trying',
  disconnect: 'Disconnect',
}

// slskd's PUT /server while connected leaves its retry timer running, so connecting is only offered while disconnected.
function actionsFor(data: Soulseek | undefined): Action[] {
  if (!data || data.state.includes('Disconnecting')) return []
  if (data.isConnected) return ['disconnect']
  if (data.isTransitioning || data.retryingAt) return ['retry', 'stop']
  return ['connect']
}

function describeSource(data: Soulseek | undefined, known: boolean, age: number | undefined) {
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
      await (action === 'connect' || action === 'retry' ? connect() : disconnect())
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
          Settings changed; reconnect to apply.
        </Text>
      )}
      {actions.length > 0 && (
        <Flex gap="2">
          {actions.map((action) => (
            <Button
              key={action}
              size="1"
              variant="soft"
              color={action === 'connect' || action === 'retry' ? undefined : 'red'}
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
