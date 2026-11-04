import * as v from 'valibot'

import type { RawProgress } from '../../src/browse/browse'
import type { RawShare as RawBrowse } from '../../src/browse/pack'
import type { RawConversation, RawPrivateMessage } from '../../src/chat/conversations'
import type { RawAvailableRoom } from '../../src/chat/JoinRoomDialog'
import type { RawRoomMessage, RawRoomUser } from '../../src/chat/rooms'
import type { RawFolder, RawHistogram, RawLeader, RawReason, RawSummary } from '../../src/dashboard/reports'
import type { RawState } from '../../src/lib/application'
import type { RawDirectory } from '../../src/lib/files'
import type { RawResponse } from '../../src/search/results/results'
import type { RawSearch } from '../../src/search/searches'
import type { RawEvent } from '../../src/system/events'
import type { RawListing } from '../../src/system/files/files'
import type { RawLog } from '../../src/system/logs'
import type { RawOptions } from '../../src/system/options/options'
import type { Metrics } from '../../src/system/process'
import type { RawShare } from '../../src/system/shares/shares'
import type { BatchInfo } from '../../src/transfers/actions'
import type { EnqueueResponse } from '../../src/transfers/enqueue'
import type { RawMetrics } from '../../src/transfers/metrics'
import type { RawUser } from '../../src/transfers/transfers'
import type { RawDirection, RawEndpoint, RawInfo, RawStatus } from '../../src/users/users'

// Each schema must produce the type the app reads that payload as, so a payload that passes is one the app can read.
const shape = <T>(schema: v.GenericSchema<unknown, T>) => schema

export const parse = <T>(schema: v.GenericSchema<unknown, T>, value: unknown) => {
  const result = v.safeParse(schema, value)
  if (result.success) return result.output
  const shown = value === undefined ? 'undefined' : JSON.stringify(value, null, 2).slice(0, 2000)
  throw new Error(`Unexpected payload: ${v.summarize(result.issues)}\n${shown}`)
}

// The app reads a timestamp without an offset as UTC. slskd runs hours from UTC (see slskd.ts), so a local time would be
// hours from now, while everything the tests see happened within minutes.
const utc = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z?$/),
  v.check(
    (text) => Math.abs(Date.parse(text.replace(/Z?$/, 'Z')) - Date.now()) < 60 * 60 * 1000,
    'Not within an hour of now, so not UTC',
  ),
)

const withOffset = v.pipe(v.string(), v.regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/))

const count = v.pipe(v.number(), v.integer(), v.minValue(0))

