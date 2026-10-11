import { api } from '../lib/api'
import { plural, toTime } from '../lib/format'
import { applicationHub, followHub, useLiveResource, type Via } from '../lib/hubs'
import { createAtom, createResource, sameItems, useResource } from '../lib/store'

// GET /application omits nulls, while the hub keeps them.
export type RawState = {
  version: {
    current: string
    full: string
    latest?: string | null
    isUpdateAvailable?: boolean | null
    isCanary: boolean
    isDevelopment: boolean
  }
  pendingReconnect: boolean
  pendingRestart: boolean
  server: {
    address?: string | null
    state: string
    isConnected: boolean
    isLoggedIn: boolean
    isTransitioning: boolean
  }
  connectionWatchdog: { isAttemptingConnection: boolean; isAwaitingVpn?: boolean; nextAttemptAt?: string | null }
  vpn?: {
    isConnected: boolean
    publicIPAddress?: string | null
    location?: string | null
    forwardedPort?: number | null
  }
  relay: {
    mode: string
    controller: { address?: string | null; state: string }
    agents: { name: string; ipAddress: string }[]
  }
  health: { search: { incoming: { latency: number; queueDepth: number; dropRate: number } } }
  user: {
    username?: string | null
    privileges: { privilegesRemaining: number }
    statistics: { averageSpeed: number; directoryCount: number; fileCount: number; uploadCount: number }
  }
  distributedNetwork: {
    branchLevel: number
    branchRoot?: string | null
    canAcceptChildren: boolean
    childLimit: number
    children: unknown[]
    parent?: string | null
  }
  shares: {
    scanPending: boolean
    scanning: boolean
    ready: boolean
    faulted: boolean
    cancelled: boolean
    scanProgress: number
    directories: number
    files: number
  }
  rooms: string[]
}

export type Application = {
  via: Via
  version: string
  latest?: string
  updateAvailable: boolean
  build?: 'development' | 'canary'
  pendingRestart: boolean
  pendingReconnect: boolean
  scanPending: boolean
  scanning: boolean
  scanReady: boolean
  scanFaulted: boolean
  scanCancelled: boolean
  scanProgress: number
  scanFolders: number
  scanFiles: number
  state: string
  address?: string
  isConnected: boolean
  isLoggedIn: boolean
  isTransitioning: boolean
  attemptingConnection: boolean
  retryingAt?: number
  username?: string
  privilegeSeconds: number
  sharedFiles: number
  sharedFolders: number
  uploadSpeed: number
  uploads: number
  searchLatency: number
  searchQueue: number
  searchDrops: number
  branchLevel: number
  branchRoot?: string
  parent?: string
  children: number
  childLimit: number
  acceptsChildren: boolean
  rooms: readonly string[]
  commit?: string
  awaitingVpn: boolean
  vpnConnected: boolean
  vpnAddress?: string
  vpnLocation?: string
  vpnPort?: number
  relayMode: string
  controllerAddress?: string
  controllerState: string
  agents: readonly Agent[]
}

export type Agent = { name: string; address: string }

const sameAgents = (previous: readonly Agent[] | undefined, next: readonly Agent[]) =>
  previous !== undefined &&
  previous.length === next.length &&
  previous.every((each, i) => each.name === next[i]?.name && each.address === next[i]?.address)
    ? previous
    : next

export const applicationPollInterval = 2000

// Release builds report a fourth version part of 0, which their tags don't have.
const trimVersion = (version: string) => version.replace(/^(\d+\.\d+\.\d+)\.0$/, '$1')

