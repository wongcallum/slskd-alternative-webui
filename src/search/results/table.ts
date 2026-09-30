import { createColumnHelper, type Row, sortFn_basic, type useTable } from '@tanstack/react-table'

import { createAtom } from '../../lib/store'
import {
  type Expansion,
  groupFeatures,
  type LayoutTracks,
  sortByName,
  sortByPath,
  stackedHeight,
  stackedHeight3,
} from '../../ui/table'
import { fixed, growing, sized } from '../../ui/widths'
import { availability, type ResultFile, type ResultGroup } from './results'

export const columnIds = ['name', 'user', 'files', 'size', 'quality', 'length', 'speed', 'queue'] as const

type Item = ResultGroup | ResultFile

export type TableRow = Row<typeof groupFeatures, Item>

export type ResultTable = ReturnType<typeof useTable<typeof groupFeatures, Item>>

const helper = createColumnHelper<typeof groupFeatures, Item>()

export const columns = helper.columns([
  helper.accessor((item) => (item.kind === 'group' ? item.directory : item.name), {
    id: 'name',
    sortFn: sortByPath,
    sortDescFirst: false,
  }),
  helper.accessor((item) => item.username, { id: 'user', sortFn: sortByName, sortDescFirst: false }),
  helper.accessor((item) => (item.kind === 'group' ? item.files.length : 0), {
    id: 'files',
    sortFn: sortFn_basic,
    sortDescFirst: true,
  }),
  helper.accessor((item) => item.size, { id: 'size', sortFn: sortFn_basic, sortDescFirst: true }),
  helper.accessor((item) => item.quality, { id: 'quality', sortFn: sortFn_basic, sortDescFirst: true }),
  helper.accessor((item) => item.length ?? 0, { id: 'length', sortFn: sortFn_basic, sortDescFirst: true }),
  helper.accessor((item) => item.peer.speed, { id: 'speed', sortFn: sortFn_basic, sortDescFirst: true }),
  helper.accessor((item) => availability(item.peer), { id: 'queue', sortFn: sortFn_basic, sortDescFirst: false }),
])

export const columnLabels: Record<(typeof columnIds)[number], string> = {
  name: 'Name',
  user: 'User',
  files: 'Files',
  size: 'Size',
  quality: 'Quality',
  length: 'Length',
  speed: 'Speed',
  queue: 'Queue',
}

export const endAligned = new Set<string>(['files', 'size', 'length', 'speed', 'queue'])

export const tracks: LayoutTracks = {
  wide: [
    fixed(40),
    growing('name', 280),
    sized('user', 150),
    sized('files', 90),
    sized('size', 100),
    sized('quality', 160),
    sized('length', 80),
    sized('speed', 110),
    sized('queue', 80),
    fixed(132),
  ],
  medium: [
    fixed(40),
    growing('name', 260),
    sized('user', 120),
    sized('files', 60),
    sized('size', 90),
    sized('quality', 120),
    sized('speed', 90),
    sized('queue', 60),
    fixed(132),
  ],
}

// Stacked, the sort strip has every column.
export const columnsOf = (stacked: boolean, shown: ReadonlySet<string>) =>
  stacked ? columnIds : columnIds.filter((id) => shown.has(id))

// Stacked folders take three lines, so the user, speed and queue fit beside the four actions.
export const stackedSize = (row: TableRow) => (row.original.kind === 'group' ? stackedHeight3 : stackedHeight)

export const expansions = createAtom<ReadonlyMap<string, Expansion>>(new Map())

// The files a download of the selection takes: locked ones can't be downloaded.
export function selectedFiles(table: ResultTable) {
  const files: ResultFile[] = []
  for (const row of table.getSelectedRowModel().flatRows) {
    if (row.original.kind === 'file' && !row.original.locked) files.push(row.original)
  }
  return files
}

export const canSelect = (row: TableRow) =>
  row.original.kind === 'group' ? row.original.files.some((file) => !file.locked) : !row.original.locked