// Soulseek.NET's TransferStates, which slskd stores as a number and serialises by their flags.
const states = [
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

export const state = shape<RawState>(
  v.object({
    version: v.object({
      current: v.string(),
      full: v.string(),
      latest: v.nullish(v.string()),
      isUpdateAvailable: v.nullish(v.boolean()),
      isCanary: v.boolean(),
      isDevelopment: v.boolean(),
    }),
    pendingReconnect: v.boolean(),
    pendingRestart: v.boolean(),
    server: v.object({
      address: v.nullish(v.string()),
      state: v.string(),
      isConnected: v.boolean(),
      isLoggedIn: v.boolean(),
      isTransitioning: v.boolean(),
    }),
    connectionWatchdog: v.object({
      isAttemptingConnection: v.boolean(),
      isAwaitingVpn: v.optional(v.boolean()),
      nextAttemptAt: v.nullish(utc),
    }),
    vpn: v.optional(
      v.object({
        isConnected: v.boolean(),
        publicIPAddress: v.nullish(v.string()),
        location: v.nullish(v.string()),
        forwardedPort: v.nullish(count),
      }),
    ),
    relay: v.object({
      mode: v.picklist(['Controller', 'Agent', 'Debug']),
      controller: v.object({
        address: v.nullish(v.string()),
        state: v.picklist(['Disconnected', 'Connecting', 'Connected', 'Reconnecting']),
      }),
      agents: v.array(v.object({ name: v.string(), ipAddress: v.string() })),
    }),
    health: v.object({
      search: v.object({ incoming: v.object({ latency: v.number(), queueDepth: v.number(), dropRate: v.number() }) }),
    }),
    user: v.object({
      username: v.nullish(v.string()),
      privileges: v.object({ privilegesRemaining: v.number() }),
      statistics: v.object({
        averageSpeed: v.number(),
        directoryCount: v.number(),
        fileCount: v.number(),
        uploadCount: v.number(),
      }),
    }),
    distributedNetwork: v.object({
      branchLevel: v.number(),
      branchRoot: v.nullish(v.string()),
      canAcceptChildren: v.boolean(),
      childLimit: v.number(),
      children: v.array(v.unknown()),
      parent: v.nullish(v.string()),
    }),
    shares: v.object({
      scanPending: v.boolean(),
      scanning: v.boolean(),
      ready: v.boolean(),
      faulted: v.boolean(),
      cancelled: v.boolean(),
      scanProgress: v.number(),
      directories: count,
      files: count,
    }),
    rooms: v.array(v.string()),
  }),
)

export const options = shape<RawOptions>(
  v.object({
    remoteConfiguration: v.boolean(),
    remoteFileManagement: v.boolean(),
    directories: v.object({ downloads: v.string(), incomplete: v.string() }),
    shares: v.object({ directories: v.array(v.string()), filters: v.array(v.string()) }),
    relay: v.object({ enabled: v.boolean() }),
    integrations: v.object({ vpn: v.optional(v.object({ enabled: v.boolean() })) }),
  }),
)

export const logs = shape<RawLog[]>(
  v.array(
    v.object({
      timestamp: withOffset,
      context: v.string(),
      subContext: v.nullish(v.string()),
      level: v.picklist(['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal']),
      message: v.string(),
    }),
  ),
)

export const events = shape<RawEvent[]>(
  v.array(v.object({ timestamp: utc, type: v.string(), data: v.string(), id: v.pipe(v.string(), v.uuid()) })),
)

const metric = v.object({
  samples: v.array(v.object({ value: v.number(), labels: v.optional(v.record(v.string(), v.string())) })),
})

export const processMetrics = shape<Metrics>(
  v.object({ process_start_time_seconds: metric, process_working_set_bytes: metric, dotnet_build_info: metric }),
)

const transferMetrics = v.object({
  inProgress: v.object({ files: v.number(), averageSpeed: v.number(), totalSpeed: v.number() }),
  queued: v.object({ files: v.number() }),
  completed: v.object({ succeeded: count, failed: count }),
})

export const metrics = shape<RawMetrics>(v.object({ downloads: transferMetrics, uploads: transferMetrics }))

const entry = v.object({
  name: v.string(),
  fullName: v.string(),
  attributes: v.string(),
  modifiedAt: utc,
  length: v.optional(v.number()),
})

export const listing = shape<RawListing>(
  v.object({ ...entry.entries, files: v.array(entry), directories: v.array(entry) }),
)

export const shares = shape<RawShare[]>(
  v.array(
    v.object({
      id: v.string(),
      alias: v.string(),
      isExcluded: v.boolean(),
      localPath: v.string(),
      directories: v.optional(count),
      files: v.optional(count),
    }),
  ),
)

const file = v.object({
  filename: v.string(),
  size: count,
  bitRate: v.optional(v.number()),
  bitDepth: v.optional(v.number()),
  sampleRate: v.optional(v.number()),
  length: v.optional(v.number()),
  isVariableBitRate: v.optional(v.boolean()),
})

export const directories = shape<RawDirectory[]>(v.array(v.object({ name: v.string(), files: v.array(file) })))

const transfer = v.object({
  id: v.pipe(v.string(), v.uuid()),
  batchId: v.optional(v.pipe(v.string(), v.uuid())),
  filename: v.string(),
  size: count,
  state: v.picklist(states),
  requestedAt: utc,
  enqueuedAt: v.optional(utc),
  startedAt: v.optional(utc),
  endedAt: v.optional(utc),
  bytesTransferred: count,
  averageSpeed: v.number(),
  placeInQueue: v.optional(count),
  exception: v.optional(v.string()),
  attempts: count,
})

export const transferUsers = shape<RawUser[]>(
  v.array(
    v.object({
      username: v.string(),
      directories: v.array(v.object({ directory: v.string(), files: v.array(transfer) })),
    }),
  ),
)

export const batch = shape<BatchInfo>(
  v.object({
    searchId: v.optional(v.pipe(v.string(), v.uuid())),
    options: v.optional(v.object({ destination: v.optional(v.string()) })),
  }),
)

export const search = shape<RawSearch>(
  v.object({
    id: v.pipe(v.string(), v.uuid()),
    searchText: v.string(),
    state: v.string(),
    isComplete: v.boolean(),
    startedAt: utc,
    endedAt: v.nullish(utc),
    responseCount: count,
    fileCount: count,
    lockedFileCount: count,
  }),
)

// Keyed by the final state without Completed, which is how the dashboard tells successes from failures.
const byState = v.record(
  v.picklist(['Succeeded', 'Cancelled', 'TimedOut', 'Errored', 'Rejected', 'Aborted']),
  v.object({ totalBytes: count, count, distinctUsers: count }),
)

const summaryShape = v.object({ Download: byState, Upload: byState })

export const summary = shape<RawSummary>(summaryShape)

// The dashboard parses each bucket's start as UTC.
export const histogram = shape<RawHistogram>(
  v.record(v.pipe(v.string(), v.regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)), summaryShape),
)

