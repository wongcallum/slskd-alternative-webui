import { StopIcon, TrashIcon } from '@radix-ui/react-icons'
import { Flex, Link, Spinner } from '@radix-ui/themes'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import {
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { memo } from 'react'

import { useAtom } from '../lib/store'
import { GatedIconButton } from '../ui/controls'
import { useListKeys } from '../ui/keys'
import { useListNav, useRowTabIndex } from '../ui/listNav'
import { Ago } from '../ui/status'
import {
  ActionsCell,
  Cell,
  CheckCell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  type Layout,
  type LayoutTracks,
  Parts,
  rowHeight,
  rowId,
  rowSelected,
  StackedRow,
  stackedHeight,
  stop,
  tracksFor,
  useListLayout,
  useRowToggle,
  useSelectionKeys,
  VirtualTable,
} from '../ui/table'
import { fixed, growing, sized, useColumns } from '../ui/widths'
import { deleteSearches, listActions, type Search, stopSearches } from './searches'
import { describeCounts, SearchState } from './SearchState'

const features = tableFeatures({ rowSelectionFeature })

const tracks: LayoutTracks = {
  wide: [
    fixed(40),
    sized('state', 130),
    growing('search', 240),
    sized('responses', 110),
    sized('files', 170),
    sized('started', 110),
    fixed(76),
  ],
  medium: [
    fixed(40),
    sized('state', 110),
    growing('search', 200),
    sized('files', 150),
    sized('started', 100),
    fixed(76),
  ],
}

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
  const { pending, running } = useAtom(listActions)
  // Two stops or deletes at once would share one progress count and outcome.
  const rowGate =
    gate ??
    (running.stop !== undefined || running.delete !== undefined ? 'Another stop or delete is running' : undefined)
  const rows = table.getRowModel().rows
  const onSelect = useRowToggle(table)
  const layout = useListLayout()
  const columns = useColumns('searches', tracksFor(tracks, layout))
  const navigate = useNavigate()
  const nav = useListNav({
    name: 'searches',
    items: rows,
    itemKey: rowId,
    rank: 1,
    label: 'Searches',
    aria: rowSelected,
    onEnter: (row) => void navigate({ to: '/searches/$id', params: { id: row.original.id } }),
    ...useSelectionKeys(table),
  })
  useListKeys(nav.containerRef, [
    {
      hotkeys: ['Delete', 'Mod+Backspace'],
      name: 'Delete',
      enabled: rowGate === undefined,
      run: () => {
        const selected = table.getSelectedRowModel().rows.map((row) => row.original)
        const focused = nav.focused()?.original
        if (selected.length > 0) void deleteSearches(selected)
        else if (focused !== undefined) void deleteSearches([focused])
      },
    },
  ])

  const header = (
    <HeaderRow columns={columns} table={table} stacked={layout === 'stacked'}>
      {layout !== 'stacked' && <ColumnHeader label="State" />}
      <ColumnHeader label="Search" />
      {layout === 'wide' && <ColumnHeader label="Responses" end />}
      {layout !== 'stacked' && (
        <>
          <ColumnHeader label="Files" end />
          <ColumnHeader label="Started" />
          <div />
        </>
      )}
    </HeaderRow>
  )

  return (
    <VirtualTable
      columns={layout === 'stacked' ? undefined : columns}
      header={header}
      items={rows}
      itemKey={rowId}
      rowSize={layout === 'stacked' ? stackedHeight : rowHeight}
      nav={nav}
      renderItem={(row) => (
        <SearchRow
          search={row.original}
          layout={layout}
          selected={row.getIsSelected()}
          pending={pending.has(row.original.id)}
          gate={rowGate}
          onSelect={onSelect}
        />
      )}
    />
  )
}

type SearchRowProps = {
  search: Search
  layout: Layout
  selected: boolean
  pending: boolean
  gate?: string
  onSelect: (id: string, shiftKey: boolean) => void
}

const SearchRow = memo(function SearchRow({ search, layout, selected, pending, gate, onSelect }: SearchRowProps) {
  const check = (
    <CheckCell
      label={`Select ${search.text}`}
      selected={selected}
      onToggle={(shiftKey) => onSelect(search.id, shiftKey)}
    />
  )
  const state = (
    <>
      <SearchState search={search} size={layout === 'stacked' ? '1' : '2'} />
      {pending && <Spinner size="1" />}
    </>
  )
  const tabIndex = useRowTabIndex()
  const link = (
    <Link asChild size="2" weight="medium" truncate>
      <RouterLink to="/searches/$id" params={{ id: search.id }} tabIndex={tabIndex} onClick={stop}>
        {search.text}
      </RouterLink>
    </Link>
  )
  const actions = (
    <>
      {!search.isComplete && (
        <GatedIconButton label="Stop" gate={gate} onClick={() => stopSearches([search])}>
          <StopIcon />
        </GatedIconButton>
      )}
      <GatedIconButton label="Delete" gate={gate} onClick={() => deleteSearches([search])}>
        <TrashIcon />
      </GatedIconButton>
    </>
  )
  const onClick = (event: { shiftKey: boolean }) => onSelect(search.id, event.shiftKey)
  if (layout === 'stacked') {
    return (
      <StackedRow
        selected={selected}
        check={check}
        title={link}
        meta={
          <Parts
            items={[
              <Flex key="state" align="center" gap="2">
                {state}
              </Flex>,
              describeCounts(search),
              <Ago key="started" time={search.startedAt} />,
            ]}
          />
        }
        actions={actions}
        onClick={onClick}
      />
    )
  }
  return (
    <GridRow selected={selected} onClick={onClick}>
      {check}
      <Flex className="table-cell" align="center" gap="2">
        {state}
      </Flex>
      <div className="table-cell" title={search.text}>
        {link}
      </div>
      {layout === 'wide' && <Cell end>{search.responses.toLocaleString()}</Cell>}
      <Cell end>
        {search.files.toLocaleString()}
        {search.locked > 0 && ` + ${search.locked.toLocaleString()} locked`}
      </Cell>
      <Cell>
        <Ago time={search.startedAt} />
      </Cell>
      <ActionsCell>{actions}</ActionsCell>
    </GridRow>
  )
})
