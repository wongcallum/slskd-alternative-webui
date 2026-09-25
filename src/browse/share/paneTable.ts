import {
  createColumnHelper,
  type Row,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  type useTable,
} from '@tanstack/react-table'
import { byName, compareNames } from '../../lib/text'
import type { Folder, ShareFile } from '../shareTree'

export const columnIds = ['name', 'folder', 'files', 'size', 'quality', 'length'] as const

type ColumnId = (typeof columnIds)[number]

export const paneFeatures = tableFeatures({ rowSortingFeature, rowSelectionFeature })

export type Item = Folder | ShareFile

export type PaneRow = Row<typeof paneFeatures, Item>

export type PaneTable = ReturnType<typeof useTable<typeof paneFeatures, Item>>

const helper = createColumnHelper<typeof paneFeatures, Item>()

export const columns = helper.columns([
  helper.accessor((item) => item.name, { id: 'name', sortDescFirst: false }),
  helper.accessor((item) => item.id, { id: 'folder', sortDescFirst: false }),
  helper.accessor((item) => (item.kind === 'folder' ? item.fileCount : 0), { id: 'files', sortDescFirst: true }),
  helper.accessor((item) => item.size, { id: 'size', sortDescFirst: true }),
  helper.accessor((item) => item.quality, { id: 'quality', sortDescFirst: true }),
  helper.accessor((item) => item.length ?? 0, { id: 'length', sortDescFirst: true }),
])

export const columnLabels: Record<ColumnId, string> = {
  name: 'Name',
  folder: 'Folder',
  files: 'Files',
  size: 'Size',
  quality: 'Quality',
  length: 'Length',
}

export const endAligned = new Set<ColumnId>(['files', 'size', 'length'])

export const folderColumns: ColumnId[] = ['name', 'files', 'size', 'quality', 'length']

export const matchColumns: ColumnId[] = ['name', 'folder', 'size', 'quality', 'length']

export const folderTemplate = '40px minmax(280px, 1fr) 90px 100px 170px 100px'

export const matchTemplate = '40px minmax(240px, 1fr) minmax(160px, 0.7fr) 100px 170px 100px'

const number = (id: ColumnId, item: Item) => {
  if (id === 'files') return item.kind === 'folder' ? item.fileCount : 0
  if (id === 'size') return item.size
  if (id === 'quality') return item.quality
  return item.length ?? 0
}

// Subfolders always stay above files, so the two are sorted apart and TanStack is told the data comes sorted.
export function sortItems<T extends Item>(items: T[], [sort]: SortingState, folderOf: (item: T) => string): T[] {
  if (sort === undefined) return items
  const id = sort.id as ColumnId
  const sign = sort.desc ? -1 : 1
  const compare =
    id === 'name'
      ? byName
      : id === 'folder'
        ? (a: T, b: T) => compareNames(folderOf(a), folderOf(b))
        : (a: T, b: T) => number(id, a) - number(id, b)
  return [...items].sort((a, b) => sign * compare(a, b) || byName<Item>(a, b))
}

export const selectable = (item: Item) => (item.kind === 'folder' ? item.fileCount > item.lockedCount : !item.locked)
