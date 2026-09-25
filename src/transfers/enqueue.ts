import { api, resendOn429 } from '../lib/api'

type EnqueueResponse = { failures: { filename: string; message: string }[] }

// slskd runs at most two enqueues at once.
export const enqueue = (body: object, signal: AbortSignal) =>
  resendOn429(() => api.post('transfers/downloads/batches', { json: body, signal }).json<EnqueueResponse>(), signal)

export type Mark = { ok: true } | { ok: false; message: string }
