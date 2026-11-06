import { api } from '../lib/api'
import { applicationHub } from '../lib/hubs'
import { sessionSignal } from '../lib/session'
import { createAtom } from '../lib/store'

type Action = 'restart' | 'shutDown'

type Lifecycle =
  | { phase: 'running'; failed?: { action: Action; error: unknown } }
  | { phase: 'restarting'; since: number }
  | { phase: 'shutDown' }

export const lifecycle = createAtom<Lifecycle>({ phase: 'running' })

// The hub drops as slskd stops, and connects again only to a new process. With auth on, the new process rejects the
// token instead, and the session ending resets this.
function awaitReturn(signal: AbortSignal) {
  let dropped = applicationHub.getStatus().state !== 'connected'
  const unwatch = applicationHub.watch(() => {
    if (applicationHub.getStatus().state !== 'connected') dropped = true
    else if (dropped) {
      unwatch()
      lifecycle.set({ phase: 'running' })
    }
  })
  signal.addEventListener('abort', unwatch)
}

async function stop(action: Action, request: () => Promise<unknown>, next: Lifecycle) {
  const signal = sessionSignal()
  lifecycle.set({ phase: 'running' })
  try {
    await request()
  } catch (error) {
    if (!signal.aborted) lifecycle.set({ phase: 'running', failed: { action, error } })
    return
  }
  if (signal.aborted) return
  lifecycle.set(next)
  awaitReturn(signal)
}

export const restart = () => stop('restart', () => api.put('application'), { phase: 'restarting', since: Date.now() })

export const shutDown = () => stop('shutDown', () => api.delete('application'), { phase: 'shutDown' })

// slskd shuts down gracefully for up to 30 s while requests are open, and the restarted process gives up if it
// starts before then (see docs/facts.md).
export const restartPatience = 45_000
