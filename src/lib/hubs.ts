import { type HubConnection, HubConnectionBuilder } from '@microsoft/signalr'
import { useSyncExternalStore } from 'react'
import { getSession } from '../session/session'
import { api } from './api'
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
  const listeners = new Set<() => void>()
  const handlers = new Map<string, Set<Handler>>()
  let references = 0
  let connection: HubConnection | undefined
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  function setStatus(state: HubStatus['state'], attempt = 0) {
    status = { state, attempt }
    for (const listener of listeners) listener()
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

  function watch(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    subscribe(listener) {
      const unwatch = watch(listener)
      const release = retain()
      return () => {
        unwatch()
        release()
      }
    },
    watch,
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

export const metricsHub = createHub('metrics')

export const searchHub = createHub('search')
