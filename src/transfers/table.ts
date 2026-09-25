import {
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  type Row,
  rowExpandingFeature,
  rowSelectionFeature,
  type RowSelectionState,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { useMemo } from 'react'

import { toTime } from '../lib/format'
import { useSortParam } from '../lib/params'
import { type Atom, createAtom } from '../lib/store'
import { collapsed, type Expansion, expandedState, sortByName } from '../ui/table'
import { type Direction, type Group, isFailed, isTransferring, type Section, type Transfer } from './transfers'

export const columnIds = {
  active: ['name', 'user', 'status', 'size', 'speed', 'time'],
  finished: ['name', 'user', 'status', 'size', 'time'],
} as const

type ColumnId = (typeof columnIds.active)[number]

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowSelectionFeature,
})

type Item = Group | Transfer

export type TableRow = Row<typeof features, Item>

const helper = createColumnHelper<typeof features, Item>()

export const fraction = (item: Item) => (item.size > 0 ? item.bytesTransferred / item.size : 0)

const speedOf = (item: Item) =>
  item.kind === 'group' ? item.speed : isTransferring(item.state) ? item.averageSpeed : 0

export function timeOf(section: Section, item: Item) {
  if (item.kind === 'group') return item.time
  const at = section === 'active' ? item.requestedAt : item.endedAt
  return at === undefined ? 0 : toTime(at)
}

function statusOf(section: Section, item: Item) {
  if (section === 'active') return fraction(item)
  return item.kind === 'group' ? item.failed : isFailed(item.state) ? 1 : 0
}

const columnsFor = (section: Section) =>
  helper.columns([
    helper.accessor((item) => item.name, { id: 'name', sortFn: sortByName, sortDescFirst: false }),
    helper.accessor((item) => item.username, { id: 'user', sortFn: sortByName, sortDescFirst: false }),
    helper.accessor((item) => statusOf(section, item), { id: 'status', sortFn: sortFn_basic, sortDescFirst: true }),
    helper.accessor((item) => item.size, { id: 'size', sortFn: sortFn_basic, sortDescFirst: true }),
    ...(section === 'active'
      ? [helper.accessor(speedOf, { id: 'speed', sortFn: sortFn_basic, sortDescFirst: true })]
      : []),
    helper.accessor((item) => timeOf(section, item), { id: 'time', sortFn: sortFn_basic, sortDescFirst: true }),
  ])

const columns = { active: columnsFor('active'), finished: columnsFor('finished') }

export const columnLabels: Record<Section, Record<ColumnId, string>> = {
  active: { name: 'Name', user: 'User', status: 'Status', size: 'Size', speed: 'Speed', time: 'Requested' },
  finished: { name: 'Name', user: 'User', status: 'Status', size: 'Size', speed: 'Speed', time: 'Ended' },
}

export const templates: Record<Section, string> = {
  active: '40px minmax(240px, 1fr) 160px 280px 170px 110px 90px 76px',
  finished: '40px minmax(240px, 1fr) 160px 280px 170px 200px 76px',
}

export const minWidth = 1166
export const barHeight = 44

// Active groups start expanded and finished ones collapsed.
const initialExpansion = (): Record<Section, Expansion> => ({ active: { all: true, toggled: {} }, finished: collapsed })

export const expansions: Record<Direction, Atom<Record<Section, Expansion>>> = {
  download: createAtom(initialExpansion()),
  upload: createAtom(initialExpansion()),
}

export const openSections: Record<Direction, Atom<Record<Section, boolean>>> = {
  download: createAtom<Record<Section, boolean>>({ active: true, finished: true }),
  upload: createAtom<Record<Section, boolean>>({ active: true, finished: true }),
}

export function useSectionTable<S extends string>(
  section: Section,
  data: Group[],
  sort: S | undefined,
  expansion: Expansion,
  rowSelection: RowSelectionState,
  onRowSelectionChange: (updater: Updater<RowSelectionState>) => void,
  onSortChange: (sort: S | undefined) => void,
) {
  const { sorting, onSortingChange } = useSortParam(sort, onSortChange)
  const expanded = useMemo(() => expandedState(expansion, data), [expansion, data])
  return useTable({
    features,
    columns: columns[section],
    data,
    getRowId: (item) => item.id,
    getSubRows: (item) => (item.kind === 'group' ? item.files : undefined),
    autoResetExpanded: false,
    enableMultiSort: false,
    state: { sorting, expanded, rowSelection },
    onSortingChange,
    onRowSelectionChange,
  })
}

export type SectionTable = ReturnType<typeof useSectionTable>

export type Gates = { list?: string; soulseek?: string }
