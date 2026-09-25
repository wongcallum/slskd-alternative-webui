import { isHTTPError } from 'ky'

import { api, describeError } from '../lib/api'
import { useFreshness } from '../lib/store'
import { sessionSignal } from '../session/session'
import { application, useApplication, waitForApplication } from '../system/application'

export function useSoulseek() {
  const { data, error, known } = useApplication()
  const age = useFreshness(application)
  return { data, error, known, age }
}

// The reason actions that need Soulseek are disabled, if they are.
export function useSoulseekGate() {
  const { data, known } = useApplication()
  if (!known) return 'Soulseek status unknown'
  if (!data?.isLoggedIn) return 'Not logged in to Soulseek'
  return undefined
}

export const connect = () => api.put('server')

export const disconnect = () => api.delete('server', { json: 'client disconnected from web UI' })

// A PUT while still connected would leave slskd's retry timer running, so this waits for the disconnect to land.
export async function reconnect() {
  const signal = sessionSignal()
  await disconnect()
  await waitForApplication((data) => !data.isConnected && !data.isTransitioning, signal, 30_000)
  await connect()
}

// slskd answers a blacklisted user with an empty 404, before asking anyone.
export function describePeerError(error: unknown) {
  if (isHTTPError(error)) {
    const message = typeof error.data === 'string' ? error.data : ''
    if (error.response.status === 404) return message === '' ? 'On your blacklist' : 'Appears to be offline'
    const timeout = /timed out after (\d+) milliseconds/.exec(message)
    if (timeout !== null) return `Didn't respond within ${Number(timeout[1]) / 1000} s`
    if (message.includes('Failed to establish a direct or indirect')) return "Couldn't connect to them"
  }
  return describeError(error)
}
