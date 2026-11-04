import { parseFromWebStream } from '@discoveryjs/json-ext'
import { isHTTPError } from 'ky'

import { api, describeError, sleep } from '../lib/api'
import {
  announce as announceChange,
  createRecordList,
  type Database,
  db,
  onAnnounce,
  removeUser,
  type ShareRecord,
} from '../lib/db'
import { sessionSignal } from '../lib/session'
import { createAtom, without } from '../lib/store'
import { buildTree, type Folder, relativePath, type Tree, type TreeFile } from '../lib/tree'
import { describePeerError } from '../soulseek/soulseek'
import { createDownloads, destinationOf, enqueueDownloads } from '../transfers/enqueue'
import { packShare, type RawShare, unpackShare } from './pack'

// Parsing, building and the first render are separate tasks, so the page can paint between them.
async function build(username: string, raw: RawShare) {
  await sleep(0)
  const share = buildTree({ key: `user\n${username}`, name: username, ...raw })
  await sleep(0)
  return share
}

const capacity = 2 ** 30

const { list: shareList, load: loadShareList, useList } = createRecordList('shares')

export const useShareList = useList

export type Ready = { status: 'ready'; share: Tree; fetchedAt: number; notCached?: unknown }

export type Loaded = { status: 'loading' } | { status: 'missing' } | { status: 'failed'; error: unknown } | Ready

export const loadedShares = createAtom<ReadonlyMap<string, Loaded>>(new Map())

const kept = 2

const viewing = new Map<string, number>()

function setLoaded(username: string, loaded: Loaded | undefined) {
  loadedShares.set((current) => {
    const next = without(current, username)
    if (loaded === undefined) return next
    next.set(username, loaded)
    let ready = [...next].filter(([, each]) => each.status === 'ready').length
    for (const [key, each] of next) {
      if (ready <= kept) break
      if (each.status !== 'ready' || viewing.has(key)) continue
      next.delete(key)
      ready--
    }
    return next
  })
}

const reads = new Map<string, Promise<unknown>>()

// A browse or a newer read that lands first wins, and then this one returns undefined.
function readShare(username: string) {
  const read = readStored(username)
  reads.set(username, read)
  void read.finally(() => {
    if (reads.get(username) === read) reads.delete(username)
  })
  return read
}

async function readStored(username: string) {
  const signal = sessionSignal()
  const loading: Loaded = { status: 'loading' }
  setLoaded(username, loading)
  const current = () => !signal.aborted && loadedShares.get().get(username) === loading
  const settle = (loaded: Loaded) => {
    if (!current()) return undefined
    setLoaded(username, loaded)
    return loaded
  }
  try {
    const transaction = (await db()).transaction(['shares', 'trees'])
    const [record, blob] = await Promise.all([
      transaction.objectStore('shares').get(username),
      transaction.objectStore('trees').get(username),
    ])
    if (record === undefined || blob === undefined) return settle({ status: 'missing' })
    if (!current()) return undefined
    return settle({
      status: 'ready',
      share: await build(username, await unpackShare(blob)),
      fetchedAt: record.fetchedAt,
    })
  } catch (error) {
    return settle({ status: 'failed', error })
  }
}

// A share page keeps its share in memory while it's open, and moves it to the front of the kept ones.
export function viewShare(username: string) {
  viewing.set(username, (viewing.get(username) ?? 0) + 1)
  const loaded = loadedShares.get().get(username)
  if (loaded === undefined || loaded.status === 'failed') void readShare(username)
  else setLoaded(username, loaded)
  void touch(username)
  return () => {
    const count = (viewing.get(username) ?? 1) - 1
    if (count === 0) viewing.delete(username)
    else viewing.set(username, count)
  }
}

export const reloadShare = (username: string) => void readShare(username)

