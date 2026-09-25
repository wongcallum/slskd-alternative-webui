import { api } from '../lib/api'
import { applicationHub, followHub, type Via } from '../lib/hubs'
import { createResource, useResource } from '../lib/store'

// Secrets arrive redacted. Only what's read here is typed.
type RawOptions = {
  remoteFileManagement: boolean
  directories: { downloads: string; incomplete: string }
  shares: { directories: string[]; filters: string[] }
}

export type Options = {
  via: Via
  remoteFileManagement: boolean
  downloads: string
  incomplete: string
  shareDirectories: readonly string[]
  shareFilters: readonly string[]
}

const optionsPollInterval = 10_000

// Every push carries new arrays, which would count as a change.
function same(previous: readonly string[] | undefined, next: string[]) {
  return previous !== undefined && previous.length === next.length && previous.every((each, i) => each === next[i])
    ? previous
    : next
}

function fromOptions(via: Via, raw: RawOptions): Options {
  const previous = options.getSnapshot().data
  return {
    via,
    remoteFileManagement: raw.remoteFileManagement,
    downloads: raw.directories.downloads,
    incomplete: raw.directories.incomplete,
    shareDirectories: same(previous?.shareDirectories, raw.shares.directories),
    shareFilters: same(previous?.shareFilters, raw.shares.filters),
  }
}

const fetchOptions = async (via: Via, signal: AbortSignal) =>
  fromOptions(via, await api.get('options', { signal }).json<RawOptions>())

export const options = createResource<Options>((sink) => {
  const offOptions = applicationHub.on<RawOptions>('OPTIONS', (raw) => sink.set(fromOptions('hub', raw)))
  const following = followHub(applicationHub, sink, {
    snapshot: (signal) => fetchOptions('hub', signal),
    request: (signal) => fetchOptions('poll', signal),
    interval: optionsPollInterval,
  })
  return {
    stop() {
      following.stop()
      offOptions()
    },
  }
})

export const useOptions = () => useResource(options).data
