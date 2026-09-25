import { api } from '../lib/api'
import { followHub, logsHub, useLive, type Via } from '../lib/hubs'
import { createResource, useResource } from '../lib/store'
import { parseQuery } from '../lib/text'

// GET /logs omits a null subContext, while the hub keeps it.
type RawLog = { timestamp: string; context: string; subContext?: string | null; level: Level; message: string }

const levels = ['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal'] as const

export type Level = (typeof levels)[number]

export const minimumLevels = ['debug', 'info', 'warning', 'error'] as const

export type MinimumLevel = (typeof minimumLevels)[number]

const minimumRank: Record<MinimumLevel, number> = { debug: 0, info: 2, warning: 3, error: 4 }

export type LogRecord = {
  id: number
  key: string
  time: number
  level: Level
  context: string
  subContext?: string
  message: string
  firstLine: string
  moreLines: number
  search: string
}

export type Logs = { via: Via; records: LogRecord[] }

export const logPollInterval = 2000

export const maxRecords = 1000

// slskd pushes each record on its own, dozens a second when busy.
const pushBatchDelay = 250

let nextId = 0

function toRecord(raw: RawLog, key: string): LogRecord {
  const subContext = raw.subContext ?? undefined
  const lines = raw.message.split('\n')
  return {
    id: nextId++,
    key,
    time: Date.parse(raw.timestamp),
    level: raw.level,
    context: raw.context,
    subContext,
    message: raw.message,
    firstLine: lines[0] ?? '',
    moreLines: lines.length - 1,
    search: `${raw.context} ${subContext ?? ''} ${raw.message}`.toLowerCase(),
  }
}

const byNewest = (a: LogRecord, b: LogRecord) => b.time - a.time || b.id - a.id

// Every buffer overlaps what's held, and a record logged while the hub connects can arrive both buffered and pushed.
function merge(via: Via, raws: RawLog[]): Logs {
  const held = logs.getSnapshot().data?.records ?? []
  const known = new Set(held.map((record) => record.key))
  const added: LogRecord[] = []
  for (const raw of raws) {
    const key = `${raw.timestamp} ${raw.message}`
    if (known.has(key)) continue
    known.add(key)
    added.push(toRecord(raw, key))
  }
  if (added.length === 0) return { via, records: held }
  return { via, records: [...added, ...held].sort(byNewest).slice(0, maxRecords) }
}

export const logs = createResource<Logs>((sink) => {
  let pending: RawLog[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush(raws: RawLog[] = []) {
    clearTimeout(timer)
    timer = undefined
    const batch = pending.concat(raws)
    pending = []
    sink.set(merge('hub', batch))
  }

  const offs = [
    logsHub.on<RawLog[]>('BUFFER', flush),
    logsHub.on<RawLog>('LOG', (raw) => {
      pending.push(raw)
      timer ??= setTimeout(flush, pushBatchDelay)
    }),
  ]
  const following = followHub(logsHub, sink, {
    snapshot: async (signal) => merge('hub', await api.get('logs', { signal }).json<RawLog[]>()),
    request: async (signal, measure) => {
      const text = await api.get('logs', { signal }).text()
      return measure(() => merge('poll', JSON.parse(text) as RawLog[]))
    },
    interval: logPollInterval,
  })
  return {
    stop() {
      following.stop()
      for (const off of offs) off()
      if (pending.length > 0) flush()
    },
    refresh: following.refresh,
  }
})

export function useLogs() {
  const { data, error } = useResource(logs)
  return { data, error, ...useLive(data?.via, logsHub, logs, logPollInterval) }
}

export function logMatcher(minimum: MinimumLevel, query: string) {
  const rank = minimumRank[minimum]
  const { include, exclude } = parseQuery(query)
  if (rank === 0 && include.length + exclude.length === 0) return undefined
  return (record: LogRecord) =>
    levels.indexOf(record.level) >= rank &&
    include.every((term) => record.search.includes(term)) &&
    !exclude.some((term) => record.search.includes(term))
}