// The share in memory, or else the cached one, which it reads if no read is running and waits for if one is. A
// failed read is a Failure, and undefined means neither has it. Using it counts as opening the share, for eviction.
export async function cachedShare(username: string): Promise<Ready | Failure | undefined> {
  if (loadedShares.get().get(username)?.status !== 'ready') {
    if (!reads.has(username)) void readShare(username)
    for (let read = reads.get(username); read !== undefined; read = reads.get(username)) await read
  }
  const loaded = loadedShares.get().get(username)
  if (loaded?.status === 'failed') return { status: 'failed', message: describeError(loaded.error), at: Date.now() }
  if (loaded?.status !== 'ready') return undefined
  void touch(username)
  return loaded
}

async function touch(username: string) {
  try {
    const transaction = (await db()).transaction('shares', 'readwrite')
    const record = await transaction.store.get(username)
    if (record !== undefined) await transaction.store.put({ ...record, openedAt: Date.now() })
    await transaction.done
  } catch {
    // A failed touch only changes which share is evicted first.
  }
}

async function evict(database: Database) {
  const records = await database.getAll('shares')
  let stored = records.reduce((sum, each) => sum + each.bytes, 0)
  const held = new Set([...viewing.keys(), ...loadedShares.get().keys(), ...browses.get().keys()])
  for (const record of records.sort((a, b) => a.openedAt - b.openedAt)) {
    if (stored <= capacity) break
    if (held.has(record.username)) continue
    await remove(database, record.username)
    stored -= record.bytes
  }
}

const remove = (database: Database, username: string) => removeUser(database, ['shares', 'trees'], username)

async function store(record: ShareRecord, blob: Blob) {
  const database = await db()
  const transaction = database.transaction(['shares', 'trees'], 'readwrite')
  await Promise.all([
    transaction.objectStore('shares').put(record),
    transaction.objectStore('trees').put(blob, record.username),
    transaction.done,
  ])
  await evict(database)
}

const announce = (username: string) => announceChange({ type: 'share', username })

// Packing takes longer than building the tree, so a browsed share shows before it's stored.
async function packAndStore(username: string, raw: RawShare, ready: Ready) {
  const signal = sessionSignal()
  const { share, fetchedAt } = ready
  try {
    const blob = await packShare(raw)
    await store(
      {
        username,
        fetchedAt,
        openedAt: fetchedAt,
        folders: share.folderCount,
        files: share.top.fileCount,
        locked: share.top.lockedCount,
        size: share.top.size,
        bytes: blob.size,
      },
      blob,
    )
    announce(username)
  } catch (error) {
    if (!signal.aborted && loadedShares.get().get(username) === ready) {
      setLoaded(username, { ...ready, notCached: error })
    }
  }
  void loadShareList()
}

// Another tab stored or deleted a share, so a copy here that came from the old cache is dropped and read again.
async function resync(username: string) {
  await loadShareList()
  const loaded = loadedShares.get().get(username)
  if (loaded === undefined || browses.get().has(username)) return
  if (loaded.status === 'ready') {
    if (loaded.notCached !== undefined) return
    if (shareList.get().records.get(username)?.fetchedAt === loaded.fetchedAt) return
  }
  setLoaded(username, undefined)
  if (viewing.has(username)) void readShare(username)
}

onAnnounce('share', (username) => void resync(username))

export async function deleteShare(username: string) {
  try {
    await remove(await db(), username)
  } catch {
    // The list below shows whether it's gone.
  }
  shareDownloads.forget(username)
  setLoaded(username, viewing.has(username) ? { status: 'missing' } : undefined)
  await loadShareList()
  announce(username)
}

type Phase =
  | { phase: 'waiting' }
  | { phase: 'receiving'; transferred: number; total: number }
  | { phase: 'loading'; loaded: number }
  | { phase: 'processing' }

export type Browse = Phase & { startedAt: number }

export const browses = createAtom<ReadonlyMap<string, Browse>>(new Map())

export type Failure = { status: 'failed'; message: string; at: number }

export const failures = createAtom<ReadonlyMap<string, Failure>>(new Map())

export const dismissFailure = (username: string) => failures.set((current) => without(current, username))

export type RawProgress = { bytesTransferred: number; size: number; percentComplete: number }

const statusPollInterval = 500

