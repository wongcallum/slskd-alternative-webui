import { browse, cachedShare } from '../../browse/browse'
import { api, describeError } from '../../lib/api'
import { describeRange, lastSeparator, nameOf, qualityOf, type RawFile, widenRange } from '../../lib/files'
import { createAtom } from '../../lib/store'
import { byName, compareNames, queryMatcher } from '../../lib/text'
import { filesUnder, type TreeFile } from '../../lib/tree'
import { sessionSignal } from '../../session/session'
import { createDownloads, enqueueDownloads } from '../../transfers/enqueue'

export type RawResponse = {
  username: string
  files: RawFile[]
  lockedFiles: RawFile[]
  hasFreeUploadSlot: boolean
  queueLength: number
  uploadSpeed: number
}

type Peer = { username: string; free: boolean; queueLength: number; speed: number }

export type ResultFile = {
  kind: 'file'
  id: string
  peer: Peer
  username: string
  directory: string
  filename: string
  name: string
  size: number
  length?: number
  bitRate?: number
  bitDepth?: number
  sampleRate?: number
  isVariableBitRate?: boolean
  quality: number
  qualityLabel: string
  locked: boolean
  matched: boolean
  search: string
}

export type ResultGroup = {
  kind: 'group'
  id: string
  peer: Peer
  username: string
  directory: string
  name: string
  files: ResultFile[]
  matched: number
  total: number
  size: number
  length: number
  quality: number
  qualityLabel: string
}

export type Results = {
  all: ResultGroup[]
  unlocked: ResultGroup[]
  byId: ReadonlyMap<string, ResultGroup>
  locked: number
}

const directoryOf = (filename: string) => filename.slice(0, Math.max(0, lastSeparator(filename)))

function folderName(directory: string) {
  const last = lastSeparator(directory)
  return last <= 0 ? directory : directory.slice(lastSeparator(directory, last - 1) + 1)
}

// A folder is rated by its worst file, ignoring files without attributes such as cover art.
function qualityRange(files: ResultFile[]): [number, string] {
  const range: { worst?: ResultFile; best?: ResultFile } = {}
  for (const file of files) widenRange(range, file)
  return describeRange(range.worst, range.best)
}

function toFile(raw: RawFile, peer: Peer, locked: boolean, matched: boolean): ResultFile {
  const [quality, qualityLabel] = qualityOf(raw)
  return {
    kind: 'file',
    id: `${peer.username}\n${raw.filename}`,
    peer,
    username: peer.username,
    directory: directoryOf(raw.filename),
    filename: raw.filename,
    name: nameOf(raw.filename),
    size: raw.size,
    length: raw.length,
    bitRate: raw.bitRate,
    bitDepth: raw.bitDepth,
    sampleRate: raw.sampleRate,
    isVariableBitRate: raw.isVariableBitRate,
    quality,
    qualityLabel,
    locked,
    matched,
    search: `${peer.username}\n${raw.filename}`.toLowerCase(),
  }
}

function buildGroup(id: string, peer: Peer, directory: string, files: ResultFile[], total = files.length): ResultGroup {
  let size = 0
  let length = 0
  let matched = 0
  for (const file of files) {
    size += file.size
    length += file.length ?? 0
    if (file.matched) matched++
  }
  const [quality, qualityLabel] = qualityRange(files)
  return {
    kind: 'group',
    id,
    peer,
    username: peer.username,
    directory,
    name: folderName(directory),
    files,
    matched,
    total,
    size,
    length,
    quality,
    qualityLabel,
  }
}

// A free upload slot means a download can start at once, whatever the queue length says.
export const availability = (peer: Peer) => (peer.free ? -1 : peer.queueLength)

const byDefault = (a: ResultGroup, b: ResultGroup) =>
  availability(a.peer) - availability(b.peer) ||
  b.peer.speed - a.peer.speed ||
  compareNames(a.name, b.name) ||
  compareNames(a.username, b.username)

