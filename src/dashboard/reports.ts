import { api } from '../lib/api'
import { metricsHub } from '../lib/hubs'
import { createResource, createResourceMap, load } from '../lib/store'
import type { RawMetrics } from '../transfers/metrics'
import type { Direction } from '../transfers/transfers'
import type { Range, UserSort } from './params'

type RawStats = { totalBytes: number; count: number; distinctUsers: number }

// Keyed by the final state without Completed, such as Succeeded or TimedOut.
type RawStates = Partial<Record<string, RawStats>>

export type RawSummary = { Download: RawStates; Upload: RawStates }

// Keyed by the start of each bucket.
export type RawHistogram = Record<string, RawSummary>

export type RawLeader = { username: string; count: number; totalBytes: number; averageSpeed: number }

export type RawFolder = { directory: string; count: number; distinctUsers: number }

export type RawReason = { exception?: string; count: number; distinctUsers: number }

export type Figures = { bytes: number; files: number; failed: number }

export type Totals = Figures & { users: number }

export type Bar = { start: number; end: number; download: Figures; upload: Figures }

export type Unit = 'hour' | 'sixHours' | 'day' | 'month'

export type Folder = { path: string; files: number; users: number }

export type Reason = { message?: string; files: number; users: number }

export type Report = {
  unit: Unit
  bars: readonly Bar[]
  totals: Record<Direction, Totals>
  folders: readonly Folder[]
  reasons: Record<Direction, readonly Reason[]>
  // Whether anything has ever finished, which an empty range doesn't say.
  any: boolean
}

export type Leader = { username: string; files: number; bytes: number; speed: number }

export type Leaders = Record<Direction, readonly Leader[]>

const steps: Record<Unit, (date: Date, count: number) => void> = {
  hour: (date, count) => date.setHours(date.getHours() + count),
  sixHours: (date, count) => date.setHours(date.getHours() + 6 * count),
  day: (date, count) => date.setDate(date.getDate() + count),
  month: (date, count) => date.setMonth(date.getMonth() + count),
}

// The start of the local hour, six hours, day or month that a time falls in.
function floor(unit: Unit, time: number) {
  const date = new Date(time)
  if (unit === 'month') date.setDate(1)
  if (unit === 'month' || unit === 'day') date.setHours(0, 0, 0, 0)
  else date.setHours(unit === 'sixHours' ? date.getHours() - (date.getHours() % 6) : date.getHours(), 0, 0, 0)
  return date.getTime()
}

function add(unit: Unit, time: number, count: number) {
  const date = new Date(time)
  steps[unit](date, count)
  return date.getTime()
}

// slskd's buckets start on whole UTC hours or days, so local hours and days are made of hourly ones. A year of those
// would be megabytes, so months are made of days, and their edges are off by the time zone's offset.
const layouts: Record<Range, { unit: Unit; bars?: number; interval: number }> = {
  '24h': { unit: 'hour', bars: 24, interval: 60 },
  '7d': { unit: 'sixHours', bars: 28, interval: 60 },
  '30d': { unit: 'day', bars: 30, interval: 60 },
  '1y': { unit: 'month', bars: 12, interval: 1440 },
  all: { unit: 'month', interval: 1440 },
}

// All time starts at 1970, which the histogram replaces with the time of the oldest transfer.
function startOf(range: Range, now: number) {
  const { unit, bars } = layouts[range]
  return bars === undefined ? 0 : add(unit, floor(unit, now), 1 - bars)
}

const iso = (time: number) => new Date(time).toISOString()

const request = <T>(path: string, searchParams: Record<string, string | number>, signal: AbortSignal) =>
  api.get(`telemetry/reports/transfers/${path}`, { searchParams, signal }).json<T>()

function figuresOf(states: RawStates): Figures {
  let failed = 0
  for (const [state, stats] of Object.entries(states)) {
    if (state !== 'Succeeded' && state !== 'Cancelled') failed += stats?.count ?? 0
  }
  return { bytes: states.Succeeded?.totalBytes ?? 0, files: states.Succeeded?.count ?? 0, failed }
}

const totalsOf = (states: RawStates): Totals => ({ ...figuresOf(states), users: states.Succeeded?.distinctUsers ?? 0 })

const plus = (a: Figures, b: Figures): Figures => ({
  bytes: a.bytes + b.bytes,
  files: a.files + b.files,
  failed: a.failed + b.failed,
})

const none: Figures = { bytes: 0, files: 0, failed: 0 }

const finished = (summary: RawSummary) =>
  Object.keys(summary.Download).length > 0 || Object.keys(summary.Upload).length > 0

