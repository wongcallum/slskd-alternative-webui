import { type HubConnection, HubConnectionBuilder } from '@microsoft/signalr'
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { getSession } from './session'
import { urlBase } from './urlBase'

export type HubStatus = { state: 'connecting' | 'connected' | 'reconnecting'; attempt: number }

export type Hub = { subscribe: (listener: () => void) => () => void; getStatus: () => HubStatus }

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

export function createHub(name: string, register: (connection: HubConnection) => void): Hub {
  let status: HubStatus = { state: 'connecting', attempt: 0 }
  const listeners = new Set<() => void>()
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
    register(current)
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

  return {
    subscribe(listener) {
      listeners.add(listener)
      clearTimeout(stopTimer)
      if (!connection) connect()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stopTimer = setTimeout(stop, 2000)
      }
    },
    getStatus: () => status,
  }
}

export const useHub = (hub: Hub) => useSyncExternalStore(hub.subscribe, hub.getStatus)

export type ApplicationState = { server: { state: string } }

// TODO: phase 3's live store absorbs this STATE snapshot.
let applicationState: ApplicationState | undefined
const applicationStateListeners = new Set<() => void>()

export const applicationHub = createHub('application', (connection) => {
  connection.on('STATE', (state: ApplicationState) => {
    applicationState = state
    for (const listener of applicationStateListeners) listener()
  })
})

function subscribeApplicationState(listener: () => void) {
  applicationStateListeners.add(listener)
  const release = applicationHub.subscribe(listener)
  return () => {
    applicationStateListeners.delete(listener)
    release()
  }
}

export const useApplicationState = () => useSyncExternalStore(subscribeApplicationState, () => applicationState)
