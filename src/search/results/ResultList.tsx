import { useCallback } from 'react'

import { browses, loadedShares, useShareList } from '../../browse/browse'
import { useAtom } from '../../lib/store'
import { useListKeys } from '../../ui/keys'
import { useListNav } from '../../ui/listNav'
import {
  collapsed,
  ColumnHeader,
  groupNav,
  groupState,
  HeaderRow,
  rowHeight,
  rowId,
  toggleExpanded,
  useLayout,
  useRowToggle,
  useSelectionKeys,
  VirtualTable,
} from '../../ui/table'
import { download, downloadsOf, type FolderFetch } from './results'
import { FileRow, GroupRow } from './rows'
import {
  columnLabels,
  columnsOf,
  endAligned,
  expansions,
  minWidths,
  type ResultTable,
  selectedFiles,
  stackedSize,
  type TableRow,
  templates,
} from './table'

type Props = {
  searchId: string
  table: ResultTable
  folders: ReadonlyMap<string, FolderFetch>
  gate?: string
  folderGate?: string
  onHide: (username: string) => void
}

export function ResultList({ searchId, table, folders, gate, folderGate, onHide }: Props) {
  const { pending, marks } = useAtom(downloadsOf(searchId))
  const { records } = useShareList()
  const memory = useAtom(loadedShares)
  const running = useAtom(browses)
  const layout = useLayout()
  const stacked = layout === 'stacked'
  const rows = table.getRowModel().rows
  const onSelect = useRowToggle(table)
  const onToggle = useCallback(
    (id: string) =>
      expansions.set((current) =>
        new Map(current).set(searchId, toggleExpanded(current.get(searchId) ?? collapsed, id)),
      ),
    [searchId],
  )
  const selection = useSelectionKeys(table)
  const nav = useListNav({
    name: 'results',
    items: rows,
    itemKey: rowId,
    rank: 1,
    label: 'Results',
    ...groupNav,
    ...selection,
    onToggle: (row) => onToggle(row.id),
    onEnter: (row) => (row.original.kind === 'group' ? onToggle(row.id) : selection.onSpace(row, false)),
  })
  useListKeys(nav.containerRef, [
    {
      hotkeys: ['D'],
      name: 'Download',
      enabled: gate === undefined,
      run: () => {
        const selected = selectedFiles(table)
        if (selected.length > 0) {
          void download(searchId, selected).then(() => table.setRowSelection({}))
          return
        }
        const focused = nav.focused()?.original
        const files = focused?.kind === 'group' ? focused.files : focused === undefined ? [] : [focused]
        const open = files.filter((file) => !file.locked)
        if (open.length > 0) void download(searchId, open)
      },
    },
  ])

  const header = (
    <HeaderRow template={stacked ? '' : templates[layout]} table={table} stacked={stacked}>
      {columnsOf(layout).map((id) => (
        <ColumnHeader
          key={id}
          label={columnLabels[id]}
          end={!stacked && endAligned.has(id)}
          column={table.getColumn(id)}
        />
      ))}
      {!stacked && <div />}
    </HeaderRow>
  )

  function render(row: TableRow) {
    const original = row.original
    if (original.kind === 'group') {
      const fetch = folders.get(original.id)
      return (
        <GroupRow
          searchId={searchId}
          group={original}
          layout={layout}
          {...groupState(row)}
          fetch={fetch}
          cached={records.has(original.username) || memory.get(original.username)?.status === 'ready'}
          browsing={fetch?.pending ? running.get(original.username) : undefined}
          gate={gate}
          folderGate={folderGate}
          onSelect={onSelect}
          onToggle={onToggle}
          onHide={onHide}
        />
      )
    }
    return (
      <FileRow
        searchId={searchId}
        rowId={row.id}
        file={original}
        layout={layout}
        selected={row.getIsSelected()}
        pending={pending.has(original.id)}
        mark={marks.get(original.id)}
        gate={gate}
        onSelect={onSelect}
      />
    )
  }

  return (
    <VirtualTable
      minWidth={minWidths[layout]}
      header={header}
      items={rows}
      itemKey={rowId}
      rowSize={stacked ? stackedSize : rowHeight}
      nav={nav}
      renderItem={render}
    />
  )
}
