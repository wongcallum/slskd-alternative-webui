import ky, { isHTTPError } from 'ky'
import pLimit from 'p-limit'

import { endSession, getSession } from './session'
import { apiPrefix } from './urlBase'

class SessionEndedError extends Error {
  override name = 'SessionEndedError'
}

export const api = ky.create({
  prefix: apiPrefix,
  retry: 0,
  hooks: {
    beforeRequest: [
      ({ request }) => {
        const session = getSession()
        if (session.status === 'authenticated') request.headers.set('Authorization', `Bearer ${session.token}`)
        else if (session.status !== 'open') throw new SessionEndedError('Logged out')
      },
    ],
    afterResponse: [
      ({ request, response }) => {
        if (response.status !== 401) return
        endSession(request.headers.get('Authorization')?.slice('Bearer '.length))
        throw new SessionEndedError('slskd no longer accepts the login this was sent with')
      },
    ],
  },
})

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// A request that reads slskd's options makes it write and delete a file in the downloads and incomplete directories,
// and a recursive listing that comes across one fails (see the facts). So the Files page's requests and the options
// go one at a time.
export const readsOptions = pLimit(1)

// slskd answers 429 without doing anything when a concurrency limit is reached, so the request is resent as part
// of the same gesture rather than reported as a failure.
export async function resendOn429<T>(send: () => Promise<T>, signal?: AbortSignal) {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      return await send()
    } catch (error) {
      if (!isHTTPError(error) || error.response.status !== 429 || Date.now() >= deadline) throw error
      await sleep(1000)
      signal?.throwIfAborted()
    }
  }
}

export function describeError(error: unknown) {
  if (isHTTPError(error)) {
    const detail = typeof error.data === 'string' ? error.data : JSON.stringify(error.data)
    return `HTTP ${error.response.status}${error.data ? `: ${detail}` : ''}`
  }
  return error instanceof Error ? error.message : String(error)
}
