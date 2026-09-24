import { type HubConnection, HubConnectionBuilder } from '@microsoft/signalr'
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { getSession } from './session'
import { urlBase } from './urlBase'

export type HubStatus = { state: 'connecting' | 'connected' | 'reconnecting'; attempt: number }

export type Hub = {
  subscribe: (listener: () => void) => () => void
  getStatus: () => HubStatus
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
  let status: HubStatus = { state: 'connecting', attempt: 0 }
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
      listeners.add(listener)
      const release = retain()
      return () => {
        listeners.delete(listener)
        release()
      }
    },
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

export const applicationHub = createHub('application')

export const metricsHub = createHub('metrics')
