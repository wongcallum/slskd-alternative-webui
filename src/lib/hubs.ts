import { type HubConnection, HubConnectionBuilder } from '@microsoft/signalr'
import { useSyncExternalStore } from 'react'

import { getSession } from '../session/session'
import { api } from './api'
import { createListeners } from './listeners'
import { type Measure, poll, type Resource, type Sink, type Source, useStale } from './store'
import { urlBase } from './urlBase'

export type HubStatus = { state: 'stopped' | 'connecting' | 'connected' | 'reconnecting'; attempt: number }

export type Hub = {
  subscribe: (listener: () => void) => () => void
  watch: (listener: () => void) => () => void
  getStatus: () => HubStatus
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- callers name the payload type they expect
  on: <T>(method: string, handler: (payload: T) => void) => () => void
}

type Handler = (payload: unknown) => void

const retryDelay = (attempt: number) => [0, 1000, 2000][attempt] ?? 5000

// SignalR treats a negotiate 401 like any other failed attempt and hides its status, so a REST probe
// after every failure is what notices that a restart invalidated the token.
function probe() {
  api.get('session').catch(() => {})
}

function accessToken() {
  const session = getSession()
  return session.status === 'authenticated' ? session.token : ''
}

function createHub(name: string): Hub {
  let status: HubStatus = { state: 'stopped', attempt: 0 }
  const listeners = createListeners()
  const handlers = new Map<string, Set<Handler>>()
  let references = 0
  let connection: HubConnection | undefined
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  function setStatus(state: HubStatus['state'], attempt = 0) {
    status = { state, attempt }
    listeners.notify()
  }

  function connect() {
    const current = new HubConnectionBuilder()
      .withUrl(`${urlBase}/hub/${name}`, { accessTokenFactory: accessToken })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: ({ previousRetryCount }) => {
          probe()
          setStatus('reconnecting', previousRetryCount + 1)
          return retryDelay(previousRetryCount)
        },
      })
      .build()
    for (const [method, set] of handlers) for (const handler of set) current.on(method, handler)
    current.onreconnected(() => setStatus('connected'))
    current.onclose(() => {
      if (connection === current) connect()
    })
    connection = current
    setStatus('connecting')
    void start(current, 0)
  }

  async function start(current: HubConnection, attempt: number) {
    try {
      await current.start()
      if (connection === current) setStatus('connected')
    } catch {
      if (connection !== current) return
      probe()
      setStatus('connecting', attempt + 1)
      startTimer = setTimeout(() => void start(current, attempt + 1), retryDelay(attempt))
    }
  }

  function stop() {
    const current = connection
    connection = undefined
    clearTimeout(startTimer)
    void current?.stop()
    setStatus('stopped')
  }

  function retain() {
    references++
    clearTimeout(stopTimer)
    if (!connection) connect()
    return () => {
      if (--references === 0) stopTimer = setTimeout(stop, 2000)
    }
  }

  return {
    subscribe(listener) {
      const unwatch = listeners.add(listener)
      const release = retain()
      return () => {
        unwatch()
        release()
      }
    },
    watch: listeners.add,
    getStatus: () => status,
    on(method, typed) {
      const handler = typed as Handler
      let set = handlers.get(method)
      if (!set) handlers.set(method, (set = new Set()))
      set.add(handler)
      connection?.on(method, handler)
      const release = retain()
      return () => {
        set.delete(handler)
        connection?.off(method, handler)
        release()
      }
    },
  }
}

export const useHub = (hub: Hub) => useSyncExternalStore(hub.subscribe, hub.getStatus)

export const useWatchedHub = (hub: Hub) => useSyncExternalStore(hub.watch, hub.getStatus)

export const applicationHub = createHub('application')

export const logsHub = createHub('logs')

export const metricsHub = createHub('metrics')

export const searchHub = createHub('search')

export type Via = 'hub' | 'poll'

// A resource follows its hub's pushes and polls while the hub is down. A hub only sends its snapshot as it connects,
// so a resource that starts while its hub is already connected (after a quick log out and in) fetches it over REST.
export function followHub<T>(
  hub: Hub,
  sink: Sink<T>,
  {
    snapshot,
    request,
    interval,
  }: {
    snapshot: (signal: AbortSignal) => Promise<T>
    request: (signal: AbortSignal, measure: Measure) => Promise<T>
    interval: number
  },
): Source {
  let polling: Source | undefined
  function sync() {
    if (hub.getStatus().state === 'connected') {
      polling?.stop()
      polling = undefined
    } else polling ??= poll(sink, request, interval)
  }
  const unsubscribe = hub.subscribe(sync)
  sync()
  const controller = new AbortController()
  if (hub.getStatus().state === 'connected') {
    snapshot(controller.signal).then(
      (data) => sink.set(data),
      (error: unknown) => {
        if (!controller.signal.aborted) sink.fail(error)
      },
    )
  }
  return {
    stop() {
      controller.abort()
      polling?.stop()
      unsubscribe()
    },
    refresh: () => polling?.refresh?.(),
  }
}

// Pushed data is current while its hub is connected, and polled data while it's fresh.
export function useLive(via: Via | undefined, hub: Hub, resource: Resource<unknown>, interval: number) {
  const status = useHub(hub)
  const polled = !useStale(resource, interval)
  const live = via === 'hub' && status.state === 'connected'
  return { live, known: live || (via === 'poll' && polled) }
}