export const leaders = shape<RawLeader[]>(
  v.array(v.object({ username: v.string(), count, totalBytes: count, averageSpeed: v.number() })),
)

export const folders = shape<RawFolder[]>(v.array(v.object({ directory: v.string(), count, distinctUsers: count })))

export const reasons = shape<RawReason[]>(
  v.array(v.object({ exception: v.optional(v.string()), count, distinctUsers: count })),
)

const history = v.object({
  summary: byState,
  statistics: v.object({ total: count, successful: count, cancelled: count }),
  exceptions: v.array(v.object({ exception: v.string(), count })),
})

export const userHistory = shape<{ Download: RawDirection; Upload: RawDirection }>(
  v.object({ Download: history, Upload: history }),
)

export const enqueued = shape<
  EnqueueResponse & { batch: { id: string; transfers: { id: string; filename: string }[] } }
>(
  v.object({
    batch: v.object({
      id: v.pipe(v.string(), v.uuid()),
      transfers: v.array(v.object({ id: v.pipe(v.string(), v.uuid()), filename: v.string() })),
    }),
    failures: v.array(v.object({ filename: v.string(), message: v.string() })),
  }),
)

export const responses = shape<RawResponse[]>(
  v.array(
    v.object({
      username: v.string(),
      files: v.array(file),
      lockedFiles: v.array(file),
      hasFreeUploadSlot: v.boolean(),
      queueLength: count,
      uploadSpeed: count,
    }),
  ),
)

const directory = v.object({ name: v.string(), files: v.array(file) })

export const share = shape<RawBrowse>(
  v.object({ directories: v.array(directory), lockedDirectories: v.array(directory) }),
)

export const browseProgress = shape<RawProgress>(
  v.object({ bytesTransferred: count, size: count, percentComplete: v.number() }),
)

export const userInfo = shape<RawInfo>(
  v.object({
    description: v.string(),
    hasFreeUploadSlot: v.boolean(),
    picture: v.optional(v.string()),
    queueLength: count,
    uploadSlots: count,
  }),
)

export const userStatus = shape<RawStatus>(
  v.object({ presence: v.picklist(['Online', 'Away', 'Offline']), isPrivileged: v.boolean() }),
)

export const endpoint = shape<RawEndpoint>(v.object({ address: v.pipe(v.string(), v.ipv4()), port: count }))

export const conversations = shape<RawConversation[]>(
  v.array(v.object({ username: v.string(), unAcknowledgedMessageCount: count })),
)

const privateMessage = v.object({
  timestamp: utc,
  id: v.pipe(v.number(), v.integer()),
  username: v.string(),
  direction: v.picklist(['In', 'Out']),
  message: v.string(),
  isAcknowledged: v.boolean(),
})

export const privateMessages = shape<RawPrivateMessage[]>(v.array(privateMessage))

export const roomMessages = shape<RawRoomMessage[]>(
  v.array(v.object({ timestamp: utc, username: v.string(), message: v.string(), self: v.optional(v.boolean()) })),
)

export const roomUsers = shape<RawRoomUser[]>(
  v.array(
    v.object({
      username: v.string(),
      countryCode: v.nullish(v.string()),
      fileCount: count,
      self: v.optional(v.boolean()),
    }),
  ),
)

export const availableRooms = shape<RawAvailableRoom[]>(
  v.array(
    v.object({
      name: v.string(),
      userCount: count,
      isPrivate: v.boolean(),
      isOwned: v.boolean(),
      isModerated: v.boolean(),
    }),
  ),
)
