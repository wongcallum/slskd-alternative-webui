import {
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  type Row,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  type useTable,
} from '@tanstack/react-table'

import { createAtom } from '../../lib/store'
import { type Expansion, type Layout, sortByName, stackedHeight, stackedHeight3 } from '../../ui/table'
import { availability, type ResultFile, type ResultGroup } from './results'

export const columnIds = ['name', 'user', 'files', 'size', 'quality', 'length', 'speed', 'queue'] as const

export const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowSelectionFeature,
})

type Item = ResultGroup | ResultFile

export type TableRow = Row<typeof features, Item>

export type ResultTable = ReturnType<typeof useTable<typeof features, Item>>

const helper = createColumnHelper<typeof features, Item>()

export const columns = helper.columns([
  helper.accessor((item) => item.name, { id: 'name', sortFn: sortByName, sortDescFirst: false }),
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

// Between md and lg the length column goes and the rest narrow.
export const templates: Record<Exclude<Layout, 'stacked'>, string> = {
  wide: '40px minmax(280px, 1fr) 150px 90px 100px 160px 80px 110px 80px 132px',
  medium: '40px minmax(260px, 1fr) 120px 60px 90px 120px 90px 60px 132px',
}

export const minWidths: Record<Layout, number> = { stacked: 0, wide: 1222, medium: 972 }

export const columnsOf = (layout: Layout) =>
  layout === 'medium' ? columnIds.filter((id) => id !== 'length') : columnIds

// Stacked folders take three lines, so the user, speed and queue fit beside the four actions.
export const stackedSize = (row: TableRow) => (row.original.kind === 'group' ? stackedHeight3 : stackedHeight)

export const expansions = createAtom<ReadonlyMap<string, Expansion>>(new Map())

export const canSelect = (row: TableRow) =>
  row.original.kind === 'group' ? row.original.files.some((file) => !file.locked) : !row.original.locked
