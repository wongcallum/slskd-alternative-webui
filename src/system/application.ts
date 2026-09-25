import { api } from '../lib/api'
import { applicationHub, followHub, useLive, type Via } from '../lib/hubs'
import { createAtom, createResource, useResource } from '../lib/store'

// GET /application omits nulls, while the hub keeps them.
type RawState = {
  version: {
    current: string
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
  connectionWatchdog: { isAttemptingConnection: boolean; nextAttemptAt?: string | null }
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
  retryingAt?: string
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
}

export const applicationPollInterval = 2000

// Release builds report a fourth version part of 0, which their tags don't have.
const trimVersion = (version: string) => version.replace(/^(\d+\.\d+\.\d+)\.0$/, '$1')

let rooms: readonly string[] = []

// Every push carries a new array, which would count as a change.
function sameRooms(next: string[]) {
  if (next.length !== rooms.length || next.some((room, index) => room !== rooms[index])) rooms = next
  return rooms
}

function fromState(via: Via, state: RawState): Application {
  const { version, server, user, distributedNetwork: network, shares } = state
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
    retryingAt:
      (state.connectionWatchdog.isAttemptingConnection && state.connectionWatchdog.nextAttemptAt) || undefined,
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
    rooms: sameRooms(state.rooms),
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

export function useApplication() {
  const { data, error } = useResource(application)
  return { data, error, ...useLive(data?.via, applicationHub, application, applicationPollInterval) }
}

export function waitForApplication(predicate: (data: Application) => boolean, signal: AbortSignal, timeout: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Timed out waiting for slskd')), timeout)
    const check = () => {
      const { data } = application.getSnapshot()
      if (data !== undefined && predicate(data)) finish()
    }
    const onAbort = () => finish(signal.reason)
    const unsubscribe = application.subscribe(check)
    signal.addEventListener('abort', onAbort)
    function finish(error?: unknown) {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
    check()
  })
}
