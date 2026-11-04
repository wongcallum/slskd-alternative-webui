import { isHTTPError } from 'ky'

import { api, describeError } from '../lib/api'
import { application, useApplication } from '../lib/application'
import { sessionSignal } from '../lib/session'
import { waitFor } from '../lib/store'
import type { LogRecord } from '../system/logs'

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
  if (!(await waitFor(application, (data) => !data.isConnected && !data.isTransitioning, signal, 30_000))) {
    throw new Error('Timed out waiting for slskd')
  }
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

// slskd keeps the reason for a failed connection only in its log. A later attempt, stop or login makes it stale.
const staleAfter = [
  'Attempting to connect to the Soulseek server',
  'Reconnection attempt cancelled',
  'Connected to the Soulseek server',
  'Disconnected from the Soulseek server: disconnected by the user',
]

const failure =
  /^(?:Failed to reconnect: |Disconnected from the Soulseek server[:;] |Not connecting to the Soulseek server; (?=username))"?/

export function connectionError(records: readonly LogRecord[], attempting: boolean) {
  for (const record of records) {
    if (record.context !== 'slskd.Application') continue
    if (staleAfter.some((prefix) => record.firstLine.startsWith(prefix))) return undefined
    if (record.level !== 'Error' && record.level !== 'Warning') continue
    const match = failure.exec(record.firstLine)
    // A stop that lands as an attempt fails ends the retries without logging that they were cancelled.
    if (match === null || (!attempting && match[0].startsWith('Failed to reconnect'))) continue
    return record.firstLine.slice(match[0].length)
  }
  return undefined
}
