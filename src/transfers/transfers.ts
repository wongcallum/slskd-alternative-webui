import { api } from '../lib/api'
import { nameOf } from '../lib/files'
import { toTime } from '../lib/format'
import { createRate } from '../lib/rate'
import { createResource, isStale, poll, type Resource } from '../lib/store'
import { byName, compareNames } from '../lib/text'

export type Direction = 'download' | 'upload'

export type Section = 'active' | 'finished'

type RawTransfer = {
  id: string
  batchId?: string
  filename: string
  size: number
  state: string
  requestedAt: string
  enqueuedAt?: string
  startedAt?: string
  endedAt?: string
  bytesTransferred: number
  averageSpeed: number
  placeInQueue?: number
  exception?: string
  attempts: number
}

type RawUser = { username: string; directories: { directory: string; files: RawTransfer[] }[] }

export type Transfer = RawTransfer & { kind: 'file'; username: string; directory: string; name: string; search: string }

type Folder = { total: number; succeeded: number; failed: number; cancelled: number }

export type Group = {
  kind: 'group'
  id: string
  section: Section
  username: string
  directory: string
  name: string
  files: Transfer[]
  size: number
  bytesTransferred: number
  speed: number
  time: number
  failed: number
  folder: Folder
}

export type Transfers = {
  active: Group[]
  finished: Group[]
  byId: Map<string, Transfer>
  transferring: number
  queued: number
  succeeded: number
  failed: number
  cancelled: number
  // From bytesTransferred between polls, so undefined until there are two polls to compare.
  speed?: number
}

export const isFinished = (state: string) => state.startsWith('Completed')
const isSucceeded = (state: string) => state === 'Completed, Succeeded'
const isCancelled = (state: string) => state === 'Completed, Cancelled'
export const isRetryable = (state: string) => isFinished(state) && !isSucceeded(state)
export const isFailed = (state: string) => isRetryable(state) && !isCancelled(state)
export const isTransferring = (state: string) => state === 'InProgress' || state === 'Initializing'

const unchanged = (file: Transfer, raw: RawTransfer) =>
  file.state === raw.state &&
  file.attempts === raw.attempts &&
  file.bytesTransferred === raw.bytesTransferred &&
  file.averageSpeed === raw.averageSpeed &&
  file.placeInQueue === raw.placeInQueue &&
  file.exception === raw.exception &&
  file.enqueuedAt === raw.enqueuedAt &&
  file.startedAt === raw.startedAt &&
  file.endedAt === raw.endedAt

const toTransfer = (raw: RawTransfer, username: string, directory: string): Transfer => ({
  kind: 'file',
  id: raw.id,
  batchId: raw.batchId,
  username,
  directory,
  filename: raw.filename,
  name: nameOf(raw.filename),
  size: raw.size,
  state: raw.state,
  requestedAt: raw.requestedAt,
  enqueuedAt: raw.enqueuedAt,
  startedAt: raw.startedAt,
  endedAt: raw.endedAt,
  bytesTransferred: raw.bytesTransferred,
  averageSpeed: raw.averageSpeed,
  placeInQueue: raw.placeInQueue,
  exception: raw.exception,
  attempts: raw.attempts,
  search: `${username}\n${raw.filename}`.toLowerCase(),
})

function buildGroup(section: Section, username: string, directory: string, files: Transfer[], folder: Folder): Group {
  let size = 0
  let bytesTransferred = 0
  let speed = 0
  let time = 0
  let failed = 0
  for (const file of files) {
    size += file.size
    bytesTransferred += file.bytesTransferred
    if (isTransferring(file.state)) speed += file.averageSpeed
    if (isFailed(file.state)) failed++
    const at = section === 'active' ? file.requestedAt : file.endedAt
    if (at !== undefined) time = Math.max(time, toTime(at))
  }
  return {
    kind: 'group',
    id: `${section}\n${username}\n${directory}`,
    section,
    username,
    directory,
    name: nameOf(directory) || directory,
    files,
    size,
    bytesTransferred,
    speed,
    time,
    failed,
    folder,
  }
}

const byNewest = (a: Group, b: Group) => b.time - a.time || compareNames(a.name, b.name)

