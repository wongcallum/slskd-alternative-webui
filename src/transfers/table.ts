import {
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  type ExpandedStateList,
  functionalUpdate,
  type Row,
  rowExpandingFeature,
  rowSelectionFeature,
  type RowSelectionState,
  rowSortingFeature,
  type SortFn,
  tableFeatures,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { useMemo } from 'react'
import { toTime } from '../lib/format'
import { formatSort, parseSort } from '../lib/params'
import { type Atom, createAtom } from '../lib/store'
import { compareNames } from '../lib/text'
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

const byNumber: SortFn<typeof features, Item> = (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id)

const byName: SortFn<typeof features, Item> = (a, b, id) => compareNames(a.getValue<string>(id), b.getValue<string>(id))

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
    helper.accessor((item) => item.name, { id: 'name', sortFn: byName, sortDescFirst: false }),
    helper.accessor((item) => item.username, { id: 'user', sortFn: byName, sortDescFirst: false }),
    helper.accessor((item) => statusOf(section, item), { id: 'status', sortFn: byNumber, sortDescFirst: true }),
    helper.accessor((item) => item.size, { id: 'size', sortFn: byNumber, sortDescFirst: true }),
    ...(section === 'active' ? [helper.accessor(speedOf, { id: 'speed', sortFn: byNumber, sortDescFirst: true })] : []),
    helper.accessor((item) => timeOf(section, item), { id: 'time', sortFn: byNumber, sortDescFirst: true }),
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

type Expansion = Record<Section, ExpandedStateList>

export const expansions: Record<Direction, Atom<Expansion>> = {
  download: createAtom<Expansion>({ active: {}, finished: {} }),
  upload: createAtom<Expansion>({ active: {}, finished: {} }),
}

export const openSections: Record<Direction, Atom<Record<Section, boolean>>> = {
  download: createAtom<Record<Section, boolean>>({ active: true, finished: true }),
  upload: createAtom<Record<Section, boolean>>({ active: true, finished: true }),
}

// Active groups start expanded and finished ones collapsed, so only toggles are stored.
export const expandedByDefault = (section: Section) => section === 'active'

export function useSectionTable(
  section: Section,
  data: Group[],
  sort: string | undefined,
  toggled: ExpandedStateList,
  rowSelection: RowSelectionState,
  onRowSelectionChange: (updater: Updater<RowSelectionState>) => void,
  onSortChange: (value: string | undefined) => void,
) {
  const sorting = useMemo(() => parseSort(sort), [sort])
  // TanStack skips expansion entirely while the expanded state is empty, so defaults have to be spelled out.
  const expanded = useMemo(() => {
    if (!expandedByDefault(section)) return toggled
    const all: ExpandedStateList = {}
    for (const group of data) all[group.id] = toggled[group.id] ?? true
    return all
  }, [section, data, toggled])
  return useTable({
    features,
    columns: columns[section],
    data,
    getRowId: (item) => item.id,
    getSubRows: (item) => (item.kind === 'group' ? item.files : undefined),
    autoResetExpanded: false,
    enableMultiSort: false,
    state: { sorting, expanded, rowSelection },
    onSortingChange: (updater) => onSortChange(formatSort(functionalUpdate(updater, sorting))),
    onRowSelectionChange,
  })
}

export type SectionTable = ReturnType<typeof useSectionTable>

export type Gates = { list?: string; soulseek?: string }
