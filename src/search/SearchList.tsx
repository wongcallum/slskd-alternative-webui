import { StopIcon, TrashIcon } from '@radix-ui/react-icons'
import { Flex, Link, Spinner } from '@radix-ui/themes'
import {
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { Link as RouterLink } from '@tanstack/react-router'
import { memo } from 'react'
import { useAtom } from '../lib/store'
import { GatedIconButton } from '../ui/controls'
import { Ago } from '../ui/status'
import {
  ActionsCell,
  Cell,
  CheckCell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  rowId,
  stop,
  useRowToggle,
  VirtualTable,
} from '../ui/table'
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
  const onSelect = useRowToggle(table)

  const header = (
    <HeaderRow template={template} table={table}>
      <ColumnHeader label="State" />
      <ColumnHeader label="Search" />
      <ColumnHeader label="Responses" end />
      <ColumnHeader label="Files" end />
      <ColumnHeader label="Started" />
      <div />
    </HeaderRow>
  )

  return (
    <VirtualTable
      minWidth={minWidth}
      header={header}
      items={rows}
      itemKey={rowId}
      renderItem={(row) => (
        <SearchRow
          search={row.original}
          selected={row.getIsSelected()}
          pending={pending.has(row.original.id)}
          gate={gate}
          onSelect={onSelect}
        />
      )}
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
    <GridRow template={template} selected={selected} onClick={(event) => onSelect(search.id, event.shiftKey)}>
      <CheckCell selected={selected} onToggle={(shiftKey) => onSelect(search.id, shiftKey)} />
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
      <Cell end>{search.responses.toLocaleString()}</Cell>
      <Cell end>
        {search.files.toLocaleString()}
        {search.locked > 0 && ` + ${search.locked.toLocaleString()} locked`}
      </Cell>
      <Cell>
        <Ago time={search.startedAt} />
      </Cell>
      <ActionsCell>
        {!search.isComplete && (
          <GatedIconButton label="Stop" gate={gate} onClick={() => stopSearches([search])}>
            <StopIcon />
          </GatedIconButton>
        )}
        <GatedIconButton label="Delete" gate={gate} onClick={() => deleteSearches([search])}>
          <TrashIcon />
        </GatedIconButton>
      </ActionsCell>
    </GridRow>
  )
})
