import { browse, cachedShare } from '../../browse/browse'
import { api, describeError } from '../../lib/api'
import { type Criteria, hasAttributes, judging, passes, unjudged } from '../../lib/criteria'
import { describeRange, lastSeparator, nameOf, qualityOf, type RawFile, widenRange } from '../../lib/files'
import { sessionSignal } from '../../lib/session'
import { createAtom } from '../../lib/store'
import { byName, byUsername, comparePaths, queryMatcher } from '../../lib/text'
import { filesUnder, type TreeFile } from '../../lib/tree'
import { type Batch, createDownloads, destinationOf, enqueueDownloads } from '../../transfers/enqueue'

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
  fetchedWith?: string
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

// A folder's id ends in a newline, which no filename does, so it can't be a file's.
const fileId = (username: string, filename: string) => `${username}\n${filename}`
const folderId = (username: string, directory: string) => `${username}\n${directory}\n`

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
    id: fileId(peer.username, raw.filename),
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
    name: nameOf(directory),
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
  byUsername(a, b) ||
  comparePaths(a.directory, b.directory)

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
        const id = folderId(peer.username, file.directory)
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

type ResultFilter = Criteria & {
  query: string
  locked: boolean
  free: boolean
  files: number
  hidden: ReadonlySet<string>
}

export const unfiltered = { ...unjudged, query: '', free: false, files: 0, hidden: new Set<string>() }

const countAttributed = (files: ResultFile[]) => files.reduce((count, file) => count + (hasAttributes(file) ? 1 : 0), 0)

// Fetched files bypass the filter but count towards the folder's minimum. Groups whose files all pass keep their
// identity, so TanStack reuses what it can.
export function viewGroups(results: Results, folders: ReadonlyMap<string, FolderFetch>, filter: ResultFilter) {
  const base = filter.locked ? results.all : results.unlocked
  const matches = queryMatcher(filter.query)
  const judged = judging(filter)
  if (
    matches === undefined &&
    !judged &&
    filter.files === 0 &&
    !filter.free &&
    filter.hidden.size === 0 &&
    folders.size === 0
  ) {
    return base
  }
  const view: ResultGroup[] = []
  for (const group of base) {
    if ((filter.free && !group.peer.free) || filter.hidden.has(group.username)) continue
    const fetched = folders.get(group.id)?.files ?? []
    const extras = filter.locked ? fetched : fetched.filter((file) => !file.locked)
    let files = matches === undefined ? group.files : group.files.filter((file) => matches(file.search))
    if (judged) {
      files = files.filter((file) => passes(filter, file))
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
  fetchedWith: group.directory,
})

// The folder comes from the user's whole share rather than a request for the folder, since slskd peers answer that
// with files from other folders too, under paths that don't exist.
export async function fetchFolder(searchId: string, group: ResultGroup, fresh: boolean) {
  const signal = sessionSignal()
  const previous = entries.get().get(searchId)?.folders.get(group.id)
  const set = (fetch: FolderFetch) =>
    update(searchId, (entry) => ({ ...entry, folders: new Map(entry.folders).set(group.id, fetch) }))
  const fail = (error: string) => set({ ...previous, pending: false, missing: false, error, failedAt: Date.now() })
  set({ ...previous, pending: true })
  try {
    const outcome = (fresh ? undefined : await cachedShare(group.username)) ?? (await browse(group.username))
    if (outcome === undefined || signal.aborted) return
    if (!('share' in outcome)) {
      fail(outcome.error)
      return
    }
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
    if (!signal.aborted) fail(describeError(error))
  }
}

export const downloadsOf = createDownloads()

const within = (directory: string, root: string) =>
  directory === root || directory.startsWith(`${root}\\`) || directory.startsWith(`${root}/`)

// One batch per user, carrying the search so slskd's SEARCH_ID and SEARCH_TEXT destination variables work. Once a
// fetched folder's subfolders are downloaded, everything under that folder goes in a batch per remote folder instead,
// rooted at it, like a download from Browse. A file selected in two groups is downloaded once.
export function download(searchId: string, files: ResultFile[]) {
  const unique = [...new Map(files.map((file) => [file.id, file])).values()]
  const roots = new Map<string, { username: string; directory: string }>()
  for (const { username, directory, fetchedWith } of unique) {
    if (fetchedWith !== undefined && directory !== fetchedWith) {
      roots.set(`${username}\n${fetchedWith}`, { username, directory: fetchedWith })
    }
  }
  const outermost = [...roots.values()].sort((a, b) => a.directory.length - b.directory.length)
  const batches = new Map<string, Batch<ResultFile>>()
  for (const file of unique) {
    const root = outermost.find((each) => each.username === file.username && within(file.directory, each.directory))
    const key = root === undefined ? file.username : `${file.username}\n${file.directory}`
    let batch = batches.get(key)
    if (batch === undefined) {
      const destination =
        root &&
        destinationOf([nameOf(root.directory), ...file.directory.slice(root.directory.length + 1).split(/[\\/]/)])
      batches.set(key, (batch = { username: file.username, label: file.username, files: [], searchId, destination }))
    }
    batch.files.push(file)
  }
  return enqueueDownloads(downloadsOf(searchId), [...batches.values()])
}