function toResults(responses: RawResponse[]): Results {
  const folders = new Map<string, { peer: Peer; directory: string; files: Map<string, ResultFile> }>()
  const peers = new Map<string, Peer>()
  let locked = 0
  for (const response of responses) {
    let peer = peers.get(response.username)
    if (peer === undefined) {
      peer = {
        username: response.username,
        free: response.hasFreeUploadSlot,
        queueLength: response.queueLength,
        speed: response.uploadSpeed,
      }
      peers.set(peer.username, peer)
    }
    for (const [raws, isLocked] of [
      [response.files, false],
      [response.lockedFiles, true],
    ] as const) {
      for (const raw of raws) {
        const file = toFile(raw, peer, isLocked, true)
        const id = `${peer.username}\n${file.directory}\n`
        let folder = folders.get(id)
        if (folder === undefined) folders.set(id, (folder = { peer, directory: file.directory, files: new Map() }))
        if (folder.files.has(file.id)) continue
        folder.files.set(file.id, file)
        if (isLocked) locked++
      }
    }
  }
  const all: ResultGroup[] = []
  const unlocked: ResultGroup[] = []
  for (const [id, folder] of folders) {
    const files = [...folder.files.values()].sort(byName)
    const group = buildGroup(id, folder.peer, folder.directory, files)
    all.push(group)
    const open = files.filter((file) => !file.locked)
    if (open.length === files.length) unlocked.push(group)
    else if (open.length > 0) unlocked.push(buildGroup(id, folder.peer, folder.directory, open))
  }
  all.sort(byDefault)
  unlocked.sort(byDefault)
  return { all, unlocked, byId: new Map(all.map((group) => [group.id, group])), locked }
}

// fetchedAt is the share's, and missing means the folder isn't in it.
export type FolderFetch = {
  pending: boolean
  files?: ResultFile[]
  fetchedAt?: number
  missing?: boolean
  error?: string
  failedAt?: number
}

// Quality is a floor on the quality ranking, size is in bytes and length in seconds. Zero turns a criterion off.
type ResultFilter = {
  query: string
  locked: boolean
  free: boolean
  quality: number
  size: number
  length: number
  files: number
}

export const unfiltered = { query: '', free: false, quality: 0, size: 0, length: 0, files: 0 }

const hasAttributes = (file: ResultFile) => file.quality >= 0 || file.length !== undefined

const countAttributed = (files: ResultFile[]) => files.reduce((count, file) => count + (hasAttributes(file) ? 1 : 0), 0)

// Criteria judge files with attributes. Files without them, such as cover art, ride along while their folder still
// shows a file that has them. Fetched files bypass the filter but count towards the folder's minimum.
// Groups whose files all pass keep their identity, so TanStack reuses what it can.
export function viewGroups(results: Results, folders: ReadonlyMap<string, FolderFetch>, filter: ResultFilter) {
  const base = filter.locked ? results.all : results.unlocked
  const matches = queryMatcher(filter.query)
  const judging = filter.quality > 0 || filter.size > 0 || filter.length > 0
  if (matches === undefined && !judging && filter.files === 0 && !filter.free && folders.size === 0) return base
  const passes = (file: ResultFile) =>
    !hasAttributes(file) ||
    ((filter.quality === 0 || file.quality >= filter.quality) &&
      file.size >= filter.size &&
      (file.length ?? 0) >= filter.length)
  const view: ResultGroup[] = []
  for (const group of base) {
    if (filter.free && !group.peer.free) continue
    const fetched = folders.get(group.id)?.files ?? []
    const extras = filter.locked ? fetched : fetched.filter((file) => !file.locked)
    let files = matches === undefined ? group.files : group.files.filter((file) => matches(file.search))
    if (judging) {
      files = files.filter(passes)
      if (countAttributed(files) + countAttributed(extras) === 0) files = []
    }
    if (files.length + extras.length === 0) continue
    if (filter.files > 0 && countAttributed(files) + countAttributed(extras) < filter.files) continue
    if (extras.length === 0 && files.length === group.files.length) view.push(group)
    else {
      const merged = extras.length === 0 ? files : [...files, ...extras].sort(byName)
      view.push(buildGroup(group.id, group.peer, group.directory, merged, group.files.length + extras.length))
    }
  }
  return view
}

