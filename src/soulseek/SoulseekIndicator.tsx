import { StarFilledIcon } from '@radix-ui/react-icons'
import { Button, DataList, Flex, IconButton, Popover, Text, VisuallyHidden } from '@radix-ui/themes'
import { useState } from 'react'

import { describeError } from '../lib/api'
import { formatAge } from '../lib/format'
import { applicationHub, type HubStatus, metricsHub, searchHub, useHub, useWatchedHub } from '../lib/hubs'
import { useFreshness } from '../lib/store'
import { type Application, application, describePrivileges, useApplication } from '../system/application'
import { useOptions } from '../system/options/options'
import { type Color, disabledProps } from '../ui/controls'
import { StatusDot } from '../ui/status'
import { connect, disconnect, reconnect } from './soulseek'

const hubStates: Record<HubStatus['state'], string> = {
  stopped: 'Not in use',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
}

const describeHub = ({ state, attempt }: HubStatus) =>
  attempt === 0 ? hubStates[state] : `${hubStates[state]} (retry ${attempt})`

const controllerColors: Record<string, Color> = { Connected: 'green', Disconnected: 'red' }

function describeSoulseek(data: Application | undefined, known: boolean): { color: Color; label: string } {
  if (!data || !known) return { color: 'gray', label: 'Soulseek status unknown' }
  if (data.relayMode === 'Agent') {
    const state = data.controllerState
    return { color: controllerColors[state] ?? 'amber', label: `Controller ${state.toLowerCase()}` }
  }
  if (data.isLoggedIn) return { color: 'green', label: data.username ? `Connected as ${data.username}` : 'Connected' }
  if (data.state.includes('Disconnecting')) return { color: 'amber', label: 'Disconnecting…' }
  if (data.isTransitioning || data.isConnected) return { color: 'amber', label: 'Connecting…' }
  if (data.awaitingVpn) return { color: 'amber', label: 'Waiting for the VPN' }
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

function describeVpn(data: Application) {
  if (!data.vpnConnected) return 'Disconnected'
  const parts = [data.vpnAddress, data.vpnLocation, data.vpnPort === undefined ? undefined : `port ${data.vpnPort}`]
  const details = parts.filter((part) => part !== undefined).join(', ')
  return details === '' ? 'Connected' : details
}

function describeSource(data: Application | undefined, known: boolean, age: number | undefined) {
  if (data?.via === 'hub') return known ? 'Live from the hub' : 'Polling while the hub is down'
  return age === undefined ? 'Not polled yet' : `Polled, updated ${formatAge(age)} ago`
}

export function SoulseekIndicator({ compact }: { compact: boolean }) {
  const soulseek = useApplication()
  const { color, label } = describeSoulseek(soulseek.data, soulseek.known)
  const privileged = soulseek.data?.isLoggedIn === true && soulseek.data.privilegeSeconds > 0
  // The popover says how long the privileges last, since a tooltip inside the button couldn't be reached.
  const star = privileged && (
    <>
      <StarFilledIcon aria-hidden color="var(--amber-9)" />
      <VisuallyHidden>, privileged</VisuallyHidden>
    </>
  )
  return (
    <Popover.Root>
      <Popover.Trigger>
        {compact ? (
          <IconButton variant="ghost" color="gray" aria-label={label}>
            <StatusDot color={color} />
          </IconButton>
        ) : (
          <Button variant="ghost" color="gray">
            <StatusDot color={color} />
            {label}
            {star}
          </Button>
        )}
      </Popover.Trigger>
      <Popover.Content width="300px">
        {compact && (
          <Flex align="center" gap="2" mb="3">
            <StatusDot color={color} />
            <Text size="2" weight="medium">
              {label}
            </Text>
            {star}
          </Flex>
        )}
        <SoulseekPanel {...soulseek} />
      </Popover.Content>
    </Popover.Root>
  )
}

// The age ticks every second, so only the open panel follows it.
function SoulseekPanel({ data, error, known }: ReturnType<typeof useApplication>) {
  const age = useFreshness(application)
  const [pending, setPending] = useState<Action>()
  const [actionError, setActionError] = useState<string>()
  const applicationHubStatus = useHub(applicationHub)
  const metricsHubStatus = useHub(metricsHub)
  const searchHubStatus = useWatchedHub(searchHub)
  const agent = data?.relayMode === 'Agent'
  const vpn = useOptions()?.vpn === true
  const actions = agent ? [] : actionsFor(data)

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
        {agent ? (
          <DataList.Item>
            <DataList.Label>Controller</DataList.Label>
            <DataList.Value>{data.controllerAddress ?? 'Unknown'}</DataList.Value>
          </DataList.Item>
        ) : (
          <DataList.Item>
            <DataList.Label>State</DataList.Label>
            <DataList.Value>{data?.state ?? 'Unknown'}</DataList.Value>
          </DataList.Item>
        )}
        {data !== undefined && vpn && !agent && (
          <DataList.Item>
            <DataList.Label>VPN</DataList.Label>
            <DataList.Value>{describeVpn(data)}</DataList.Value>
          </DataList.Item>
        )}
        {data?.isLoggedIn && (
          <DataList.Item>
            <DataList.Label>Privileges</DataList.Label>
            <DataList.Value>{describePrivileges(data.privilegeSeconds)}</DataList.Value>
          </DataList.Item>
        )}
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
              onClick={() => known && pending === undefined && void run(action)}
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
