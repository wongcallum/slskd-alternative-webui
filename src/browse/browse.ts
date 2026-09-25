import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import { isHTTPError } from 'ky'

import { api, describeError, sleep } from '../lib/api'
import { createAtom } from '../lib/store'
import { sessionSignal } from '../session/session'
import { createDownloads, enqueueDownloads } from '../transfers/enqueue'
import { buildShare, type Folder, type RawShare, relativePath, type Share, type ShareFile } from './shareTree'

export type ShareRecord = {
  username: string
  fetchedAt: number
  openedAt: number
  folders: number
  files: number
  locked: number
  size: number
  bytes: number
}

interface Schema extends DBSchema {
  shares: { key: string; value: ShareRecord }
  trees: { key: string; value: Blob }
}

let opening: Promise<IDBPDatabase<Schema>> | undefined

// Parsing, building and the first render are separate tasks, so the page can paint between them.
async function parseShare(username: string, blob: Blob) {
  const raw = JSON.parse(await blob.text()) as RawShare
  await sleep(0)
  const share = buildShare(username, raw)
  await sleep(0)
  return share
}

const db = () =>
  (opening ??= openDB<Schema>('slskd-alt', 1, {
    upgrade(database) {
      database.createObjectStore('shares', { keyPath: 'username' })
      database.createObjectStore('trees')
    },
  }))

const capacity = 2 ** 30

export type ShareList = { loaded: boolean; records: ReadonlyMap<string, ShareRecord>; error?: unknown }

export const shareList = createAtom<ShareList>({ loaded: false, records: new Map() })

export async function loadShareList() {
  const signal = sessionSignal()
  try {
    const records = await (await db()).getAll('shares')
    if (!signal.aborted) shareList.set({ loaded: true, records: new Map(records.map((each) => [each.username, each])) })
  } catch (error) {
    if (!signal.aborted) shareList.set((current) => ({ ...current, loaded: true, error }))
  }
}

export type Loaded =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed'; error: unknown }
  | { status: 'ready'; share: Share; fetchedAt: number; notCached?: string }

export const loadedShares = createAtom<ReadonlyMap<string, Loaded>>(new Map())

const kept = 2

const viewing = new Map<string, number>()

const without = <V>(map: ReadonlyMap<string, V>, key: string) => {
  const next = new Map(map)
  next.delete(key)
  return next
}

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

