import { useCallback } from 'react'

import { useAtom } from '../../lib/store'
import { collapsed, ColumnHeader, HeaderRow, rowId, toggleExpanded, useRowToggle, VirtualTable } from '../../ui/table'
import { downloadsOf, type FolderFetch } from './results'
import { FileRow, GroupRow } from './rows'
import {
  columnIds,
  columnLabels,
  endAligned,
  expansions,
  minWidth,
  type ResultTable,
  type TableRow,
  template,
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
    <HeaderRow template={template} table={table}>
      {columnIds.map((id) => (
        <ColumnHeader key={id} label={columnLabels[id]} end={endAligned.has(id)} column={table.getColumn(id)} />
      ))}
      <div />
    </HeaderRow>
  )

  function render(row: TableRow) {
    const original = row.original
    if (original.kind === 'group') {
      return (
        <GroupRow
          searchId={searchId}
          group={original}
          expanded={row.getIsExpanded()}
          selected={row.getIsAllSubRowsSelected()}
          partial={row.getIsSomeSelected()}
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
        selected={row.getIsSelected()}
        pending={pending.has(original.id)}
        mark={marks.get(original.id)}
        gate={gate}
        onSelect={onSelect}
      />
    )
  }

  return <VirtualTable minWidth={minWidth} header={header} items={rows} itemKey={rowId} renderItem={render} />
}
