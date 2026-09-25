import { api } from '../lib/api'
import { applicationHub, followHub, useLive, type Via } from '../lib/hubs'
import { createResource, useFreshness, useResource } from '../lib/store'

type ServerState = {
  address?: string | null
  state: string
  isConnected: boolean
  isLoggedIn: boolean
  isTransitioning: boolean
}

type ApplicationState = {
  server: ServerState
  user: { username: string | null }
  connectionWatchdog: { isAttemptingConnection: boolean; nextAttemptAt: string | null }
  pendingReconnect: boolean
}

export type Soulseek = {
  via: Via
  state: string
  address?: string
  isConnected: boolean
  isLoggedIn: boolean
  isTransitioning: boolean
  username?: string
  retryingAt?: string
  pendingReconnect: boolean
}

export const serverPollInterval = 2000

function fromServer(via: Via, server: ServerState) {
  return {
    via,
    state: server.state,
    address: server.address ?? undefined,
    isConnected: server.isConnected,
    isLoggedIn: server.isLoggedIn,
    isTransitioning: server.isTransitioning,
  }
}

function fromState({ server, user, connectionWatchdog, pendingReconnect }: ApplicationState): Soulseek {
  return {
    ...fromServer('hub', server),
    username: user.username ?? undefined,
    retryingAt: (connectionWatchdog.isAttemptingConnection && connectionWatchdog.nextAttemptAt) || undefined,
    pendingReconnect,
  }
}

const soulseek = createResource<Soulseek>((sink) => {
  const offState = applicationHub.on<ApplicationState>('STATE', (state) => sink.set(fromState(state)))
  const following = followHub(applicationHub, sink, {
    snapshot: async (signal) => fromState(await api.get('application', { signal }).json<ApplicationState>()),
    request: async (signal) => ({
      ...fromServer('poll', await api.get('server', { signal }).json<ServerState>()),
      pendingReconnect: false,
    }),
    interval: serverPollInterval,
  })
  return {
    stop() {
      following.stop()
      offState()
    },
  }
})

export function useSoulseek() {
  const { data, error } = useResource(soulseek)
  const { known } = useLive(data?.via, applicationHub, soulseek, serverPollInterval)
  const age = useFreshness(soulseek)
  return { data, error, known, age }
}

// The reason actions that need Soulseek are disabled, if they are.
export function useSoulseekGate() {
  const { data } = useResource(soulseek)
  const { known } = useLive(data?.via, applicationHub, soulseek, serverPollInterval)
  if (!known) return 'Soulseek status unknown'
  if (!data?.isLoggedIn) return 'Not logged in to Soulseek'
  return undefined
}

export const connect = () => api.put('server')

export const disconnect = () => api.delete('server', { json: 'client disconnected from web UI' })
