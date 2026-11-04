import { api, describeError } from '../lib/api'
import {
  announce,
  createRecordList,
  type Database,
  db,
  onAnnounce,
  type Presence,
  removeUser,
  type UserRecord,
} from '../lib/db'
import { sessionSignal } from '../lib/session'
import { createAtom, createResource, createKeyed, load, without } from '../lib/store'
import { describePeerError } from '../soulseek/soulseek'

export type RawStatus = { presence: Presence; isPrivileged: boolean }

export type RawEndpoint = { address: string; port: number }

export type RawInfo = {
  description: string
  hasFreeUploadSlot: boolean
  picture?: string
  queueLength: number
  uploadSlots: number
}

export const lookedUpAt = (record: UserRecord) => Math.max(record.status?.fetchedAt ?? 0, record.info?.fetchedAt ?? 0)

const kept = 100

const { list: userList, load: loadUserList, useList } = createRecordList('users')

export const useUserList = useList

// A picture that's been read, or null for none.
export const pictures = createAtom<ReadonlyMap<string, string | null>>(new Map())

export async function loadPicture(username: string) {
  if (pictures.get().has(username)) return
  const signal = sessionSignal()
  let picture: string | undefined
  try {
    picture = await (await db()).get('pictures', username)
  } catch {
    // Shown as no picture.
  }
  if (!signal.aborted) pictures.set((current) => new Map(current).set(username, picture ?? null))
}

export const lookups = createAtom<ReadonlyMap<string, number>>(new Map())

export type LookupErrors = { status?: string; info?: string; notStored?: string; at: number }

export const lookupErrors = createAtom<ReadonlyMap<string, LookupErrors>>(new Map())

export const dismissLookupErrors = (username: string) => lookupErrors.set((current) => without(current, username))

const remove = (database: Database, username: string) => removeUser(database, ['users', 'pictures'], username)

async function evict(database: Database) {
  const records = await database.getAll('users')
  const oldest = records.sort((a, b) => lookedUpAt(b) - lookedUpAt(a)).slice(kept)
  for (const record of oldest) await remove(database, record.username)
}

// A part that failed keeps what the last lookup found.
async function store(fresh: UserRecord, picture: string | null | undefined) {
  const database = await db()
  const transaction = database.transaction(['users', 'pictures'], 'readwrite')
  const users = transaction.objectStore('users')
  const pictureStore = transaction.objectStore('pictures')
  const write = async () => {
    await users.put({ ...(await users.get(fresh.username)), ...fresh })
    if (picture === null) await pictureStore.delete(fresh.username)
    else if (picture !== undefined) await pictureStore.put(picture, fresh.username)
  }
  await Promise.all([write(), transaction.done])
  await evict(database)
}

export async function lookUp(username: string) {
  if (lookups.get().has(username)) return
  const signal = sessionSignal()
  lookups.set((current) => new Map(current).set(username, Date.now()))
  dismissLookupErrors(username)
  try {
    const path = `users/${encodeURIComponent(username)}`
    const [status, endpoint, info] = await Promise.allSettled([
      api.get(`${path}/status`, { signal }).json<RawStatus>(),
      api.get(`${path}/endpoint`, { signal }).json<RawEndpoint>(),
      api.get(`${path}/info`, { signal }).json<RawInfo>(),
    ])
    if (signal.aborted) return
    const now = Date.now()
    const fresh: UserRecord = { username }
    const errors: LookupErrors = { at: now }
    if (status.status === 'fulfilled') {
      fresh.status = {
        presence: status.value.presence,
        privileged: status.value.isPrivileged,
        fetchedAt: now,
      }
      if (endpoint.status === 'fulfilled') fresh.status.address = `${endpoint.value.address}:${endpoint.value.port}`
    } else errors.status = describePeerError(status.reason)
    let picture: string | null | undefined
    if (info.status === 'fulfilled') {
      picture = info.value.picture || null
      fresh.info = {
        description: info.value.description,
        hasPicture: picture !== null,
        freeSlot: info.value.hasFreeUploadSlot,
        slots: info.value.uploadSlots,
        queue: info.value.queueLength,
        fetchedAt: now,
      }
    } else errors.info = describePeerError(info.reason)
    if (fresh.status !== undefined || fresh.info !== undefined) {
      try {
        await store(fresh, picture)
        announce({ type: 'user', username })
        await loadUserList()
      } catch (error) {
        errors.notStored = describeError(error)
        userList.set((current) => {
          const previous = current.records.get(username)
          return { ...current, records: new Map(current.records).set(username, { ...previous, ...fresh }) }
        })
      }
    }
    if (signal.aborted) return
    transferHistory.get(username).refresh()
    if (picture !== undefined) pictures.set((current) => new Map(current).set(username, picture))
    if (errors.status !== undefined || errors.info !== undefined || errors.notStored !== undefined) {
      lookupErrors.set((current) => new Map(current).set(username, errors))
    }
  } finally {
    if (!signal.aborted) lookups.set((current) => without(current, username))
  }
}

export async function deleteUser(username: string) {
  try {
    await remove(await db(), username)
  } catch {
    // The list below shows whether it's gone.
  }
  pictures.set((current) => without(current, username))
  dismissLookupErrors(username)
  await loadUserList()
  announce({ type: 'user', username })
}

onAnnounce('user', (username) => {
  pictures.set((current) => without(current, username))
  void loadUserList()
})

export type RawDirection = {
  summary: Partial<Record<string, { totalBytes: number }>>
  statistics: { total: number; successful: number; cancelled: number }
  exceptions: { exception?: string; count: number }[]
}

type Reason = { exception?: string; count: number }

export type DirectionHistory = {
  total: number
  succeeded: number
  failed: number
  cancelled: number
  bytes: number
  reasons: readonly Reason[]
}

type History = { download: DirectionHistory; upload: DirectionHistory }

// slskd's own errored count takes four exact states, so failed is whatever else didn't succeed.
const toDirectionHistory = (raw: RawDirection): DirectionHistory => ({
  total: raw.statistics.total,
  succeeded: raw.statistics.successful,
  failed: raw.statistics.total - raw.statistics.successful - raw.statistics.cancelled,
  cancelled: raw.statistics.cancelled,
  bytes: raw.summary.Succeeded?.totalBytes ?? 0,
  reasons: raw.exceptions,
})

// Read from slskd's own database, so it loads with the page rather than on a gesture.
export const transferHistory = createKeyed((username: string) =>
  createResource<History>((sink) =>
    load(sink, async (signal) => {
      const raw = await api
        .get(`telemetry/reports/transfers/users/${encodeURIComponent(username)}`, { signal })
        .json<{ Download: RawDirection; Upload: RawDirection }>()
      return { download: toDirectionHistory(raw.Download), upload: toDirectionHistory(raw.Upload) }
    }),
  ),
)
