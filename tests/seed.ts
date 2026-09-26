import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { Instance } from './slskd'

// Transfers can't be made without a Soulseek login, so tests write them into slskd's database, which it reads on every
// request. The flags are Soulseek.NET's TransferStates, which slskd stores as a number and serialises as names.
const flags = {
  Requested: 1,
  Queued: 2,
  Initializing: 4,
  InProgress: 8,
  Completed: 16,
  Succeeded: 32,
  Cancelled: 64,
  TimedOut: 128,
  Errored: 256,
  Rejected: 512,
  Aborted: 1024,
  Locally: 2048,
  Remotely: 4096,
}

export const states = [
  'Requested',
  'Queued, Locally',
  'Queued, Remotely',
  'Initializing',
  'InProgress',
  'Completed, Succeeded',
  'Completed, Cancelled',
  'Completed, TimedOut',
  'Completed, Errored',
  'Completed, Rejected',
  'Completed, Aborted',
] as const

export type State = (typeof states)[number]

export type SeedTransfer = {
  direction?: 'Download' | 'Upload'
  username: string
  filename: string
  size?: number
  state: State
  bytesTransferred?: number
  exception?: string
  batchId?: string
}

export type SeedBatch = { username: string; searchId?: string; destination?: string }

const stateValue = (state: State) => state.split(', ').reduce((sum, flag) => sum + flags[flag as keyof typeof flags], 0)

// EF Core's format for a DateTime in SQLite.
const timestamp = (date = new Date()) => date.toISOString().replace('T', ' ').replace('Z', '')

function withDatabase<T>(instance: Instance, work: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(path.join(instance.appDir, 'data/transfers.db'))
  try {
    return work(db)
  } finally {
    db.close()
  }
}

export const seedBatch = (instance: Instance, batch: SeedBatch) =>
  withDatabase(instance, (db) => {
    const id = randomUUID().toUpperCase()
    db.prepare(
      'INSERT INTO Batches (Id, SearchId, Username, Direction, CreatedAt, Options) VALUES (?, ?, ?, 0, ?, ?)',
    ).run(
      id,
      batch.searchId?.toUpperCase() ?? null,
      batch.username,
      timestamp(),
      JSON.stringify(batch.destination === undefined ? {} : { destination: batch.destination }),
    )
    return id
  })

export const seedTransfers = (instance: Instance, transfers: SeedTransfer[]) =>
  withDatabase(instance, (db) => {
    const insert = db.prepare(
      `INSERT INTO Transfers (Id, BatchId, Username, Direction, Filename, Size, State, StateDescription, RequestedAt,
        EnqueuedAt, StartedAt, EndedAt, BytesTransferred, AverageSpeed, Exception, Attempts, Removed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    return transfers.map((transfer) => {
      const id = randomUUID().toUpperCase()
      const size = transfer.size ?? 1000
      const bytes = transfer.bytesTransferred ?? (transfer.state === 'Completed, Succeeded' ? size : 0)
      const finished = transfer.state.startsWith('Completed')
      const started = transfer.state === 'InProgress' || finished
      // slskd records why every transfer that ended without succeeding ended.
      const failed = finished && transfer.state !== 'Completed, Succeeded'
      insert.run(
        id,
        transfer.batchId ?? null,
        transfer.username,
        transfer.direction ?? 'Download',
        transfer.filename,
        size,
        stateValue(transfer.state),
        transfer.state,
        timestamp(),
        transfer.state === 'Requested' ? null : timestamp(),
        started ? timestamp() : null,
        finished ? timestamp() : null,
        bytes,
        started ? 1000 : 0,
        transfer.exception ?? (failed ? `${transfer.state} in a test` : null),
        transfer.direction === 'Upload' ? 0 : 1,
      )
      return id.toLowerCase()
    })
  })
