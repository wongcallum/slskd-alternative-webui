import { isHTTPError } from 'ky'
import pMap from 'p-map'
import { type Actions, begin, idle, summarise } from './actions'
import { api, describeError, resendOn429 } from './api'
import { toTime } from './format'
import { searchHub, useHub } from './hubs'
import { sessionSignal } from './session'
import { createAtom, createResource, poll, type Source, shallowEqual, useResource, useStale } from './store'

type RawSearch = {
  id: string
  searchText: string
  state: string
  isComplete: boolean
  startedAt: string
  endedAt?: string | null
  responseCount: number
  fileCount: number
  lockedFileCount: number
}

export type Search = {
  id: string
  text: string
  state: string
  isComplete: boolean
  startedAt: number
  // slskd sets this once the responses are saved, which happens after the Completed state change is pushed.
  endedAt?: number
  responses: number
  files: number
  locked: number
  search: string
}

export type Searches = { via: 'hub' | 'poll'; list: Search[]; byId: ReadonlyMap<string, Search> }

export const searchPollInterval = 2000

const byNewest = (a: Search, b: Search) => b.startedAt - a.startedAt

function toSearch(raw: RawSearch, previous: Search | undefined): Search {
  // slskd doesn't await its state-change pushes, so an older one can arrive after the search completed.
  if (previous?.isComplete && !raw.isComplete) return previous
  const next: Search = {
    id: raw.id,
    text: raw.searchText,
    state: raw.state,
    isComplete: raw.isComplete,
    startedAt: toTime(raw.startedAt),
    endedAt: raw.endedAt ? toTime(raw.endedAt) : previous?.endedAt,
    responses: raw.responseCount,
    files: raw.fileCount,
    locked: raw.lockedFileCount,
    search: raw.searchText.toLowerCase(),
  }
  return previous !== undefined && shallowEqual(previous, next) ? previous : next
}

function settle(via: Searches['via'], byId: Map<string, Search>, previous: Searches | undefined): Searches {
  const list = [...byId.values()].sort(byNewest)
  const same =
    previous !== undefined &&
    previous.list.length === list.length &&
    list.every((search, index) => previous.list[index] === search)
  return same ? { ...previous, via } : { via, list, byId }
}

let upsertLocally: ((raw: RawSearch) => void) | undefined

export const searches = createResource<Searches>((sink) => {
  const current = () => searches.getSnapshot().data
  // A push for a search can still be in flight when its DELETE arrives.
  const deleted = new Set<string>()

  function replace(via: Searches['via'], raws: RawSearch[]) {
    const previous = current()
    const byId = new Map<string, Search>()
    for (const raw of raws) byId.set(raw.id, toSearch(raw, previous?.byId.get(raw.id)))
    return settle(via, byId, previous)
  }

  function upsert(raw: RawSearch) {
    const previous = current()
    if (previous === undefined || deleted.has(raw.id)) return
    sink.set(settle(previous.via, new Map(previous.byId).set(raw.id, toSearch(raw, previous.byId.get(raw.id))), previous))
  }

  function remove(raw: RawSearch) {
    deleted.add(raw.id)
    const previous = current()
    if (previous === undefined || !previous.byId.has(raw.id)) return
    const byId = new Map(previous.byId)
    byId.delete(raw.id)
    sink.set(settle(previous.via, byId, previous))
  }

  let polling: Source | undefined
  function sync() {
    if (searchHub.getStatus().state === 'connected') {
      polling?.stop()
      polling = undefined
    } else {
      polling ??= poll(
        sink,
        async (signal, measure) => {
          const text = await api.get('searches', { signal }).text()
          return measure(() => replace('poll', JSON.parse(text) as RawSearch[]))
        },
        searchPollInterval,
      )
    }
  }

  const offs = [
    searchHub.on<RawSearch[]>('LIST', (raws) => {
      deleted.clear()
      sink.set(replace('hub', raws))
    }),
    searchHub.on<RawSearch>('CREATE', upsert),
    searchHub.on<RawSearch>('UPDATE', upsert),
    searchHub.on<RawSearch>('DELETE', remove),
  ]
  const unsubscribe = searchHub.subscribe(sync)
  sync()
  // The hub only sends LIST as it connects, so a list restarted while the hub stayed connected has missed pushes.
  const controller = new AbortController()
  if (searchHub.getStatus().state === 'connected') {
    api
      .get('searches', { signal: controller.signal })
      .json<RawSearch[]>()
      .then(
        (raws) => sink.set(replace('hub', raws.filter((raw) => !deleted.has(raw.id)))),
        (error: unknown) => {
          if (!controller.signal.aborted) sink.fail(error)
        },
      )
  }
  upsertLocally = upsert
  return {
    stop() {
      controller.abort()
      polling?.stop()
      for (const off of offs) off()
      unsubscribe()
      upsertLocally = undefined
    },
    refresh: () => polling?.refresh?.(),
  }
})

