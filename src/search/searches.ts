import { isHTTPError } from 'ky'

import { type Actions, actOnEach, begin, idle, summarise } from '../lib/actions'
import { api, resendOn429 } from '../lib/api'
import { toTime } from '../lib/format'
import { followHub, searchHub, useLiveResource, type Via } from '../lib/hubs'
import { createAtom, createResource, shallowEqual, waitFor } from '../lib/store'
import { sessionSignal } from '../session/session'

export type RawSearch = {
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

export type Searches = { via: Via; list: Search[]; byId: ReadonlyMap<string, Search> }

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

function settle(via: Via, byId: Map<string, Search>, previous: Searches | undefined): Searches {
  const list = [...byId.values()].sort(byNewest)
  const same =
    previous !== undefined &&
    previous.list.length === list.length &&
    list.every((search, index) => previous.list[index] === search)
  return same ? { ...previous, via } : { via, list, byId }
}

let upsertLocally: ((raw: RawSearch) => void) | undefined

const current = () => searches.getSnapshot().data

export const searches = createResource<Searches>((sink) => {
  // A push for a search can still be in flight when its DELETE arrives.
  const deleted = new Set<string>()

  function replace(via: Via, raws: RawSearch[]): Searches {
    const previous = current()
    const byId = new Map<string, Search>()
    for (const raw of raws) byId.set(raw.id, toSearch(raw, previous?.byId.get(raw.id)))
    return settle(via, byId, previous)
  }

  function upsert(raw: RawSearch) {
    const previous = current()
    if (previous === undefined || deleted.has(raw.id)) return
    sink.set(
      settle(previous.via, new Map(previous.byId).set(raw.id, toSearch(raw, previous.byId.get(raw.id))), previous),
    )
  }

  function remove(raw: RawSearch) {
    deleted.add(raw.id)
    const previous = current()
    if (previous === undefined || !previous.byId.has(raw.id)) return
    const byId = new Map(previous.byId)
    byId.delete(raw.id)
    sink.set(settle(previous.via, byId, previous))
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
  const following = followHub(searchHub, sink, {
    snapshot: async (signal) => {
      const raws = await api.get('searches', { signal }).json<RawSearch[]>()
      return replace(
        'hub',
        raws.filter((raw) => !deleted.has(raw.id)),
      )
    },
    request: async (signal, measure) => {
      const text = await api.get('searches', { signal }).text()
      return measure(() => replace('poll', JSON.parse(text) as RawSearch[]))
    },
    interval: searchPollInterval,
  })
  upsertLocally = upsert
  return {
    stop() {
      following.stop()
      for (const off of offs) off()
      upsertLocally = undefined
    },
    refresh: following.refresh,
  }
})

export const useSearches = () => useLiveResource(searches, searchHub, searchPollInterval)

// Stop and Delete act on slskd's stored list, so they wait until it's known.
export const listGate = (known: boolean) => (known ? undefined : 'The list is out of date')

// slskd refuses a search without a term, and still stores it as errored. Like Soulseek.NET, this splits on single
// spaces, and a word of one character doesn't count, since it's dropped.
export const hasSearchTerm = (text: string) => text.split(' ').some((word) => word.length > 1 && !word.startsWith('-'))

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

type ListActionKind = 'stop' | 'delete'

export const listActions = createAtom<Actions<ListActionKind>>(idle)

async function each(kind: ListActionKind, list: Search[], act: (search: Search, signal: AbortSignal) => Promise<void>) {
  const operation = begin(
    listActions,
    kind,
    list.map((search) => search.id),
    () => searches.refresh(),
  )
  const errors = await actOnEach(operation, list, (search) => search.text, act)
  if (errors === undefined) return
  operation.finish(
    summarise(kind === 'stop' ? 'Stopped' : 'Deleted', list.length, errors.length, errors, 'search', 'searches'),
  )
}

const stopOne = async (search: Search, signal: AbortSignal) => {
  await api.put(`searches/${search.id}`, { signal })
}

export const stopSearches = (list: Search[]) => each('stop', list, stopOne)

// For the one search on screen, where the outcome shows beside it.
export async function stopSearch(search: Search) {
  await stopOne(search, sessionSignal())
  searches.refresh()
}

// A DELETE alone leaves a running search running and holding one of slskd's two search slots, and its
// finalisation then fails against the missing row. So an unsaved search is stopped and given time to save first.
export const deleteSearches = (list: Search[]) =>
  each('delete', list, async (search, signal) => {
    if ((searches.getSnapshot().data?.byId.get(search.id) ?? search).endedAt === undefined) {
      await stopOne(search, signal)
      await waitFor(searches, (data) => data.byId.get(search.id)?.endedAt !== undefined, signal, 5000)
    }
    try {
      await api.delete(`searches/${search.id}`, { signal })
    } catch (error) {
      if (!isHTTPError(error) || error.response.status !== 404) throw error
    }
  })
