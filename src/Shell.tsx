import { Badge, Box, Button, DataList, Flex, Popover, TabNav, Text, Tooltip } from '@radix-ui/themes'
import { Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import { type CSSProperties, type ReactNode, useState } from 'react'
import { describeError } from './api'
import { applicationHub, type HubStatus, metricsHub, useHub } from './hubs'
import { unfinishedDownloads } from './metrics'
import { logout, useSession } from './session'
import { connect, disconnect, type Soulseek, useSoulseek } from './soulseek'
import { useResource, useStale, useWatchedResource } from './store'
import { pollInterval, transfers } from './transfers'

export function Shell() {
  const session = useSession()
  return (
    <Flex direction="column" height="100vh">
      <Flex
        asChild
        align="center"
        gap="5"
        px="4"
        flexShrink="0"
        overflowX="auto"
        style={{ boxShadow: 'inset 0 -1px 0 0 var(--gray-a5)' }}
      >
        <header>
          <Text weight="bold">slskd</Text>
          {/* TabNav draws its own divider in --gray-a5 under the tabs, which would double up with the header's. */}
          <TabNav.Root style={{ '--gray-a5': 'transparent' } as CSSProperties}>
            <NavTab to="/searches">Search</NavTab>
            <NavTab to="/downloads">
              Downloads
              <DownloadsBadge />
            </NavTab>
            <NavTab to="/uploads">Uploads</NavTab>
            <NavTab to="/browse">Browse</NavTab>
          </TabNav.Root>
          <Flex align="center" gap="4" ml="auto" flexShrink="0">
            <SoulseekIndicator />
            {session.status === 'authenticated' && (
              <Button variant="ghost" color="gray" onClick={logout}>
                Log out
              </Button>
            )}
          </Flex>
        </header>
      </Flex>
      <Box flexGrow="1" minHeight="0" overflow="auto">
        <Outlet />
      </Box>
    </Flex>
  )
}

function NavTab({ to, children }: { to: '/searches' | '/downloads' | '/uploads' | '/browse'; children: ReactNode }) {
  const matchRoute = useMatchRoute()
  return (
    <TabNav.Link asChild active={Boolean(matchRoute({ to, fuzzy: true }))}>
      <Link to={to}>{children}</Link>
    </TabNav.Link>
  )
}

// While the Downloads page polls the list, the badge shows its exact count instead of the metrics estimate.
function DownloadsBadge() {
  const metrics = useResource(unfinishedDownloads)
  const hub = useHub(metricsHub)
  const list = useWatchedResource(transfers.download)
  const listStale = useStale(transfers.download, pollInterval)
  const exact =
    transfers.download.isRunning() && list.data !== undefined && !listStale
      ? list.data.transferring + list.data.queued
      : undefined
  const count = exact ?? metrics.data?.count
  if (!count) return null
  const unfinished = `${count} download${count === 1 ? '' : 's'} unfinished`
  return (
    <Tooltip content={exact === undefined ? `About ${unfinished}` : unfinished}>
      <Badge ml="2" radius="full" color={exact !== undefined || hub.state === 'connected' ? undefined : 'gray'}>
        {count}
      </Badge>
    </Tooltip>
  )
}

type DotColor = 'gray' | 'green' | 'amber' | 'red'

function StatusDot({ color }: { color: DotColor }) {
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

const describeHub = ({ state, attempt }: HubStatus) => (attempt === 0 ? state : `${state} (retry ${attempt})`)

function describeSoulseek(data: Soulseek | undefined, known: boolean): { color: DotColor; label: string } {
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

function SoulseekIndicator() {
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
              aria-disabled={!known || undefined}
              data-disabled={!known || undefined}
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
