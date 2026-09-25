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
import { useFrom } from '../../lib/media'
import { byName, compareNames } from '../../lib/text'
import type { Item } from '../../lib/tree'

export const paneColumnIds = ['name', 'folder', 'files', 'size'] as const

// Each view adds its own columns after the name, files or folder, and size. A wide one only shows from lg.
export type ExtraColumn = {
  id: string
  label: string
  width: number
  wide?: boolean
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

// Stacked below sm. Beside the tree, the pane drops its file count or folder column below md, and wide extras below lg.
export type PaneWidth = 'stacked' | 'narrow' | 'medium' | 'wide'

export function usePaneWidth(): PaneWidth {
  const sm = useFrom('sm')
  const md = useFrom('md')
  const lg = useFrom('lg')
  return !sm ? 'stacked' : !md ? 'narrow' : !lg ? 'medium' : 'wide'
}

export type Layout = { template: string; minWidth: number; counted: boolean; extras: readonly ExtraColumn[] }

// Filtered, the pane lists matching files from every folder below, so the folder replaces the file count.
export function paneLayout(
  allExtras: readonly ExtraColumn[],
  selectable: boolean,
  filtered: boolean,
  width: PaneWidth,
): Layout {
  const extras = width === 'wide' ? allExtras : allExtras.filter((extra) => extra.wide !== true)
  const counted = width === 'medium' || width === 'wide'
  const widths = extras.map((extra) => extra.width)
  const [name, nameWidth] = !counted
    ? ['minmax(180px, 1fr)', 180]
    : filtered
      ? ['minmax(240px, 1fr)', 240]
      : ['minmax(280px, 1fr)', 280]
  const [count, countWidth] = filtered ? ['minmax(160px, 0.7fr)', 160] : ['90px', 90]
  const parts = [
    ...(selectable ? ['40px'] : []),
    name,
    ...(counted ? [count] : []),
    '100px',
    ...widths.map((each) => `${each}px`),
  ]
  const fixed = (selectable ? 40 : 0) + nameWidth + (counted ? countWidth : 0) + 100
  return {
    template: parts.join(' '),
    minWidth: widths.reduce((sum, each) => sum + each, fixed),
    counted,
    extras,
  }
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
    wide: true,
    end: true,
    value: (item) => item.length ?? 0,
    render: (item) => (item.length ?? 0) > 0 && formatDuration(item.length ?? 0),
  },
]
