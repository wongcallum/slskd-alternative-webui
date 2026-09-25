import { isHTTPError } from 'ky'
import pMap from 'p-map'
import { type Actions, begin as beginAction, idle, type Outcome, summarise } from './actions'
import { api, describeError, resendOn429 } from './api'
import { sessionSignal } from './session'
import { type Atom, createAtom } from './store'
import { type Direction, type Transfer, transfers } from './transfers'

export type ActionKind = 'retry' | 'cancel' | 'remove' | 'clear'

export const actions: Record<Direction, Atom<Actions<ActionKind>>> = {
  download: createAtom<Actions<ActionKind>>(idle),
  upload: createAtom<Actions<ActionKind>>(idle),
}

export type Lookup = { pending: boolean; place?: number; error?: string; at?: number }

export const lookups = createAtom<ReadonlyMap<string, Lookup>>(new Map())

const begin = (direction: Direction, kind: ActionKind, ids: string[]) =>
  beginAction(actions[direction], kind, ids, () => transfers[direction].refresh())

const transferPath = (direction: Direction, file: Transfer) =>
  `transfers/${direction}s/${encodeURIComponent(file.username)}/${file.id}`

async function deleteEach(direction: Direction, kind: 'cancel' | 'remove', files: Transfer[]) {
  const operation = begin(
    direction,
    kind,
    files.map((file) => file.id),
  )
  const errors: string[] = []
  try {
    await pMap(
      files,
      async (file) => {
        try {
          await api.delete(transferPath(direction, file), {
            searchParams: { remove: kind === 'remove' },
            signal: operation.signal,
          })
        } catch (error) {
          if (operation.signal.aborted) throw error
          errors.push(`${file.name}: ${describeError(error)}`)
        } finally {
          operation.advance([file.id])
        }
      },
      { concurrency: 4, signal: operation.signal },
    )
  } catch {
    return
  }
  operation.finish(
    summarise(kind === 'cancel' ? 'Cancelled' : 'Removed', files.length, errors.length, errors, direction),
  )
}

export const cancel = (direction: Direction, files: Transfer[]) => deleteEach(direction, 'cancel', files)

export const remove = (direction: Direction, files: Transfer[]) => deleteEach(direction, 'remove', files)

export async function clearFinished(direction: Direction) {
  const operation = begin(direction, 'clear', [])
  let outcome: Outcome
  try {
    await api.delete(`transfers/${direction}s/all/completed`, { signal: operation.signal })
    outcome = { summary: `Cleared finished ${direction}s`, failed: false, details: [] }
  } catch (error) {
    if (operation.signal.aborted) return
    outcome = { summary: `Couldn't clear finished ${direction}s`, failed: true, details: [describeError(error)] }
  }
  operation.finish(outcome)
}

type EnqueueResponse = { failures: { filename: string; message: string }[] }

// slskd runs at most two enqueues at once.
export const enqueue = (body: object, signal: AbortSignal) =>
  resendOn429(() => api.post('transfers/downloads/batches', { json: body, signal }).json<EnqueueResponse>(), signal)

type BatchInfo = { searchId?: string; options?: { destination?: string } }

// Retrying re-enqueues through a new batch per user and old batch, carrying over the old batch's search and
// destination, which stock's retry drops.
export async function retry(files: Transfer[]) {
  const operation = begin(
    'download',
    'retry',
    files.map((file) => file.id),
  )
  const { signal } = operation
  const batches = new Map<string, Transfer[]>()
  for (const file of files) {
    const key = `${file.username}\n${file.batchId ?? ''}`
    batches.set(key, [...(batches.get(key) ?? []), file])
  }
  const details: string[] = []
  let failed = 0
  try {
    const infos = new Map<string, BatchInfo>()
    for (const batchId of new Set(files.map((file) => file.batchId))) {
      if (batchId === undefined) continue
      try {
        infos.set(batchId, await api.get(`transfers/downloads/batches/${batchId}`, { signal }).json<BatchInfo>())
      } catch (error) {
        if (signal.aborted) throw error
      }
    }
    for (const batch of batches.values()) {
      const [{ username, batchId }] = batch as [Transfer]
      const info = batchId === undefined ? undefined : infos.get(batchId)
      const destination = info?.options?.destination
      try {
        const { failures } = await enqueue(
          {
            username,
            files: batch.map(({ filename, size }) => ({ filename, size })),
            ...(info?.searchId !== undefined && { searchId: info.searchId }),
            ...(destination !== undefined && { options: { destination } }),
          },
          signal,
        )
        failed += failures.length
        for (const failure of failures) details.push(`${username}: ${failure.filename}: ${failure.message}`)
      } catch (error) {
        if (signal.aborted) throw error
        failed += batch.length
        const offline = isHTTPError(error) && error.response.status === 404
        details.push(`${username}: ${offline ? 'offline' : describeError(error)}`)
      } finally {
        operation.advance(batch.map((file) => file.id))
      }
    }
  } catch {
    return
  }
  operation.finish(summarise('Retried', files.length, failed, details, 'download'))
}

function setLookup(id: string, lookup: Lookup) {
  lookups.set((current) => new Map(current).set(id, lookup))
}

export async function lookUpPositions(files: Transfer[]) {
  const signal = sessionSignal()
  lookups.set((current) => {
    const next = new Map(current)
    for (const file of files) next.set(file.id, { ...current.get(file.id), pending: true })
    return next
  })
  for (const file of files) {
    try {
      const place = await api.get(`${transferPath('download', file)}/position`, { signal }).json<number>()
      setLookup(file.id, { pending: false, place, at: Date.now() })
    } catch (error) {
      if (signal.aborted) return
      setLookup(file.id, { pending: false, error: describeError(error), at: Date.now() })
    }
  }
  transfers.download.refresh()
}
