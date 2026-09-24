import ky, { isHTTPError } from 'ky'
import { endSession, getSession } from './session'
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

export function describeError(error: unknown) {
  if (isHTTPError(error)) return `HTTP ${error.response.status}${error.data ? `: ${String(error.data)}` : ''}`
  return error instanceof Error ? error.message : String(error)
}
