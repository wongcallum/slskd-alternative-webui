import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import type { ShareRecord } from '../browse/browse'
import { sessionSignal } from '../session/session'
import type { UserRecord } from '../users/users'
import { createAtom } from './store'

interface Schema extends DBSchema {
  shares: { key: string; value: ShareRecord }
  trees: { key: string; value: Blob }
  users: { key: string; value: UserRecord }
  pictures: { key: string; value: string }
}

export type Database = IDBPDatabase<Schema>

let opening: Promise<Database> | undefined

export const db = () =>
  (opening ??= openDB<Schema>('slskd-alt', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('shares', { keyPath: 'username' })
        database.createObjectStore('trees')
      }
      database.createObjectStore('users', { keyPath: 'username' })
      database.createObjectStore('pictures')
    },
    // A tab on a newer build is waiting to upgrade, and would wait until this one closed.
    blocking(_current, _blocked, event) {
      const database = event.target as IDBDatabase
      database.close()
      opening = undefined
    },
  }))

type Change = { type: 'share' | 'user'; username: string }

const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('slskd-alt')

// oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no target origin
export const announce = (change: Change) => channel?.postMessage(change)

// Another tab stored or deleted something.
export function onAnnounce(type: Change['type'], listener: (username: string) => void) {
  channel?.addEventListener('message', (event: MessageEvent<Change>) => {
    if (event.data.type === type) listener(event.data.username)
  })
}

export type RecordList<T> = { loaded: boolean; records: ReadonlyMap<string, T>; error?: unknown }

// A store's small per-user records, which a landing page reads all of.
export function createRecordList<S extends 'shares' | 'users'>(store: S) {
  const list = createAtom<RecordList<Schema[S]['value']>>({ loaded: false, records: new Map() })
  async function load() {
    const signal = sessionSignal()
    try {
      const records = await (await db()).getAll(store)
      if (!signal.aborted) list.set({ loaded: true, records: new Map(records.map((each) => [each.username, each])) })
    } catch (error) {
      if (!signal.aborted) list.set((current) => ({ ...current, loaded: true, error }))
    }
  }
  return { list, load }
}

// A landing page's entries, one per user, from the stored records and whatever else knows of them.
export function entriesByUser<E extends { username: string }>(fill: (entryOf: (username: string) => E) => void) {
  const byUser = new Map<string, E>()
  fill((username) => {
    let entry = byUser.get(username)
    if (entry === undefined) byUser.set(username, (entry = { username } as E))
    return entry
  })
  return [...byUser.values()]
}
