import { api } from '../lib/api'
import { nameOf } from '../lib/files'
import { toTime } from '../lib/format'
import { createResource, poll, type Resource } from '../lib/store'
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

export type Folder = { total: number; succeeded: number; failed: number }

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
  speed: number
}

export const isFinished = (state: string) => state.startsWith('Completed')
export const isSucceeded = (state: string) => state === 'Completed, Succeeded'
export const isFailed = (state: string) => isFinished(state) && !isSucceeded(state)
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
function merge(previous: Transfers | undefined, users: RawUser[]): Transfers {
  const byId = new Map<string, Transfer>()
  const previousGroups = new Map<string, Group>()
  for (const group of previous?.active ?? []) previousGroups.set(group.id, group)
  for (const group of previous?.finished ?? []) previousGroups.set(group.id, group)
  const totals = { transferring: 0, queued: 0, succeeded: 0, failed: 0, speed: 0 }
  const sections: Record<Section, Group[]> = { active: [], finished: [] }

  function place(section: Section, username: string, directory: string, files: Transfer[], folder: Folder) {
    const old = previousGroups.get(`${section}\n${username}\n${directory}`)
    const reusable =
      old !== undefined &&
      old.files.length === files.length &&
      old.folder.total === folder.total &&
      old.folder.succeeded === folder.succeeded &&
      old.folder.failed === folder.failed &&
      files.every((file) => previous?.byId.get(file.id) === file)
    sections[section].push(reusable ? old : buildGroup(section, username, directory, files.sort(byName), folder))
  }

  for (const { username, directories } of users) {
    for (const { directory, files } of directories) {
      const active: Transfer[] = []
      const finished: Transfer[] = []
      let succeeded = 0
      for (const raw of files) {
        const old = previous?.byId.get(raw.id)
        const file = old !== undefined && unchanged(old, raw) ? old : toTransfer(raw, username, directory)
        byId.set(file.id, file)
        if (isFinished(file.state)) {
          finished.push(file)
          if (isSucceeded(file.state)) succeeded++
        } else {
          active.push(file)
          if (isTransferring(file.state)) {
            totals.transferring++
            totals.speed += file.averageSpeed
          } else totals.queued++
        }
      }
      totals.succeeded += succeeded
      totals.failed += finished.length - succeeded
      const folder = { total: files.length, succeeded, failed: finished.length - succeeded }
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
  if (previous !== undefined && active === previous.active && finished === previous.finished) return previous
  return { active, finished, byId, ...totals }
}

export type Show = 'all' | 'succeeded' | 'failed'

export function filterGroups(groups: Group[], query: string, show: Show) {
  if (query === '' && show === 'all') return groups
  const needle = query.toLowerCase()
  const result: Group[] = []
  for (const group of groups) {
    const files = group.files.filter(
      (file) => file.search.includes(needle) && (show === 'all' || (show === 'succeeded') === isSucceeded(file.state)),
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
  const resource: Resource<Transfers> = createResource((sink) =>
    poll(
      sink,
      async (signal, measure) => {
        const text = await api.get(`transfers/${direction}s`, { signal, timeout: false }).text()
        return measure(() => merge(resource.getSnapshot().data, JSON.parse(text) as RawUser[]))
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
