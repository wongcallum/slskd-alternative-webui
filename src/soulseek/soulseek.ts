import { api } from '../lib/api'
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