// Everything that didn't change keeps its identity: files, groups, both section arrays, and the whole
// snapshot when nothing changed at all. See "Array identity" in docs/design.md.
function merge(
  previous: Transfers | undefined,
  users: RawUser[],
  measureSpeed: (moved: number) => number | undefined,
): Transfers {
  const byId = new Map<string, Transfer>()
  const previousGroups = new Map<string, Group>()
  for (const group of previous?.active ?? []) previousGroups.set(group.id, group)
  for (const group of previous?.finished ?? []) previousGroups.set(group.id, group)
  const totals = { transferring: 0, queued: 0, succeeded: 0, failed: 0, cancelled: 0 }
  let moved = 0
  const sections: Record<Section, Group[]> = { active: [], finished: [] }

  function place(section: Section, username: string, directory: string, files: Transfer[], folder: Folder) {
    const old = previousGroups.get(`${section}\n${username}\n${directory}`)
    const reusable =
      old !== undefined &&
      old.files.length === files.length &&
      old.folder.total === folder.total &&
      old.folder.succeeded === folder.succeeded &&
      old.folder.failed === folder.failed &&
      old.folder.cancelled === folder.cancelled &&
      files.every((file) => previous?.byId.get(file.id) === file)
    sections[section].push(reusable ? old : buildGroup(section, username, directory, files.sort(byName), folder))
  }

  for (const { username, directories } of users) {
    for (const { directory, files } of directories) {
      const active: Transfer[] = []
      const finished: Transfer[] = []
      let succeeded = 0
      let cancelled = 0
      for (const raw of files) {
        const old = previous?.byId.get(raw.id)
        // A retry can reuse the id and start again from 0.
        moved += Math.max(0, raw.bytesTransferred - (old?.bytesTransferred ?? 0))
        const file = old !== undefined && unchanged(old, raw) ? old : toTransfer(raw, username, directory)
        byId.set(file.id, file)
        if (isFinished(file.state)) {
          finished.push(file)
          if (isSucceeded(file.state)) succeeded++
          else if (isCancelled(file.state)) cancelled++
        } else {
          active.push(file)
          if (isTransferring(file.state)) totals.transferring++
          else totals.queued++
        }
      }
      const failed = finished.length - succeeded - cancelled
      totals.succeeded += succeeded
      totals.failed += failed
      totals.cancelled += cancelled
      const folder = { total: files.length, succeeded, failed, cancelled }
      if (active.length > 0) place('active', username, directory, active, folder)
      if (finished.length > 0) place('finished', username, directory, finished, folder)
    }
  }

  const settle = (groups: Group[], old: Group[] | undefined) =>
    old !== undefined && old.length === groups.length && groups.every((group) => previousGroups.get(group.id) === group)
      ? old
      : groups.sort(byNewest)

  const active = settle(sections.active, previous?.active)
  const finished = settle(sections.finished, previous?.finished)
  const speed = measureSpeed(moved)
  if (previous !== undefined && active === previous.active && finished === previous.finished) {
    return speed === previous.speed ? previous : { ...previous, speed }
  }
  return { active, finished, byId, ...totals, speed }
}

export type Show = 'all' | 'succeeded' | 'failed' | 'cancelled'

const outcomeOf = (state: string): Show =>
  isSucceeded(state) ? 'succeeded' : isCancelled(state) ? 'cancelled' : 'failed'

export function filterGroups(groups: Group[], query: string, show: Show) {
  if (query === '' && show === 'all') return groups
  const needle = query.toLowerCase()
  const result: Group[] = []
  for (const group of groups) {
    const files = group.files.filter(
      (file) => file.search.includes(needle) && (show === 'all' || outcomeOf(file.state) === show),
    )
    if (files.length === group.files.length) result.push(group)
    else if (files.length > 0) {
      result.push(buildGroup(group.section, group.username, group.directory, files, group.folder))
    }
  }
  return result
}

export const pollInterval = 1000

function createTransfers(direction: Direction) {
  const rate = createRate()
  const resource: Resource<Transfers> = createResource((sink) =>
    poll(
      sink,
      async (signal, measure) => {
        const text = await api.get(`transfers/${direction}s`, { signal, timeout: false }).text()
        const now = Date.now()
        const last = resource.getUpdatedAt()
        // After a gap long enough to count as stale, the poll only sets a new baseline for the speed.
        const elapsed =
          last === undefined || isStale(now - last, resource.getInterval() ?? pollInterval) ? undefined : now - last
        if (elapsed === undefined) rate.reset()
        const measureSpeed = (moved: number) => (elapsed === undefined ? undefined : rate.add(now, elapsed, moved))
        return measure(() => merge(resource.getSnapshot().data, JSON.parse(text) as RawUser[], measureSpeed))
      },
      pollInterval,
    ),
  )
  return resource
}

export const transfers: Record<Direction, Resource<Transfers>> = {
  download: createTransfers('download'),
  upload: createTransfers('upload'),
}
