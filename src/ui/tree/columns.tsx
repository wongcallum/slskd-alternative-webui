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
import { sortOf, textParam } from '../../lib/params'
import { byName, compareNames } from '../../lib/text'
import type { Item } from '../../lib/tree'
import { fixed, growing, sized, type Track } from '../widths'

const paneColumnIds = ['name', 'folder', 'files', 'size'] as const

export const treeSearch = <const T extends string>(extraIds: readonly T[]) => ({
  path: textParam,
  q: textParam,
  sort: sortOf([...paneColumnIds, ...extraIds]),
})

export const treeSearchDefaults = { path: '', q: '' } as const

// Each view adds its own columns after the name, files or folder, and size. A wide one only shows from lg, and a narrow
// width applies below md.
export type ExtraColumn = {
  id: string
  label: string
  width: number
  narrowWidth?: number
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

type PaneWidth = 'stacked' | 'narrow' | 'medium' | 'wide'

export function usePaneWidth(): PaneWidth {
  const sm = useFrom('sm')
  const md = useFrom('md')
  const lg = useFrom('lg')
  return !sm ? 'stacked' : !md ? 'narrow' : !lg ? 'medium' : 'wide'
}

export type Layout = { tracks: readonly Track[]; counted: boolean; extras: readonly ExtraColumn[] }

// Filtered, the pane lists matching files from every folder below, so the folder replaces the file count.
export function paneLayout(
  allExtras: readonly ExtraColumn[],
  selectable: boolean,
  filtered: boolean,
  width: PaneWidth,
): Layout {
  const extras = width === 'wide' ? allExtras : allExtras.filter((extra) => extra.wide !== true)
  const counted = width === 'medium' || width === 'wide'
  const tracks = [
    ...(selectable ? [fixed(40)] : []),
    growing('name', !counted ? 180 : filtered ? 240 : 280),
    ...(counted ? [filtered ? growing('folder', 160, 0.7) : sized('files', 90)] : []),
    sized('size', 100),
    ...extras.map((extra) => sized(extra.id, counted ? extra.width : (extra.narrowWidth ?? extra.width))),
    // The columns menu, since there's no actions column to put it in.
    fixed(40),
  ]
  return { tracks, counted, extras }
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
    narrowWidth: 140,
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
