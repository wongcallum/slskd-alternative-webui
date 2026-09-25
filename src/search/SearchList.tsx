import { StopIcon, TrashIcon } from '@radix-ui/react-icons'
import { Checkbox, Flex, Link, Spinner, Text } from '@radix-ui/themes'
import {
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { Link as RouterLink } from '@tanstack/react-router'
import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import { useAtom } from '../lib/store'
import { Ago, GatedIconButton } from '../ui/controls'
import { preventShiftSelection, stop, VirtualTable } from '../ui/table'
import { deleteSearches, listActions, type Search, stopSearches } from './searches'
import { SearchState } from './SearchState'

const features = tableFeatures({ rowSelectionFeature })

const template = '40px 130px minmax(240px, 1fr) 110px 170px 110px 76px'

const minWidth = 1000

export function useListTable(
  data: Search[],
  rowSelection: RowSelectionState,
  onRowSelectionChange: (updater: Updater<RowSelectionState>) => void,
) {
  return useTable({
    features,
    columns: [],
    data,
    getRowId: (each) => each.id,
    state: { rowSelection },
    onRowSelectionChange,
  })
}

export function SearchList({ table, gate }: { table: ReturnType<typeof useListTable>; gate?: string }) {
  const { pending } = useAtom(listActions)
  const rows = table.getRowModel().rows
  const tableRef = useRef(table)
  useLayoutEffect(() => {
    tableRef.current = table
  })
  const onSelect = useCallback((id: string, shiftKey: boolean) => {
    const row = tableRef.current.getRow(id, true)
    row.getToggleSelectedHandler()({ shiftKey, target: { checked: !row.getIsSelected() } })
  }, [])
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])

  const header = (
    <div className="table-row table-columns" style={{ gridTemplateColumns: template, height: '100%' }}>
      <div className="table-cell table-check">
        <Checkbox
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
          onClick={() => table.toggleAllRowsSelected()}
        />
      </div>
      {['State', 'Search', 'Responses', 'Files', 'Started'].map((label) => (
        <div
          key={label}
          className="table-cell table-label"
          data-align={label === 'Responses' || label === 'Files' ? 'end' : undefined}
        >
          {label}
        </div>
      ))}
      <div />
    </div>
  )

  return (
    <VirtualTable
      minWidth={minWidth}
      header={header}
      count={rows.length}
      getItemKey={getItemKey}
      renderRow={(index) => {
        const row = rows[index]
        return (
          row && (
            <SearchRow
              search={row.original}
              selected={row.getIsSelected()}
              pending={pending.has(row.original.id)}
              gate={gate}
              onSelect={onSelect}
            />
          )
        )
      }}
    />
  )
}

type SearchRowProps = {
  search: Search
  selected: boolean
  pending: boolean
  gate?: string
  onSelect: (id: string, shiftKey: boolean) => void
}

const SearchRow = memo(function SearchRow({ search, selected, pending, gate, onSelect }: SearchRowProps) {
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: template }}
      data-selected={selected || undefined}
      onMouseDown={preventShiftSelection}
      onClick={(event) => onSelect(search.id, event.shiftKey)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox checked={selected} onClick={(event) => onSelect(search.id, event.shiftKey)} />
      </div>
      <Flex className="table-cell" align="center" gap="2">
        <SearchState search={search} />
        {pending && <Spinner size="1" />}
      </Flex>
      <div className="table-cell" title={search.text}>
        <Link asChild size="2" weight="medium">
          <RouterLink to="/searches/$id" params={{ id: search.id }} onClick={stop}>
            {search.text}
          </RouterLink>
        </Link>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {search.responses.toLocaleString()}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {search.files.toLocaleString()}
          {search.locked > 0 && ` + ${search.locked.toLocaleString()} locked`}
        </Text>
      </div>
      <div className="table-cell">
        <Text size="2" color="gray">
          <Ago time={search.startedAt} />
        </Text>
      </div>
      <Flex className="table-cell" gap="3" align="center" justify="end" onClick={stop}>
        {!search.isComplete && (
          <GatedIconButton label="Stop" gate={gate} onClick={() => stopSearches([search])}>
            <StopIcon />
          </GatedIconButton>
        )}
        <GatedIconButton label="Delete" gate={gate} onClick={() => deleteSearches([search])}>
          <TrashIcon />
        </GatedIconButton>
      </Flex>
    </div>
  )
})
