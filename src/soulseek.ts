import { api } from './api'
import { applicationHub, useHub } from './hubs'
import { createResource, isStale, poll, useFreshness, useResource } from './store'

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
  via: 'hub' | 'poll'
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

function fromServer(via: Soulseek['via'], server: ServerState) {
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
  let stopPolling: (() => void) | undefined
  function sync() {
    if (applicationHub.getStatus().state === 'connected') {
      stopPolling?.()
      stopPolling = undefined
    } else {
      stopPolling ??= poll(
        sink,
        async (signal) => ({
          ...fromServer('poll', await api.get('server', { signal }).json<ServerState>()),
          pendingReconnect: false,
        }),
        serverPollInterval,
      )
    }
  }
  const offState = applicationHub.on<ApplicationState>('STATE', (state) => sink.set(fromState(state)))
  const unsubscribe = applicationHub.subscribe(sync)
  sync()
  return () => {
    stopPolling?.()
    offState()
    unsubscribe()
  }
})

export function useSoulseek() {
  const { data, error } = useResource(soulseek)
  const hub = useHub(applicationHub)
  const age = useFreshness(soulseek)
  const known =
    data !== undefined && (data.via === 'hub' ? hub.state === 'connected' : !isStale(age, serverPollInterval))
  return { data, error, known, age }
}

export const connect = () => api.put('server')

export const disconnect = () => api.delete('server', { json: 'client disconnected from web UI' })