export type Entry = { loading: boolean; results?: Results; error?: unknown; folders: ReadonlyMap<string, FolderFetch> }

export const entries = createAtom<ReadonlyMap<string, Entry>>(new Map())

const kept = 3

function update(id: string, change: (entry: Entry) => Entry) {
  entries.set((current) => {
    const entry = current.get(id)
    return entry === undefined ? current : new Map(current).set(id, change(entry))
  })
}

export function openResults(id: string) {
  entries.set((current) => {
    if ([...current.keys()].at(-1) === id) return current
    const next = new Map(current)
    const entry = next.get(id) ?? { loading: false, folders: new Map() }
    next.delete(id)
    next.set(id, entry)
    for (const key of next.keys()) {
      if (next.size <= kept) break
      next.delete(key)
    }
    return next
  })
}

// Responses never change once saved, so they're fetched once, without a timeout since they can be several MB.
export async function loadResults(id: string) {
  const entry = entries.get().get(id)
  if (entry === undefined || entry.loading || entry.results !== undefined) return
  const signal = sessionSignal()
  update(id, (current) => ({ ...current, loading: true, error: undefined }))
  try {
    const text = await api.get(`searches/${id}/responses`, { signal, timeout: false }).text()
    const results = toResults(JSON.parse(text) as RawResponse[])
    update(id, (current) => ({ ...current, loading: false, results }))
  } catch (error) {
    if (!signal.aborted) update(id, (current) => ({ ...current, loading: false, error }))
  }
}

// Named by its path in the folder, with the quality the tree worked out, since the tree keeps fewer attributes.
const fetchedFile = (file: TreeFile, group: ResultGroup): ResultFile => ({
  ...toFile(file, group.peer, file.locked, false),
  name: file.filename.slice(group.directory.length + 1),
  quality: file.quality,
  qualityLabel: file.qualityLabel,
})

// The folder comes from the user's whole share rather than a request for the folder, since slskd peers answer that
// with files from other folders too, under paths that don't exist.
export async function fetchFolder(searchId: string, group: ResultGroup, fresh: boolean) {
  const signal = sessionSignal()
  const previous = entries.get().get(searchId)?.folders.get(group.id)
  const set = (fetch: FolderFetch) =>
    update(searchId, (entry) => ({ ...entry, folders: new Map(entry.folders).set(group.id, fetch) }))
  set({ ...previous, pending: true })
  try {
    const outcome = (fresh ? undefined : await cachedShare(group.username)) ?? (await browse(group.username))
    if (outcome === undefined) return
    if (!('share' in outcome)) throw new Error(outcome.error)
    const folder = outcome.share.byPath.get(group.directory)
    if (folder === undefined) {
      set({ pending: false, fetchedAt: outcome.fetchedAt, missing: true, failedAt: Date.now() })
      return
    }
    const present = new Set(
      entries
        .get()
        .get(searchId)
        ?.results?.byId.get(group.id)
        ?.files.map((file) => file.id),
    )
    const files = filesUnder(folder, true)
      .map((file) => fetchedFile(file, group))
      .filter((file) => !present.has(file.id))
      .sort(byName)
    set({ pending: false, files, fetchedAt: outcome.fetchedAt })
  } catch (error) {
    if (!signal.aborted) {
      set({ ...previous, pending: false, missing: false, error: describeError(error), failedAt: Date.now() })
    }
  }
}

export const downloadsOf = createDownloads()

// One batch per user, carrying the search so slskd's SEARCH_ID and SEARCH_TEXT destination variables work. A file
// selected in two groups is downloaded once.
export const download = (searchId: string, files: ResultFile[]) =>
  enqueueDownloads(
    downloadsOf(searchId),
    [...Map.groupBy(new Map(files.map((file) => [file.id, file])).values(), (file) => file.username)].map(
      ([username, batch]) => ({ username, label: username, files: batch, searchId }),
    ),
  )
