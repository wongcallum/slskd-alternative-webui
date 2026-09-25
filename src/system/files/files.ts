import { type Actions, actOnEach, begin, idle, summarise } from '../../lib/actions'
import { api } from '../../lib/api'
import { createAtom, createResource, load, type Resource, type Sink } from '../../lib/store'
import { buildTree, type InputDirectory, type Item, type Tree } from '../../lib/tree'
import { options } from '../options/options'
import { fetchShares, type Share } from '../shares/shares'

type RawEntry = { name: string; fullName: string; attributes: string; modifiedAt: string; length?: number }

type RawListing = RawEntry & { files: RawEntry[]; directories: RawEntry[] }

export const roots = [
  { id: 'downloads', name: 'Downloads' },
  { id: 'incomplete', name: 'Incomplete' },
] as const

export type Files = { listings: readonly RawListing[]; removed: ReadonlySet<string>; tree: Tree; fetchedAt: number }

const has = (entry: RawEntry, attribute: string) => entry.attributes.split(', ').includes(attribute)

// slskd on Windows separates paths with '\', and reads either separator back.
const slashes = (path: string) => path.replaceAll('\\', '/')

const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)

function removedFrom(removed: ReadonlySet<string>, path: string) {
  for (let current = path; current !== ''; current = current.slice(0, Math.max(0, current.lastIndexOf('/')))) {
    if (removed.has(current)) return true
  }
  return false
}

// Each root is listed whole, with every path relative to it, and becomes a top folder named after it.
function toDirectories(listings: readonly RawListing[], removed: ReadonlySet<string>) {
  const directories: InputDirectory[] = []
  roots.forEach((root, index) => {
    const listing = listings[index]
    if (listing === undefined) return
    const byPath = new Map<string, InputDirectory>()
    const add = (path: string, entry: RawEntry) => {
      const directory = {
        name: path,
        files: [],
        modifiedAt: Date.parse(entry.modifiedAt),
        hidden: has(entry, 'Hidden'),
      }
      byPath.set(path, directory)
      directories.push(directory)
    }
    add(root.name, listing)
    for (const entry of listing.directories) {
      const path = `${root.name}/${slashes(entry.fullName)}`
      if (!removedFrom(removed, path)) add(path, entry)
    }
    for (const entry of listing.files) {
      const path = `${root.name}/${slashes(entry.fullName)}`
      if (removedFrom(removed, path)) continue
      // A symlinked file's length is its target's path.
      const link = has(entry, 'ReparsePoint')
      byPath.get(path.slice(0, path.lastIndexOf('/')))?.files.push({
        filename: entry.name,
        size: link ? 0 : (entry.length ?? 0),
        modifiedAt: Date.parse(entry.modifiedAt),
        hidden: has(entry, 'Hidden'),
        link,
      })
    }
  })
  return directories
}

const build = (listings: readonly RawListing[], removed: ReadonlySet<string>, fetchedAt: number): Files => ({
  listings,
  removed,
  fetchedAt,
  tree: buildTree({
    key: 'system\nfiles',
    name: 'Files',
    separator: '/',
    directories: toDirectories(listings, removed),
  }),
})

async function fetchFiles(signal: AbortSignal) {
  const listings = await Promise.all(
    roots.map(({ id }) =>
      api
        .get(`files/${id}/directories`, { searchParams: { recursive: true }, signal, timeout: false })
        .json<RawListing>(),
    ),
  )
  return build(listings, new Set(), Date.now())
}

export const filesLoading = createAtom(false)

let active: Sink<Files> | undefined

export const files: Resource<Files> = createResource((sink) => {
  active = sink
  const source = load(sink, fetchFiles, { loading: filesLoading })
  return {
    stop() {
      source.stop()
      if (active === sink) active = undefined
    },
    refresh: source.refresh,
  }
})

let dropped: string[] = []
let dropTimer: ReturnType<typeof setTimeout> | undefined

// Deleted paths leave the held tree in batches, since each one rebuilds it.
function drop(path: string) {
  dropped.push(path)
  dropTimer ??= setTimeout(() => {
    dropTimer = undefined
    const data = files.getSnapshot().data
    if (data !== undefined && active !== undefined) {
      active.set(build(data.listings, new Set([...data.removed, ...dropped]), data.fetchedAt))
    }
    dropped = []
  }, 250)
}

const encoder = new TextEncoder()

