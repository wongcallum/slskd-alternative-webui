import { isHTTPError } from 'ky'
import { useSyncExternalStore } from 'react'

import { http } from '../lib/api'
import { createListeners } from '../lib/listeners'

export type Session =
  | { status: 'checking' }
  | { status: 'unreachable'; error: unknown; retry: () => void }
  | { status: 'open' }
  | { status: 'anonymous'; ended: boolean }
  | { status: 'authenticated'; token: string }

const tokenKey = 'slskd-alt-token'

let session: Session = { status: 'checking' }
const listeners = createListeners()
const endListeners = createListeners()
let run = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

const inApp = ({ status }: Session) => status === 'open' || status === 'authenticated'

function set(next: Session) {
  const ended = inApp(session) && !inApp(next)
  session = next
  if (ended) endListeners.notify()
  listeners.notify()
}

function settle(next: Session) {
  run++
  clearTimeout(retryTimer)
  set(next)
}

export const getSession = () => session

export const useSession = () => useSyncExternalStore(listeners.add, getSession)

export const onSessionEnd = (listener: () => void) => endListeners.add(listener)

let controller = new AbortController()
onSessionEnd(() => {
  controller.abort()
  controller = new AbortController()
})

export const sessionSignal = () => controller.signal

function removeToken(token: string) {
  if (localStorage.getItem(tokenKey) === token) localStorage.removeItem(tokenKey)
}

async function validate(token: string) {
  try {
    await http.get('session', { headers: { Authorization: `Bearer ${token}` } })
    return true
  } catch (error) {
    if (isHTTPError(error) && error.response.status === 401) return false
    throw error
  }
}

async function check(ended: boolean, attempt = 0) {
  const current = ++run
  clearTimeout(retryTimer)
  if (session.status !== 'unreachable') set({ status: 'checking' })
  const token = localStorage.getItem(tokenKey)
  try {
    const [enabled, valid] = await Promise.all([
      http.get('session/enabled').json<boolean>(),
      token !== null && validate(token),
    ])
    if (current !== run) return
    if (!enabled) set({ status: 'open' })
    else if (token !== null && valid) set({ status: 'authenticated', token })
    else {
      if (token !== null) removeToken(token)
      set({ status: 'anonymous', ended: ended || token !== null })
    }
  } catch (error) {
    if (current !== run) return
    const retry = () => void check(ended, attempt + 1)
    retryTimer = setTimeout(retry, [1000, 2000][attempt] ?? 5000)
    set({ status: 'unreachable', error, retry })
  }
}

export function endSession(sentToken: string | undefined) {
  if (session.status === 'authenticated' ? sentToken !== session.token : session.status !== 'open') return
  if (sentToken !== undefined) removeToken(sentToken)
  void check(true)
}

export async function login(username: string, password: string) {
  const { token } = await http.post('session', { json: { username, password } }).json<{ token: string }>()
  localStorage.setItem(tokenKey, token)
  settle({ status: 'authenticated', token })
}

export function logout() {
  localStorage.removeItem(tokenKey)
  settle({ status: 'anonymous', ended: false })
}

function onStorage(event: StorageEvent) {
  if (event.storageArea !== localStorage || (event.key !== null && event.key !== tokenKey)) return
  if (session.status === 'open') return
  const token = localStorage.getItem(tokenKey)
  if (token !== null) {
    if (session.status !== 'authenticated' || session.token !== token) settle({ status: 'authenticated', token })
  } else if (session.status === 'authenticated') settle({ status: 'anonymous', ended: true })
}

export function startSession() {
  window.addEventListener('storage', onStorage)
  void check(false)
}
