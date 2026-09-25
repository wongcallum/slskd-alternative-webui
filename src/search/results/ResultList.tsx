import { useCallback } from 'react'

import { useAtom } from '../../lib/store'
import {
  collapsed,
  ColumnHeader,
  groupState,
  HeaderRow,
  rowHeight,
  rowId,
  toggleExpanded,
  useLayout,
  useRowToggle,
  VirtualTable,
} from '../../ui/table'
import { downloadsOf, type FolderFetch } from './results'
import { FileRow, GroupRow } from './rows'
import {
  columnLabels,
  columnsOf,
  endAligned,
  expansions,
  minWidths,
  type ResultTable,
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
}

export function ResultList({ searchId, table, folders, gate, folderGate }: Props) {
  const { pending, marks } = useAtom(downloadsOf(searchId))
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
      return (
        <GroupRow
          searchId={searchId}
          group={original}
          layout={layout}
          {...groupState(row)}
          fetch={folders.get(original.id)}
          gate={gate}
          folderGate={folderGate}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      )
    }
    return (
      <FileRow
        searchId={searchId}
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
      renderItem={render}
    />
  )
}
