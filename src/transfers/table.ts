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
import { fixed, growing, sized, type Track } from '../ui/widths'
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

// The sections share their widths and hidden columns, which keeps their columns in line. Requested and Ended are
// kept apart.
export const tracks: Record<Exclude<Layout, 'stacked'>, Record<Section, readonly Track[]>> = {
  wide: {
    active: [
      fixed(40),
      growing('name', 240),
      sized('user', 160),
      sized('status', 280),
      sized('size', 170),
      sized('speed', 110),
      sized('requested', 100),
      fixed(76),
    ],
    finished: [
      fixed(40),
      growing('name', 240),
      sized('user', 160),
      sized('status', 280),
      sized('size', 170),
      sized('ended', 200),
      fixed(76),
    ],
  },
  medium: {
    active: [
      fixed(40),
      growing('name', 200),
      sized('user', 140),
      sized('status', 240),
      sized('size', 150),
      sized('speed', 100),
      fixed(76),
    ],
    finished: [
      fixed(40),
      growing('name', 200),
      sized('user', 140),
      sized('status', 240),
      sized('size', 150),
      fixed(76),
    ],
  },
}

export const endAligned = new Set<string>(['size', 'speed'])

export const timeKey = { active: 'requested', finished: 'ended' } as const

const keyOf = (section: Section, id: ColumnId) => (id === 'time' ? timeKey[section] : id)

// Stacked, the sort strip has every column.
export const columnsOf = (section: Section, stacked: boolean, shown: ReadonlySet<string>) =>
  stacked ? columnIds[section] : columnIds[section].filter((id) => shown.has(keyOf(section, id)))

const labelsOf = (section: Section) =>
  Object.fromEntries(columnIds[section].map((id) => [keyOf(section, id), columnLabels[section][id]]))

export const trackLabels = { active: labelsOf('active'), finished: labelsOf('finished') }

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

type SectionTableOptions<S extends string> = {
  section: Section
  data: Group[]
  sort: S | undefined
  onSortChange: (sort: S | undefined) => void
  expansion: Expansion
  rowSelection: RowSelectionState
  onRowSelectionChange: (updater: Updater<RowSelectionState>) => void
}

export function useSectionTable<S extends string>({
  section,
  data,
  sort,
  onSortChange,
  expansion,
  rowSelection,
  onRowSelectionChange,
}: SectionTableOptions<S>) {
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