export function useSearches() {
  const { data, error } = useResource(searches)
  const hub = useHub(searchHub)
  const polled = !useStale(searches, searchPollInterval)
  const live = data?.via === 'hub' && hub.state === 'connected'
  return { data, error, live, known: data !== undefined && (live || (data.via === 'poll' && polled)) }
}

// Stop and Delete act on slskd's stored list, so they wait until it's known.
export const listGate = (known: boolean) => (known ? undefined : 'The list is out of date')

export async function createSearch(text: string) {
  const signal = sessionSignal()
  const raw = await resendOn429(
    () => api.post('searches', { json: { searchText: text }, signal }).json<RawSearch>(),
    signal,
  )
  // While the hub is down, the new search would otherwise be missing from the list until the next poll.
  upsertLocally?.(raw)
  return raw.id
}

export type ListActionKind = 'stop' | 'delete'

export const listActions = createAtom<Actions<ListActionKind>>(idle)

async function each(kind: ListActionKind, list: Search[], act: (search: Search, signal: AbortSignal) => Promise<void>) {
  const operation = begin(
    listActions,
    kind,
    list.map((search) => search.id),
    () => searches.refresh(),
  )
  const errors: string[] = []
  try {
    await pMap(
      list,
      async (search) => {
        try {
          await act(search, operation.signal)
        } catch (error) {
          if (operation.signal.aborted) throw error
          errors.push(`${search.text}: ${describeError(error)}`)
        } finally {
          operation.advance([search.id])
        }
      },
      { concurrency: 4, signal: operation.signal },
    )
  } catch {
    return
  }
  operation.finish(
    summarise(kind === 'stop' ? 'Stopped' : 'Deleted', list.length, errors.length, errors, 'search', 'searches'),
  )
}

const stopOne = async (search: Search, signal: AbortSignal) => {
  await api.put(`searches/${search.id}`, { signal })
}

export const stopSearches = (list: Search[]) => each('stop', list, stopOne)

function saved(id: string, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, 5000)
    const unwatch = searches.watch(check)
    signal.addEventListener('abort', done)
    check()
    function check() {
      if (searches.getSnapshot().data?.byId.get(id)?.endedAt !== undefined) done()
    }
    function done() {
      clearTimeout(timer)
      unwatch()
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

// A DELETE alone leaves a running search running and holding one of slskd's two search slots, and its
// finalisation then fails against the missing row. So an unsaved search is stopped and given time to save first.
export const deleteSearches = (list: Search[]) =>
  each('delete', list, async (search, signal) => {
    if ((searches.getSnapshot().data?.byId.get(search.id) ?? search).endedAt === undefined) {
      await stopOne(search, signal)
      await saved(search.id, signal)
    }
    try {
      await api.delete(`searches/${search.id}`, { signal })
    } catch (error) {
      if (!isHTTPError(error) || error.response.status !== 404) throw error
    }
  })
