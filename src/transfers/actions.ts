import { isHTTPError } from 'ky'

import { type Actions, actOnEach, begin, idle, type Outcome, summarise } from '../lib/actions'
import { api, describeError } from '../lib/api'
import { sessionSignal } from '../lib/session'
import { createAtom } from '../lib/store'
import { describePeerError } from '../soulseek/soulseek'
import { enqueueBatches } from './enqueue'
import { type Direction, perDirection, type Transfer, transfers } from './transfers'

type ActionKind = 'retry' | 'cancel' | 'remove' | 'clear'

export const actions = perDirection(() => createAtom<Actions<ActionKind>>(idle))

export type PositionLookup = { pending: boolean; place?: number; message?: string; at?: number }

export const positionLookups = createAtom<ReadonlyMap<string, PositionLookup>>(new Map())

const beginOn = (direction: Direction, kind: ActionKind, ids: string[]) =>
  begin(actions[direction], kind, ids, () => transfers[direction].refresh())

const transferPath = (direction: Direction, file: Transfer) =>
  `transfers/${direction}s/${encodeURIComponent(file.username)}/${file.id}`

async function deleteEach(direction: Direction, kind: 'cancel' | 'remove', files: Transfer[]) {
  const operation = beginOn(
    direction,
    kind,
    files.map((file) => file.id),
  )
  const errors = await actOnEach(
    operation,
    files,
    (file) => file.name,
    (file, signal) =>
      api.delete(transferPath(direction, file), { searchParams: { remove: kind === 'remove' }, signal }),
  )
  if (errors === undefined) return
  operation.finish(
    summarise({
      verb: kind === 'cancel' ? 'Cancelled' : 'Removed',
      noun: direction,
      total: files.length,
      failed: errors.length,
      details: errors,
    }),
  )
}

export const cancel = (direction: Direction, files: Transfer[]) => deleteEach(direction, 'cancel', files)

export const remove = (direction: Direction, files: Transfer[]) => deleteEach(direction, 'remove', files)

export async function clearFinished(direction: Direction) {
  const operation = beginOn(direction, 'clear', [])
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

export type BatchInfo = { searchId?: string; options?: { destination?: string } }

// Retrying without the batch's destination would land the files somewhere else, unless the batch is gone. Undefined
// once the session has ended.
async function readBatches(files: Transfer[], signal: AbortSignal) {
  const infos = new Map<string, BatchInfo>()
  const unreadable = new Map<string, string>()
  for (const batchId of new Set(files.map((file) => file.batchId))) {
    if (batchId === undefined) continue
    try {
      infos.set(batchId, await api.get(`transfers/downloads/batches/${batchId}`, { signal }).json<BatchInfo>())
    } catch (error) {
      if (signal.aborted) return undefined
      if (!isHTTPError(error) || error.response.status !== 404) unreadable.set(batchId, describeError(error))
    }
  }
  return { infos, unreadable }
}

const retryBatches = (files: Transfer[], infos: ReadonlyMap<string, BatchInfo>) =>
  [...Map.groupBy(files, (file) => `${file.username}\n${file.batchId ?? ''}`).values()].map((batch) => {
    const [{ username, batchId }] = batch as [Transfer]
    const info = batchId === undefined ? undefined : infos.get(batchId)
    return {
      username,
      label: username,
      files: batch,
      searchId: info?.searchId,
      destination: info?.options?.destination,
    }
  })

// Retrying re-enqueues through a new batch per user and old batch, carrying over the old batch's search and
// destination, which stock's retry drops.
export async function retry(files: Transfer[]) {
  const operation = beginOn(
    'download',
    'retry',
    files.map((file) => file.id),
  )
  const read = await readBatches(files, operation.signal)
  if (read === undefined) return
  const { infos, unreadable } = read
  const skipped = files.filter((file) => file.batchId !== undefined && unreadable.has(file.batchId))
  const details = [...unreadable.values()].map((message) => `Couldn't read the batch to keep its folder: ${message}`)
  operation.advance(skipped.map((file) => file.id))
  const kept = files.filter((file) => file.batchId === undefined || !unreadable.has(file.batchId))
  const result = await enqueueBatches(operation, retryBatches(kept, infos))
  if (result === undefined) return
  operation.finish(
    summarise({
      verb: 'Retried',
      noun: 'download',
      total: files.length,
      failed: skipped.length + result.failed,
      details: [...details, ...result.details],
    }),
  )
}

function setLookup(id: string, lookup: PositionLookup) {
  positionLookups.set((current) => new Map(current).set(id, lookup))
}

export async function lookUpPositions(requested: Transfer[]) {
  const files = requested.filter((file) => positionLookups.get().get(file.id)?.pending !== true)
  if (files.length === 0) return
  const signal = sessionSignal()
  positionLookups.set((current) => {
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
      // A 404 here means the download is gone, not the user.
      const gone = isHTTPError(error) && error.response.status === 404
      setLookup(file.id, { pending: false, message: (gone ? describeError : describePeerError)(error), at: Date.now() })
    }
  }
  transfers.download.refresh()
}