function fromState(via: Via, state: RawState): Application {
  const { version, server, user, distributedNetwork: network, shares, vpn, relay } = state
  const previous = application.getSnapshot().data
  const incoming = state.health.search.incoming
  return {
    via,
    version: trimVersion(version.current),
    latest: version.latest == null ? undefined : trimVersion(version.latest),
    updateAvailable: version.isUpdateAvailable === true,
    build: version.isDevelopment ? 'development' : version.isCanary ? 'canary' : undefined,
    pendingRestart: state.pendingRestart,
    pendingReconnect: state.pendingReconnect,
    scanPending: shares.scanPending,
    scanning: shares.scanning,
    scanReady: shares.ready,
    scanFaulted: shares.faulted,
    scanCancelled: shares.cancelled,
    scanProgress: shares.scanProgress,
    scanFolders: shares.directories,
    scanFiles: shares.files,
    state: server.state,
    address: server.address ?? undefined,
    isConnected: server.isConnected,
    isLoggedIn: server.isLoggedIn,
    isTransitioning: server.isTransitioning,
    attemptingConnection: state.connectionWatchdog.isAttemptingConnection,
    retryingAt:
      state.connectionWatchdog.isAttemptingConnection && state.connectionWatchdog.nextAttemptAt
        ? toTime(state.connectionWatchdog.nextAttemptAt)
        : undefined,
    username: user.username ?? undefined,
    privilegeSeconds: user.privileges.privilegesRemaining,
    sharedFiles: user.statistics.fileCount,
    sharedFolders: user.statistics.directoryCount,
    uploadSpeed: user.statistics.averageSpeed,
    uploads: user.statistics.uploadCount,
    searchLatency: incoming.latency,
    searchQueue: incoming.queueDepth,
    searchDrops: incoming.dropRate,
    branchLevel: network.branchLevel,
    branchRoot: network.branchRoot ?? undefined,
    parent: network.parent ?? undefined,
    children: network.children.length,
    childLimit: network.childLimit,
    acceptsChildren: network.canAcceptChildren,
    rooms: sameItems(previous?.rooms, state.rooms),
    commit: /\+([0-9a-f]+)/.exec(version.full)?.[1],
    awaitingVpn: state.connectionWatchdog.isAwaitingVpn === true,
    vpnConnected: vpn?.isConnected === true,
    vpnAddress: vpn?.publicIPAddress ?? undefined,
    vpnLocation: vpn?.location ?? undefined,
    vpnPort: vpn?.forwardedPort ?? undefined,
    relayMode: relay.mode,
    controllerAddress: relay.controller.address ?? undefined,
    controllerState: relay.controller.state,
    agents: sameAgents(
      previous?.agents,
      relay.agents.map((agent) => ({ name: agent.name, address: agent.ipAddress })),
    ),
  }
}

const fetchState = async (via: Via, signal: AbortSignal) =>
  fromState(via, await api.get('application', { signal }).json<RawState>())

export const application = createResource<Application>((sink) => {
  const offState = applicationHub.on<RawState>('STATE', (state) => sink.set(fromState('hub', state)))
  const following = followHub(applicationHub, sink, {
    snapshot: (signal) => fetchState('hub', signal),
    request: (signal) => fetchState('poll', signal),
    interval: applicationPollInterval,
  })
  return {
    stop() {
      following.stop()
      offState()
    },
  }
})

// slskd forgets our username whenever it's logged out of Soulseek, while chat still names our messages by it.
export const ownUsername = createAtom<string | undefined>(undefined)

application.watch(() => {
  const username = application.getSnapshot().data?.username
  if (username !== undefined && username !== ownUsername.get()) ownUsername.set(username)
})

export const stateGate = (known: boolean) => (known ? undefined : "slskd's state is out of date")

export const releaseNotes = (version: string) => `https://github.com/slskd/slskd/releases/tag/${version}`

// slskd clears scanPending after a cancelled scan, although searches then miss what it added. During a scan, scanPending
// is unreliable, and the scan is what would settle it anyway.
export const rescanNeeded = (data: Application) =>
  !data.scanning && (data.scanPending || data.scanCancelled || data.scanFaulted)

export function pendingItems(data: Application) {
  const items: string[] = []
  if (data.pendingRestart) items.push('restart')
  if (data.pendingReconnect) items.push('reconnect')
  if (rescanNeeded(data)) items.push('rescan')
  return items
}

export const useApplication = () => useLiveResource(application, applicationHub, applicationPollInterval)

// An agent only relays its shares and files to its controller, and slskd refuses it everything Soulseek. Until the state
// arrives it's unknown, and nothing that an agent is refused should start.
export function useIsAgent() {
  const { data, error } = useResource(application)
  if (data !== undefined) return data.relayMode === 'Agent'
  return error === undefined ? undefined : false
}

export function describePrivileges(seconds: number) {
  if (seconds <= 0) return 'Not privileged'
  const days = Math.round(seconds / 86_400)
  if (days >= 1) return `About ${plural(days, 'day')} left`
  return `About ${plural(Math.max(1, Math.round(seconds / 3600)), 'hour')} left`
}
