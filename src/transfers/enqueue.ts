import { isHTTPError } from 'ky'

import { type Actions, begin, idle, type Operation, summarise } from '../lib/actions'
import { api, resendOn429 } from '../lib/api'
import { type Atom, createAtom, createKeyed } from '../lib/store'
import { describePeerError } from '../soulseek/soulseek'

export type EnqueueResponse = { failures: { filename: string; message: string }[] }

// slskd runs at most two enqueues at once.
const enqueue = (body: object, signal: AbortSignal) =>
  api.post('transfers/downloads/batches', { json: body, signal, retry: resendOn429 }).json<EnqueueResponse>()

export type Mark = { ok: true } | { ok: false; message: string }

export type Downloads = Actions<'download'> & { marks: ReadonlyMap<string, Mark> }

// Each search and each share keeps its own enqueue progress and marks, until it's deleted.
export const createDownloads = () => createKeyed((_key: string) => createAtom<Downloads>({ ...idle, marks: new Map() }))

type File = { id: string; filename: string; name: string; size: number }

export type Batch<F extends File> = {
  username: string
  label: string
  files: F[]
  searchId?: string
  destination?: string
}

// slskd puts every file of a batch in one folder, so a download that keeps subfolders is a batch per remote folder,
// whose destination is its path from the folder the download started from.
export const destinationOf = (segments: string[]) => segments.filter((segment) => segment !== '').join('/') || undefined

// Batches are sent one at a time, and once a user turns out to be offline the rest of theirs are skipped. Each file
// is marked in the atom, if there is one. Returns undefined once the session has ended.
export async function enqueueBatches<F extends File>(
  operation: Operation,
  batches: Batch<F>[],
  atom?: Atom<Downloads>,
) {
  const { signal } = operation
  const unreachable = new Map<string, string>()
  const details: string[] = []
  let failed = 0
  try {
    for (const { username, label, files, searchId, destination } of batches) {
      const marks = new Map<string, Mark>()
      try {
        const skipped = unreachable.get(username)
        if (skipped !== undefined) {
          for (const file of files) marks.set(file.id, { ok: false, message: skipped })
          failed += files.length
          continue
        }
        const { failures } = await enqueue(
          {
            username,
            files: files.map(({ filename, size }) => ({ filename, size })),
            ...(searchId !== undefined && { searchId }),
            ...(destination !== undefined && { options: { destination } }),
          },
          signal,
        )
        const messages = new Map(failures.map((failure) => [failure.filename, failure.message]))
        for (const file of files) {
          const message = messages.get(file.filename)
          marks.set(file.id, message === undefined ? { ok: true } : { ok: false, message })
          if (message !== undefined) details.push(`${label}: ${file.name}: ${message}`)
        }
        failed += failures.length
      } catch (error) {
        if (signal.aborted) throw error
        const message = describePeerError(error)
        const gone = isHTTPError(error) && error.response.status === 404
        if (gone) unreachable.set(username, message)
        for (const file of files) marks.set(file.id, { ok: false, message })
        failed += files.length
        details.push(gone ? `${username}: ${message}` : `${label}: ${message}`)
      } finally {
        if (!signal.aborted) atom?.set((state) => ({ ...state, marks: new Map([...state.marks, ...marks]) }))
        operation.advance(files.map((file) => file.id))
      }
    }
  } catch {
    return undefined
  }
  return { failed, details }
}

export async function enqueueDownloads<F extends File>(atom: Atom<Downloads>, batches: Batch<F>[]) {
  const files = batches.flatMap((batch) => batch.files)
  const operation = begin(
    atom,
    'download',
    files.map((file) => file.id),
  )
  const result = await enqueueBatches(operation, batches, atom)
  if (result === undefined) return
  operation.finish(summarise({ verb: 'Enqueued', noun: 'download', total: files.length, ...result }))
}
