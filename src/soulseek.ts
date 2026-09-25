import { api } from './api'
import { applicationHub, useHub } from './hubs'
import { createResource, poll, type Source, useFreshness, useResource, useStale } from './store'

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
  let polling: Source | undefined
  function sync() {
    if (applicationHub.getStatus().state === 'connected') {
      polling?.stop()
      polling = undefined
    } else {
      polling ??= poll(
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
  // The hub only sends STATE as it connects or when something changes, so a restart while it stayed connected
  // (a quick log out and in) would otherwise wait up to 30 s for the next push.
  const controller = new AbortController()
  if (applicationHub.getStatus().state === 'connected') {
    api
      .get('application', { signal: controller.signal })
      .json<ApplicationState>()
      .then(
        (state) => sink.set(fromState(state)),
        (error: unknown) => {
          if (!controller.signal.aborted) sink.fail(error)
        },
      )
  }
  return {
    stop() {
      controller.abort()
      polling?.stop()
      offState()
      unsubscribe()
    },
  }
})

function useKnown(data: Soulseek | undefined) {
  const hub = useHub(applicationHub)
  const polled = !useStale(soulseek, serverPollInterval)
  return data !== undefined && (data.via === 'hub' ? hub.state === 'connected' : polled)
}

export function useSoulseek() {
  const { data, error } = useResource(soulseek)
  const known = useKnown(data)
  const age = useFreshness(soulseek)
  return { data, error, known, age }
}

// The reason actions that need Soulseek are disabled, if they are.
export function useSoulseekGate() {
  const { data } = useResource(soulseek)
  const known = useKnown(data)
  if (!known) return 'Soulseek status unknown'
  if (!data?.isLoggedIn) return 'Not logged in to Soulseek'
  return undefined
}

export const connect = () => api.put('server')

export const disconnect = () => api.delete('server', { json: 'client disconnected from web UI' })
