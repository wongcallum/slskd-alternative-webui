import {
  createColumnHelper,
  type Row,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  type useTable,
} from '@tanstack/react-table'
import type { ReactNode } from 'react'

import { formatDuration } from '../../lib/format'
import { byName, compareNames } from '../../lib/text'
import type { Item } from '../../lib/tree'

export const paneColumnIds = ['name', 'folder', 'files', 'size'] as const

// Each view adds its own columns after the name, files or folder, and size.
export type ExtraColumn = {
  id: string
  label: string
  width: number
  end?: boolean
  value: (item: Item) => number
  render: (item: Item) => ReactNode
  title?: (item: Item) => string
}

export const paneFeatures = tableFeatures({ rowSortingFeature, rowSelectionFeature })

export type PaneRow = Row<typeof paneFeatures, Item>

export type PaneTable = ReturnType<typeof useTable<typeof paneFeatures, Item>>

const helper = createColumnHelper<typeof paneFeatures, Item>()

const ascendingFirst = new Set(['name', 'folder'])

// Sorting is done outside TanStack, so the columns only carry their ids and sort direction.
export const paneColumns = (extras: readonly ExtraColumn[]) =>
  helper.columns(
    [...paneColumnIds, ...extras.map((extra) => extra.id)].map((id) =>
      helper.accessor(() => 0, { id, sortDescFirst: !ascendingFirst.has(id) }),
    ),
  )

export type Layout = { template: string; minWidth: number }

// Filtered, the pane lists matching files from every folder below, so the folder replaces the file count.
export function paneLayout(extras: readonly ExtraColumn[], selectable: boolean, filtered: boolean): Layout {
  const widths = extras.map((extra) => extra.width)
  const parts = [
    ...(selectable ? ['40px'] : []),
    ...(filtered ? ['minmax(240px, 1fr)', 'minmax(160px, 0.7fr)'] : ['minmax(280px, 1fr)', '90px']),
    '100px',
    ...widths.map((width) => `${width}px`),
  ]
  const fixed = (selectable ? 40 : 0) + (filtered ? 400 : 370) + 100
  return { template: parts.join(' '), minWidth: widths.reduce((sum, width) => sum + width, fixed) }
}

function numberOf(id: string, extras: readonly ExtraColumn[]): ((item: Item) => number) | undefined {
  if (id === 'files') return (item) => (item.kind === 'folder' ? item.fileCount : 0)
  if (id === 'size') return (item) => item.size
  return extras.find((extra) => extra.id === id)?.value
}

// Subfolders always stay above files, so the two are sorted apart and TanStack is told the data comes sorted.
export function sortItems<T extends Item>(
  items: T[],
  [sort]: SortingState,
  extras: readonly ExtraColumn[],
  folderOf: (item: T) => string,
): T[] {
  if (sort === undefined) return items
  const sign = sort.desc ? -1 : 1
  const number = numberOf(sort.id, extras)
  const compare =
    sort.id === 'folder'
      ? (a: T, b: T) => compareNames(folderOf(a), folderOf(b))
      : number === undefined
        ? byName
        : (a: T, b: T) => number(a) - number(b)
  return [...items].sort((a, b) => sign * compare(a, b) || byName<Item>(a, b))
}

export const audioColumnIds = ['quality', 'length'] as const

export const audioColumns: ExtraColumn[] = [
  {
    id: 'quality',
    label: 'Quality',
    width: 170,
    value: (item) => item.quality,
    render: (item) => item.qualityLabel,
    title: (item) => item.qualityLabel,
  },
  {
    id: 'length',
    label: 'Length',
    width: 100,
    end: true,
    value: (item) => item.length ?? 0,
    render: (item) => (item.length ?? 0) > 0 && formatDuration(item.length ?? 0),
  },
]
