import { isHTTPError } from 'ky'

import { api, sleep } from '../../lib/api'
import { createAtom, createResource, load, type Resource } from '../../lib/store'
import { compareExactly } from '../../lib/text'
import { buildTree, type InputDirectory, type Tree } from '../../lib/tree'
import { type Application, application } from '../application'
import { options } from '../options/options'

// GET /shares omits the counts until a scan has made them.
type RawShare = {
  id: string
  alias: string
  isExcluded: boolean
  localPath: string
  directories?: number
  files?: number
}

export type Share = {
  host: string
  id: string
  alias: string
  excluded: boolean
  localPath: string
  folders?: number
  files?: number
}

type ShareList = { shares: readonly Share[]; hosts: number }

// Scans seen to finish in this session. Anything read from the share database before the latest is out of date.
const scansFinished = createAtom(0)

let previous: Application | undefined

// A cancelled scan finishes like a successful one, but a faulted one never turns ready.
application.watch(() => {
  const data = application.getSnapshot().data
  const finished =
    previous !== undefined &&
    data !== undefined &&
    ((!previous.scanReady && data.scanReady) || (previous.scanning && !data.scanning && data.scanFaulted))
  previous = data
  if (finished) scansFinished.set((count) => count + 1)
})

const segments = (path: string) => path.split(/[\\/]/)

// By segment, so a share's exclusions and nested shares sit right below it.
function byPath(a: Share, b: Share) {
  const [left, right] = [segments(a.localPath), segments(b.localPath)]
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = compareExactly(left[i] ?? '', right[i] ?? '')
    if (order !== 0) return order
  }
  return left.length - right.length || compareExactly(a.host, b.host)
}

export async function fetchShares(signal: AbortSignal): Promise<ShareList> {
  const hosts = await api.get('shares', { signal }).json<Record<string, RawShare[]>>()
  const shares = Object.entries(hosts).flatMap(([host, list]) =>
    list.map((share) => ({
      host,
      id: share.id,
      alias: share.alias,
      excluded: share.isExcluded,
      localPath: share.localPath,
      folders: share.directories,
      files: share.files,
    })),
  )
  return { shares: shares.sort(byPath), hosts: Object.keys(hosts).length }
}

// The list changes with the config, and its counts once a scan finishes.
export const shareList = createResource<ShareList>((sink) => {
  const source = load(sink, fetchShares)
  let directories = options.getSnapshot().data?.shareDirectories
  const offOptions = options.watch(() => {
    const next = options.getSnapshot().data?.shareDirectories
    if (next === undefined) return
    if (directories !== undefined && next !== directories) source.refresh()
    directories = next
  })
  const offScans = scansFinished.subscribe(source.refresh)
  return {
    stop() {
      source.stop()
      offOptions()
      offScans()
    },
    refresh: source.refresh,
  }
})

export type Contents = { tree: Tree; fetchedAt: number; scans: number }

export const contentsLoading = createAtom(false)

// slskd joins remote paths with a backslash, and each alias is a top folder.
async function fetchContents(signal: AbortSignal): Promise<Contents> {
  const scans = scansFinished.get()
  const text = await api.get('shares/contents', { signal, timeout: false }).text()
  await sleep(0)
  const directories = JSON.parse(text) as InputDirectory[]
  await sleep(0)
  signal.throwIfAborted()
  const tree = buildTree({ key: 'system\nshares', name: 'Shares', separator: '\\', directories })
  return { tree, fetchedAt: Date.now(), scans }
}

// Held for the session, and read again only once a scan has finished since.
export const contents: Resource<Contents> = createResource((sink) => {
  const held = contents.getSnapshot().data
  const source = load(sink, fetchContents, {
    loading: contentsLoading,
    skip: held !== undefined && held.scans === scansFinished.get(),
  })
  const offScans = scansFinished.subscribe(source.refresh)
  return {
    stop() {
      source.stop()
      offScans()
    },
    refresh: source.refresh,
  }
})

// Before any scan has created the share database, reading it fails.
export const notScanned = (error: unknown) =>
  isHTTPError(error) && error.response.status === 500 && String(error.data).includes('no such table')

export const rescan = () => api.put('shares')

export const cancelScan = () => api.delete('shares')