async function readStatus(username: string, signal: AbortSignal) {
  try {
    return await api.get(`users/${encodeURIComponent(username)}/browse/status`, { signal }).json<RawProgress>()
  } catch (error) {
    if (isHTTPError(error) && error.response.status === 404) return undefined
    throw error
  }
}

const sameStatus = (a: RawProgress | undefined, b: RawProgress | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.bytesTransferred === b.bytesTransferred &&
  a.size === b.size &&
  a.percentComplete === b.percentComplete

const running = new Map<string, Promise<Ready | Failure | undefined>>()

// slskd can't cancel a browse, and two of the same user at once can cross their results, so asking while one runs
// joins it. The outcome is undefined once the session has ended.
export function browse(username: string) {
  let outcome = running.get(username)
  if (outcome === undefined || !browses.get().has(username)) {
    const started = fetchShare(username)
    void started.finally(() => {
      if (running.get(username) === started) running.delete(username)
    })
    running.set(username, (outcome = started))
  }
  return outcome
}

async function fetchShare(username: string): Promise<Ready | Failure | undefined> {
  const signal = sessionSignal()
  const startedAt = Date.now()
  const set = (phase: Phase) => {
    if (!signal.aborted) browses.set((current) => new Map(current).set(username, { ...phase, startedAt }))
  }
  dismissFailure(username)
  set({ phase: 'waiting' })
  let arrived = false
  try {
    // A failed browse leaves its last status behind until the next one reports.
    let stale = await readStatus(username, signal).catch(() => undefined)
    void (async () => {
      let transferred = 0
      // oxlint-disable-next-line no-unmodified-loop-condition -- set once the browse response arrives
      while (!arrived && !signal.aborted) {
        await sleep(statusPollInterval)
        const status = await readStatus(username, signal).catch(() => undefined)
        if (arrived || status === undefined || sameStatus(status, stale)) continue
        stale = undefined
        transferred = Math.max(transferred, status.bytesTransferred)
        set({ phase: 'receiving', transferred, total: status.size })
      }
    })()
    let reported = 0
    const response = await api.get(`users/${encodeURIComponent(username)}/browse`, {
      signal,
      timeout: false,
      onDownloadProgress: ({ transferredBytes }) => {
        if (performance.now() - reported < 100) return
        reported = performance.now()
        set({ phase: 'loading', loaded: transferredBytes })
      },
    })
    arrived = true
    set({ phase: 'loading', loaded: 0 })
    // A big share's JSON can be longer than V8's longest string (see the facts), so it's parsed as it streams in.
    const raw = (await parseFromWebStream(response.body!)) as RawShare
    set({ phase: 'processing' })
    const share = await build(username, raw)
    if (signal.aborted) return undefined
    const ready: Ready = { status: 'ready', share, fetchedAt: Date.now() }
    setLoaded(username, ready)
    shareDownloads.get(username).set((state) => ({ ...state, marks: new Map() }))
    void packAndStore(username, raw, ready)
    return ready
  } catch (error) {
    if (signal.aborted) return undefined
    const failure: Failure = { status: 'failed', message: describePeerError(error), at: Date.now() }
    failures.set((current) => new Map(current).set(username, failure))
    return failure
  } finally {
    arrived = true
    if (!signal.aborted) browses.set((current) => without(current, username))
  }
}

// Asking for a user is the gesture: a cached share just opens, and anything else is browsed.
export async function browseIfMissing(username: string) {
  if (browses.get().has(username) || loadedShares.get().get(username)?.status === 'ready') return
  try {
    if ((await (await db()).getKey('shares', username)) !== undefined) return
  } catch {
    // Without a cache there's nothing to open instead.
  }
  void browse(username)
}

export const shareDownloads = createDownloads()

export const downloadFiles = (username: string, share: Tree, base: Folder, files: TreeFile[]) =>
  enqueueDownloads(
    shareDownloads.get(username),
    [...Map.groupBy(files, (file) => file.folder)].map(([folder, batch]) => ({
      username,
      label: folder.name,
      files: batch,
      destination: destinationOf(relativePath(share, base.parent ?? base, folder).split(share.separator)),
    })),
  )
