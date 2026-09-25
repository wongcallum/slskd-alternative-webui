import { Checkbox } from '@radix-ui/themes'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useAtom } from '../../lib/store'
import { SortButton, VirtualTable } from '../../ui/table'
import { downloadsOf, type FolderFetch } from './results'
import { FileRow, GroupRow } from './rows'
import {
  collapsed,
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
  const tableRef = useRef(table)
  useLayoutEffect(() => {
    tableRef.current = table
  })
  const onSelect = useCallback((id: string, shiftKey: boolean) => {
    const row = tableRef.current.getRow(id, true)
    const selected = row.subRows.length > 0 ? row.getIsAllSubRowsSelected() : row.getIsSelected()
    row.getToggleSelectedHandler({ deselectParents: true })({ shiftKey, target: { checked: !selected } })
  }, [])
  const onToggle = useCallback(
    (id: string) =>
      expansions.set((current) => {
        const expansion = current.get(searchId) ?? collapsed
        const open = !(expansion.toggled[id] ?? expansion.all)
        return new Map(current).set(searchId, { ...expansion, toggled: { ...expansion.toggled, [id]: open } })
      }),
    [searchId],
  )
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])

  const header = (
    <div className="table-row table-columns" style={{ gridTemplateColumns: template, height: '100%' }}>
      <div className="table-cell table-check">
        <Checkbox
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
          onClick={() => table.toggleAllRowsSelected()}
        />
      </div>
      {columnIds.map((id) => {
        const column = table.getColumn(id)
        return (
          <div key={id} className="table-cell" data-align={endAligned.has(id) ? 'end' : undefined}>
            <SortButton
              label={columnLabels[id]}
              sorted={column?.getIsSorted()}
              onClick={column?.getToggleSortingHandler()}
            />
          </div>
        )
      })}
      <div />
    </div>
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

  return (
    <VirtualTable
      minWidth={minWidth}
      header={header}
      count={rows.length}
      getItemKey={getItemKey}
      renderRow={(index) => {
        const row = rows[index]
        return row && render(row)
      }}
    />
  )
}