const base64 = (bytes: readonly number[]) => btoa(String.fromCodePoint(...bytes))

const dot = 0x2e
const slash = 0x2f

// slskd takes the path as base64 in a URL segment, where a '/' splits the route. It normalises './' and '//' away, so
// they're inserted wherever they shift the encoding off every '/'. A name like "Who Are You???" has one at every shift.
export function encodePath(path: string): string | undefined {
  type State = { pending: number[]; bytes: number[] }
  let states: State[] = [{ pending: [], bytes: [] }]
  path.split('/').forEach((segment, index) => {
    const bytes = [...encoder.encode(segment)]
    const joins =
      index === 0 ? [[], [dot, slash], [dot, slash, dot, slash]] : [[slash], [slash, slash], [slash, dot, slash]]
    const next = new Map<string, State>()
    for (const state of states) {
      for (const join of joins) {
        const chunk = [...state.pending, ...join, ...bytes]
        const whole = chunk.length - (chunk.length % 3)
        if (base64(chunk.slice(0, whole)).includes('/')) continue
        const pending = chunk.slice(whole)
        const key = pending.join()
        if (!next.has(key)) next.set(key, { pending, bytes: [...state.bytes, ...join, ...bytes] })
      }
    }
    states = [...next.values()]
  })
  const found = states.find((state) => !base64(state.pending).includes('/'))
  return found === undefined ? undefined : base64(found.bytes)
}

export type Target = {
  id: string
  kind: Item['kind']
  root: (typeof roots)[number]['id']
  relative: string
  size: number
}

// Paths are "Downloads/…", so the first segment names the root. Anything inside a selected folder goes with it.
export function targetsOf(items: readonly Item[]): Target[] {
  const targets: Target[] = []
  const paths = items.map((item) => (item.kind === 'folder' ? item.path : item.filename))
  items.forEach((item, index) => {
    const path = paths[index] ?? ''
    if (paths.some((other, at) => at !== index && items[at]?.kind === 'folder' && path.startsWith(`${other}/`))) return
    const cut = path.indexOf('/')
    const root = roots.find(({ name }) => name === path.slice(0, cut))
    if (root === undefined || cut < 0) return
    targets.push({ id: path, kind: item.kind, root: root.id, relative: path.slice(cut + 1), size: item.size })
  })
  return targets
}

export type FileActions = Actions<'delete'> & { sharedDeleted: boolean }

export const fileActions = createAtom<FileActions>({ ...idle, sharedDeleted: false })

// What's deleted inside a share stays listed to peers and in searches until a rescan.
async function touchesShares(targets: Target[], signal: AbortSignal) {
  const held = options.getSnapshot().data
  if (held === undefined || targets.length === 0) return false
  let shares: readonly Share[]
  try {
    shares = (await fetchShares(signal)).shares
  } catch {
    return false
  }
  const directories = { downloads: held.downloads, incomplete: held.incomplete }
  return targets.some((target) => {
    const path = `${slashes(directories[target.root]).replace(/\/+$/, '')}/${target.relative}`
    const local = (share: Share) => slashes(share.localPath)
    if (shares.some((share) => share.excluded && within(path, local(share)))) return false
    return shares.some((share) => !share.excluded && (within(path, local(share)) || within(local(share), path)))
  })
}

export async function deleteItems(items: readonly Item[]) {
  const targets = targetsOf(items)
  fileActions.set((state) => ({ ...state, sharedDeleted: false }))
  const operation = begin(
    fileActions,
    'delete',
    targets.map((target) => target.id),
    () => files.refresh(),
  )
  const deleted: Target[] = []
  const errors = await actOnEach(
    operation,
    targets,
    (target) => target.id,
    async (target, signal) => {
      const encoded = encodePath(target.relative)
      if (encoded === undefined) throw new Error("slskd can't address this name")
      await api.delete(`files/${target.root}/${target.kind === 'folder' ? 'directories' : 'files'}/${encoded}`, {
        signal,
      })
      deleted.push(target)
      drop(target.id)
    },
    1,
  )
  if (errors === undefined) return
  const sharedDeleted = await touchesShares(deleted, operation.signal)
  if (operation.signal.aborted) return
  fileActions.set((state) => ({ ...state, sharedDeleted }))
  operation.finish(summarise('Deleted', targets.length, errors.length, errors, 'item'))
}

export const dismissSharedHint = () => fileActions.set((state) => ({ ...state, sharedDeleted: false }))
