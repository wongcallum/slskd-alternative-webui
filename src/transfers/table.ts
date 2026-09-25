import {
  createColumnHelper,
  type Row,
  type RowSelectionState,
  sortFn_basic,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { useMemo } from 'react'

import { formatBytes, formatProgress, toTime } from '../lib/format'
import { useSortParam } from '../lib/params'
import { createAtom } from '../lib/store'
import { collapsed, type Expansion, expandedState, groupFeatures, type Layout, sortByName } from '../ui/table'
import { type Group, isFailed, isTransferring, perDirection, type Section, type Transfer } from './transfers'

export const columnIds = {
  active: ['name', 'user', 'status', 'size', 'speed', 'time'],
  finished: ['name', 'user', 'status', 'size', 'time'],
} as const

type ColumnId = (typeof columnIds.active)[number]

type Item = Group | Transfer

export type TableRow = Row<typeof groupFeatures, Item>

const helper = createColumnHelper<typeof groupFeatures, Item>()

export const fraction = (item: Item) => (item.size > 0 ? item.bytesTransferred / item.size : 0)

export const sizeOf = (section: Section, item: Item) =>
  section === 'active' && item.bytesTransferred > 0
    ? formatProgress(item.bytesTransferred, item.size)
    : formatBytes(item.size)

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

export const templates: Record<Exclude<Layout, 'stacked'>, Record<Section, string>> = {
  wide: {
    active: '40px minmax(240px, 1fr) 160px 280px 170px 110px 100px 76px',
    finished: '40px minmax(240px, 1fr) 160px 280px 170px 200px 76px',
  },
  medium: {
    active: '40px minmax(200px, 1fr) 140px 240px 150px 100px 76px',
    finished: '40px minmax(200px, 1fr) 140px 240px 150px 76px',
  },
}

export const minWidths: Record<Layout, number> = { stacked: 0, wide: 1176, medium: 946 }

export const columnsOf = (section: Section, layout: Layout) =>
  layout === 'medium' ? columnIds[section].filter((id) => id !== 'time') : columnIds[section]

export const barHeight = 44

// Below sm, a section's title and actions take one line and its summary and filter the next.
export const twoLineBarHeight = 72

const initialExpansion = (): Record<Section, Expansion> => ({ active: { all: true, toggled: {} }, finished: collapsed })

export const expansions = perDirection(() => createAtom(initialExpansion()))

export const openSections = perDirection(() => createAtom<Record<Section, boolean>>({ active: true, finished: true }))

// A row that leaves its section, as a retried file does, would come back selected if it returned under the same id.
export function keepPresent(selection: RowSelectionState, groups: readonly Group[] | undefined) {
  const ids = Object.keys(selection)
  if (ids.length === 0 || groups === undefined) return selection
  const present = new Set<string>()
  for (const group of groups) {
    present.add(group.id)
    for (const file of group.files) present.add(file.id)
  }
  if (ids.every((id) => present.has(id))) return selection
  return Object.fromEntries(Object.entries(selection).filter(([id]) => present.has(id)))
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
    features: groupFeatures,
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
