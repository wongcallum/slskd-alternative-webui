import { api } from '../lib/api'
import { toTime } from '../lib/format'
import { createAtom, createResource, type Measure, poll, type Sink } from '../lib/store'
import { queryMatcher } from '../lib/text'
import { sessionSignal } from '../session/session'

export type RawEvent = { timestamp: string; type: string; data: string; id: string }

// data is JSON inside the JSON, and only what the summaries read is typed.
type RawMessage = { username?: string; message?: string; roomName?: string; wasReplayed?: boolean }

type RawData = {
  message?: string | RawMessage
  username?: string
  remoteFilename?: string
  remoteDirectoryName?: string
  transfer?: { username?: string }
}

type Summary = { user?: string; room?: string; text?: string; replayed?: boolean }

export type EventRecord = {
  id: string
  // Increases for rows found at the top and decreases for older pages, so a held list can tell what's new.
  order: number
  time: number
  timestamp: string
  type: string
  data: unknown
  summary: Summary
  search: string
}

export type Events = {
  records: readonly EventRecord[]
  total: number
  // How far down slskd's list the held rows reach, which is where the next older page starts.
  bottom: number
  // Bumped whenever the held rows are thrown away for the newest page.
  generation: number
}

export const eventsPollInterval = 10_000

export const eventsPageSize = 100

const typeLabels: Record<string, string> = {
  DownloadFileComplete: 'File downloaded',
  DownloadDirectoryComplete: 'Folder downloaded',
  UploadFileComplete: 'File uploaded',
  PrivateMessageReceived: 'Private message',
  RoomMessageReceived: 'Room message',
  SoulseekClientConnected: 'Connected',
  SoulseekClientDisconnected: 'Disconnected',
  Noop: 'Test',
}

export const knownTypes = Object.keys(typeLabels)

export const typeLabel = (type: string) => typeLabels[type] ?? type

function summarise(type: string, data: RawData): Summary {
  const message = typeof data.message === 'object' ? data.message : undefined
  switch (type) {
    case 'SoulseekClientDisconnected':
      return { text: typeof data.message === 'string' ? data.message : undefined }
    case 'DownloadFileComplete':
    case 'UploadFileComplete':
      return { user: data.transfer?.username, text: data.remoteFilename }
    case 'DownloadDirectoryComplete':
      return { user: data.username, text: data.remoteDirectoryName }
    case 'PrivateMessageReceived':
      return { user: message?.username, text: message?.message, replayed: message?.wasReplayed === true }
    case 'RoomMessageReceived':
      return { user: message?.username, room: message?.roomName, text: message?.message }
    default:
      return {}
  }
}

function parseData(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

function toRecord(raw: RawEvent, order: number): EventRecord {
  const data = parseData(raw.data)
  const summary = summarise(raw.type, typeof data === 'object' && data !== null ? data : {})
  return {
    id: raw.id,
    order,
    time: toTime(raw.timestamp),
    timestamp: raw.timestamp,
    type: raw.type,
    data,
    summary,
    search: [typeLabel(raw.type), raw.type, summary.room, summary.user, summary.text].join(' ').toLowerCase(),
  }
}

const byNewest = (a: EventRecord, b: EventRecord) => b.time - a.time

let newest = 0
let oldest = 0

async function fetchPage(offset: number, signal: AbortSignal) {
  const response = await api.get('events', { searchParams: { offset, limit: eventsPageSize }, signal })
  return { total: Number(response.headers.get('X-Total-Count') ?? 0), text: await response.text() }
}

const current = () => events.getSnapshot().data

// A page that shares nothing with what's held left a gap, so the held rows go rather than hiding it.
async function fetchNewest(signal: AbortSignal, measure: Measure): Promise<Events> {
  const { total, text } = await fetchPage(0, signal)
  return measure(() => {
    const page = JSON.parse(text) as RawEvent[]
    const held = current()
    const known = new Set(held?.records.map((record) => record.id))
    if (held === undefined || (known.size > 0 && !page.some((raw) => known.has(raw.id)))) {
      const records = page.map((raw) => toRecord(raw, ++newest))
      return { records, total, bottom: records.length, generation: (held?.generation ?? 0) + 1 }
    }
    const added = page.filter((raw) => !known.has(raw.id)).map((raw) => toRecord(raw, ++newest))
    if (added.length === 0) return { ...held, total }
    return {
      records: [...added, ...held.records].sort(byNewest),
      total,
      bottom: held.bottom + added.length,
      generation: held.generation,
    }
  })
}

let active: Sink<Events> | undefined

export const events = createResource<Events>((sink) => {
  active = sink
  const polling = poll(sink, fetchNewest, eventsPollInterval)
  return {
    stop() {
      polling.stop()
      if (active === sink) active = undefined
    },
    refresh: polling.refresh,
  }
})

export const hasOlder = (data: Events) => data.bottom < data.total

export const olderLoad = createAtom<{ loading: boolean; error?: unknown }>({ loading: false })

// Rows that arrived at the top since the offset was read only make the page overlap what's held.
export async function loadOlder() {
  const start = current()
  if (start === undefined || olderLoad.get().loading || !hasOlder(start)) return
  const signal = sessionSignal()
  olderLoad.set({ loading: true })
  try {
    const { total, text } = await fetchPage(start.bottom, signal)
    const page = JSON.parse(text) as RawEvent[]
    const held = current()
    if (!signal.aborted) olderLoad.set({ loading: false })
    if (held === undefined || held.generation !== start.generation || active === undefined) return
    const known = new Set(held.records.map((record) => record.id))
    const added = page.filter((raw) => !known.has(raw.id)).map((raw) => toRecord(raw, --oldest))
    active.set({
      records: added.length === 0 ? held.records : [...held.records, ...added].sort(byNewest),
      total,
      bottom: Math.max(held.bottom, start.bottom + page.length),
      generation: held.generation,
    })
  } catch (error) {
    if (!signal.aborted) olderLoad.set({ loading: false, error })
  }
}

export function eventMatcher(query: string, hidden: ReadonlySet<string>) {
  const matches = queryMatcher(query)
  if (hidden.size === 0 && matches === undefined) return undefined
  return (record: EventRecord) => !hidden.has(record.type) && (matches?.(record.search) ?? true)
}