// A bucket that starts before the first bar holds only what ended after the window's start, and goes in the first bar.
function barsOf(histogram: RawHistogram, unit: Unit, start: number, now: number) {
  const buckets = Object.entries(histogram)
    .map(([key, summary]) => ({ time: Date.parse(key), summary }))
    .sort((a, b) => a.time - b.time)
  let first = start
  if (start === 0) {
    const oldest = buckets.find((bucket) => finished(bucket.summary))
    if (oldest === undefined) return []
    first = floor(unit, oldest.time)
  }
  const bars: Bar[] = []
  for (let time = first; time <= now;) {
    const end = add(unit, time, 1)
    bars.push({ start: time, end, download: none, upload: none })
    time = end
  }
  let index = 0
  for (const { time, summary } of buckets) {
    while (index < bars.length - 1 && time >= bars[index]!.end) index++
    const bar = bars[index]!
    bar.download = plus(bar.download, figuresOf(summary.Download))
    bar.upload = plus(bar.upload, figuresOf(summary.Upload))
  }
  return bars
}

// slskd orders them by count alone, so ties would swap places between loads.
const reasonsOf = (raw: RawReason[]): Reason[] =>
  raw
    .map((reason) => ({ message: reason.exception, files: reason.count, users: reason.distinctUsers }))
    .sort((a, b) => b.files - a.files || (a.message ?? '').localeCompare(b.message ?? ''))

async function fetchReport(range: Range, signal: AbortSignal): Promise<Report> {
  const now = Date.now()
  const { unit, interval } = layouts[range]
  const start = startOf(range, now)
  const params = { start: iso(start), end: iso(now) }
  const [histogram, summary, folders, downloadReasons, uploadReasons] = await Promise.all([
    request<RawHistogram>('histogram', { ...params, interval }, signal),
    request<RawSummary>('summary', params, signal),
    request<RawFolder[]>('directories', { ...params, limit: 10 }, signal),
    request<RawReason[]>('exceptions/pareto', { ...params, direction: 'Download', limit: 10 }, signal),
    request<RawReason[]>('exceptions/pareto', { ...params, direction: 'Upload', limit: 10 }, signal),
  ])
  const any =
    finished(summary) || (start !== 0 && finished(await request<RawSummary>('summary', { start: iso(0) }, signal)))
  return {
    unit,
    bars: barsOf(histogram, unit, start, now),
    totals: { download: totalsOf(summary.Download), upload: totalsOf(summary.Upload) },
    folders: folders.map((folder) => ({ path: folder.directory, files: folder.count, users: folder.distinctUsers })),
    reasons: { download: reasonsOf(downloadReasons), upload: reasonsOf(uploadReasons) },
    any,
  }
}

const sortKeys: Record<UserSort, string> = { files: 'Count', size: 'TotalBytes', speed: 'AverageSpeed' }

const leaderOf = (raw: RawLeader): Leader => ({
  username: raw.username,
  files: raw.count,
  bytes: raw.totalBytes,
  speed: raw.averageSpeed,
})

async function fetchLeaders(range: Range, sort: UserSort, signal: AbortSignal): Promise<Leaders> {
  const now = Date.now()
  const params = {
    start: iso(startOf(range, now)),
    end: iso(now),
    sortBy: sortKeys[sort],
    sortOrder: 'DESC',
    limit: 10,
  }
  const leaders = async (direction: string) =>
    (await request<RawLeader[]>('leaderboard', { ...params, direction }, signal)).map(leaderOf)
  const [download, upload] = await Promise.all([leaders('Download'), leaders('Upload')])
  return { download, upload }
}

const reloadGap = 60_000

// The reports change only as transfers finish, which the metrics hub counts. They're read again at most once a minute,
// and not while the tab is hidden.
function reloadOnFinish(reload: () => void) {
  let counted: string | undefined
  let loadedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let missed = false
  function schedule() {
    if (document.hidden) {
      missed = true
      return
    }
    timer ??= setTimeout(
      () => {
        timer = undefined
        missed = false
        loadedAt = Date.now()
        reload()
      },
      Math.max(0, loadedAt + reloadGap - Date.now()),
    )
  }
  const stop = metricsHub.on<RawMetrics>('Update', ({ downloads, uploads }) => {
    const count = [downloads, uploads].map(({ completed }) => `${completed.succeeded} ${completed.failed}`).join(' ')
    if (counted !== undefined && count !== counted) schedule()
    counted = count
  })
  function onVisibilityChange() {
    if (!document.hidden && missed) schedule()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    stop()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

function createReport<T extends object>(read: (signal: AbortSignal) => Promise<T>) {
  return createResource<T>((sink) => {
    const source = load(sink, read)
    const stop = reloadOnFinish(source.refresh)
    return {
      stop() {
        source.stop()
        stop()
      },
      refresh: source.refresh,
    }
  })
}

export const reports = createResourceMap((range) => createReport((signal) => fetchReport(range as Range, signal)))

export const leaderboards = createResourceMap((key) => {
  const [range, sort] = key.split(' ') as [Range, UserSort]
  return createReport((signal) => fetchLeaders(range, sort, signal))
})

export const leadersKey = (range: Range, sort: UserSort) => `${range} ${sort}`
