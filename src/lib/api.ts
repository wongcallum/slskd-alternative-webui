import ky, { isHTTPError } from 'ky'
import { endSession, getSession } from '../session/session'
import { urlBase } from './urlBase'

export class SessionEndedError extends Error {
  override name = 'SessionEndedError'
}

export const http = ky.create({ prefix: `${urlBase}/api/v0`, retry: 0 })

export const api = http.extend({
  hooks: {
    beforeRequest: [
      ({ request }) => {
        const session = getSession()
        if (session.status === 'authenticated') request.headers.set('Authorization', `Bearer ${session.token}`)
        else if (session.status !== 'open') throw new SessionEndedError()
      },
    ],
    afterResponse: [
      ({ request, response }) => {
        if (response.status !== 401) return
        endSession(request.headers.get('Authorization')?.slice('Bearer '.length))
        throw new SessionEndedError()
      },
    ],
  },
})

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
