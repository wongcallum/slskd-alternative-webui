import {
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  type ExpandedStateList,
  type Row,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  type SortFn,
  tableFeatures,
  type useTable,
} from '@tanstack/react-table'
import { createAtom } from '../../lib/store'
import { compareNames } from '../../lib/text'
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

const byNumber: SortFn<typeof features, Item> = (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id)

const byName: SortFn<typeof features, Item> = (a, b, id) => compareNames(a.getValue<string>(id), b.getValue<string>(id))

export const columns = helper.columns([
  helper.accessor((item) => item.name, { id: 'name', sortFn: byName, sortDescFirst: false }),
  helper.accessor((item) => item.username, { id: 'user', sortFn: byName, sortDescFirst: false }),
  helper.accessor((item) => (item.kind === 'group' ? item.files.length : 0), {
    id: 'files',
    sortFn: byNumber,
    sortDescFirst: true,
  }),
  helper.accessor((item) => item.size, { id: 'size', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => item.quality, { id: 'quality', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => item.length ?? 0, { id: 'length', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => item.peer.speed, { id: 'speed', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => availability(item.peer), { id: 'queue', sortFn: byNumber, sortDescFirst: false }),
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

export const template = '40px minmax(280px, 1fr) 150px 90px 100px 160px 80px 110px 80px 132px'

export const minWidth = 1222

type Expansion = { all: boolean; toggled: ExpandedStateList }

export const collapsed: Expansion = { all: false, toggled: {} }

export const expansions = createAtom<ReadonlyMap<string, Expansion>>(new Map())

export const canSelect = (row: TableRow) =>
  row.original.kind === 'group' ? row.original.files.some((file) => !file.locked) : !row.original.locked