async function readShare(username: string) {
  const signal = sessionSignal()
  setLoaded(username, { status: 'loading' })
  try {
    const database = await db()
    const [record, blob] = await Promise.all([database.get('shares', username), database.get('trees', username)])
    if (signal.aborted) return
    if (record === undefined || blob === undefined) {
      setLoaded(username, { status: 'missing' })
      return
    }
    const share = await parseShare(username, blob)
    if (!signal.aborted) setLoaded(username, { status: 'ready', share, fetchedAt: record.fetchedAt })
  } catch (error) {
    if (!signal.aborted) setLoaded(username, { status: 'failed', error })
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

async function touch(username: string) {
  try {
    const database = await db()
    const record = await database.get('shares', username)
    if (record !== undefined) await database.put('shares', { ...record, openedAt: Date.now() })
  } catch {
    // Recency only orders eviction.
  }
}

async function evict(database: IDBPDatabase<Schema>) {
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

async function remove(database: IDBPDatabase<Schema>, username: string) {
  const transaction = database.transaction(['shares', 'trees'], 'readwrite')
  await Promise.all([
    transaction.objectStore('shares').delete(username),
    transaction.objectStore('trees').delete(username),
    transaction.done,
  ])
}

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

const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('slskd-alt')

type Message = { type: 'share'; username: string }

// oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no target origin
const announce = (username: string) => channel?.postMessage({ type: 'share', username } satisfies Message)

// Another tab stored or deleted a share, so a copy here that came from the old cache is dropped and read again.
async function resync(username: string) {
  await loadShareList()
  const loaded = loadedShares.get().get(username)
  if (loaded === undefined || loaded.status === 'loading' || browses.get().has(username)) return
  if (loaded.status === 'ready') {
    if (loaded.notCached !== undefined) return
    if (shareList.get().records.get(username)?.fetchedAt === loaded.fetchedAt) return
  }
  setLoaded(username, undefined)
  if (viewing.has(username)) void readShare(username)
}

channel?.addEventListener('message', (event: MessageEvent<Message>) => {
  if (event.data.type === 'share') void resync(event.data.username)
})

export async function deleteShare(username: string) {
  try {
    await remove(await db(), username)
  } catch {
    // The list below shows whether it's gone.
  }
  setLoaded(username, viewing.has(username) ? { status: 'missing' } : undefined)
  await loadShareList()
  announce(username)
}

export type Phase =
  | { phase: 'waiting' }
  | { phase: 'receiving'; transferred: number; total: number }
  | { phase: 'loading'; loaded: number }
  | { phase: 'processing' }

export type Browse = Phase & { startedAt: number }

export const browses = createAtom<ReadonlyMap<string, Browse>>(new Map())

export type Failure = { error: string; at: number }

export const failures = createAtom<ReadonlyMap<string, Failure>>(new Map())

export const dismissFailure = (username: string) => failures.set((current) => without(current, username))

type Status = { bytesTransferred: number; size: number; percentComplete: number }

const statusPollInterval = 500

async function readStatus(username: string, signal: AbortSignal) {
  try {
    return await api.get(`users/${encodeURIComponent(username)}/browse/status`, { signal }).json<Status>()
  } catch (error) {
    if (isHTTPError(error) && error.response.status === 404) return undefined
    throw error
  }
}

const sameStatus = (a: Status | undefined, b: Status | undefined) =>
  a !== undefined &&
  b !== undefined &&
  a.bytesTransferred === b.bytesTransferred &&
  a.size === b.size &&
  a.percentComplete === b.percentComplete

function describeBrowseError(username: string, error: unknown) {
  if (isHTTPError(error)) {
    const message = typeof error.data === 'string' ? error.data : ''
    if (error.response.status === 404) {
      return message === '' ? `${username} is on your blacklist` : `${username} appears to be offline`
    }
    if (message.includes('timed out after 60000 milliseconds')) return `${username} didn't respond within 60 s`
  }
  return describeError(error)
}

// slskd can't cancel a browse, and two of the same user at once can cross their results.
export async function browse(username: string) {
  if (browses.get().has(username)) return
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
    const blob = await response.blob()
    set({ phase: 'processing' })
    const share = await parseShare(username, blob)
    if (signal.aborted) return
    const now = Date.now()
    const record: ShareRecord = {
      username,
      fetchedAt: now,
      openedAt: now,
      folders: share.folderCount,
      files: share.top.fileCount,
      locked: share.top.lockedCount,
      size: share.top.size,
      bytes: blob.size,
    }
    let notCached: string | undefined
    try {
      await store(record, blob)
    } catch (error) {
      notCached = describeError(error)
    }
    if (signal.aborted) return
    setLoaded(username, { status: 'ready', share, fetchedAt: now, notCached })
    shareDownloadsOf(username).set((state) => ({ ...state, marks: new Map() }))
    void loadShareList()
    if (notCached === undefined) announce(username)
  } catch (error) {
    if (!signal.aborted) {
      failures.set((current) =>
        new Map(current).set(username, { error: describeBrowseError(username, error), at: Date.now() }),
      )
    }
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

export const shareDownloadsOf = createDownloads()

// slskd puts every file of a batch in one folder, so each remote folder gets its own batch to keep the tree, rooted
// at the folder the download started from.
function destinationOf(share: Share, base: Folder, folder: Folder) {
  const path = relativePath(share, base.parent ?? base, folder)
  return path
    .split(share.separator)
    .filter((segment) => segment !== '')
    .join('/')
}

export const downloadFiles = (share: Share, base: Folder, files: ShareFile[]) =>
  enqueueDownloads(
    shareDownloadsOf(share.username),
    [...Map.groupBy(files, (file) => file.folder)].map(([folder, batch]) => ({
      username: share.username,
      label: folder.name,
      files: batch,
      destination: destinationOf(share, base, folder) || undefined,
    })),
  )
