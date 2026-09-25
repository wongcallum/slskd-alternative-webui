import { isHTTPError } from 'ky'

import { type Actions, begin, idle, type Operation, summarise } from '../lib/actions'
import { api, describeError, resendOn429 } from '../lib/api'
import { type Atom, createAtom } from '../lib/store'

type EnqueueResponse = { failures: { filename: string; message: string }[] }

// slskd runs at most two enqueues at once.
const enqueue = (body: object, signal: AbortSignal) =>
  resendOn429(() => api.post('transfers/downloads/batches', { json: body, signal }).json<EnqueueResponse>(), signal)

export type Mark = { ok: true } | { ok: false; message: string }

export type Downloads = Actions<'download'> & { marks: ReadonlyMap<string, Mark> }

// Each search and each share keeps its own enqueue progress and marks.
export function createDownloads() {
  const atoms = new Map<string, Atom<Downloads>>()
  return (key: string) => {
    let atom = atoms.get(key)
    if (atom === undefined) atoms.set(key, (atom = createAtom<Downloads>({ ...idle, marks: new Map() })))
    return atom
  }
}

type File = { id: string; filename: string; name: string; size: number }

export type Batch<F extends File> = {
  username: string
  label: string
  files: F[]
  searchId?: string
  destination?: string
}

// Batches are sent one at a time, and once a user turns out to be offline the rest of theirs are skipped. Each file
// is marked in the atom, if there is one. Returns undefined once the session has ended.
export async function enqueueBatches<F extends File>(
  operation: Operation,
  batches: Batch<F>[],
  atom?: Atom<Downloads>,
) {
  const { signal } = operation
  const offline = new Set<string>()
  const details: string[] = []
  let failed = 0
  try {
    for (const { username, label, files, searchId, destination } of batches) {
      const marks = new Map<string, Mark>()
      try {
        if (offline.has(username)) {
          for (const file of files) marks.set(file.id, { ok: false, message: 'offline' })
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
        const gone = isHTTPError(error) && error.response.status === 404
        if (gone) offline.add(username)
        const message = gone ? 'offline' : describeError(error)
        for (const file of files) marks.set(file.id, { ok: false, message })
        failed += files.length
        details.push(gone ? `${username} is offline` : `${label}: ${message}`)
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
  operation.finish(summarise('Enqueued', files.length, result.failed, result.details, 'download'))
}
