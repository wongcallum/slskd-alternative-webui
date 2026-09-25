import { Flex } from '@radix-ui/themes'
import type { RowSelectionState } from '@tanstack/react-table'
import { type ReactNode, useMemo, useState } from 'react'
import * as v from 'valibot'
import { textParam } from '../lib/params'
import { useAtom } from '../lib/store'
import { ActionButton, FilterField, OutcomeLine, SelectionActions, toolbarStyle, useFilterText } from '../ui/controls'
import { Empty, Freshness, Polling } from '../ui/status'
import { NewSearch } from './NewSearch'
import {
  deleteSearches,
  listActions,
  listGate,
  type Search,
  searches,
  searchPollInterval,
  useSearches,
} from './searches'
import { SearchList, useListTable } from './SearchList'

export const searchesSearch = v.object({ q: textParam })

export const searchesSearchDefaults = { q: '' } as const

export type SearchesSearch = v.InferOutput<typeof searchesSearch>

const none: Search[] = []

type Props = {
  search: SearchesSearch
  onSearchChange: (patch: Partial<SearchesSearch>) => void
}

export function SearchesPage({ search, onSearchChange }: Props) {
  const { data, error, live, known } = useSearches()
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const list = useMemo(() => {
    const all = data?.list ?? none
    const needle = filter.query.toLowerCase()
    return needle === '' ? all : all.filter((each) => each.search.includes(needle))
  }, [data?.list, filter.query])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useListTable(list, rowSelection, setRowSelection)
  const selected = table.getSelectedRowModel().rows.map((row) => row.original)
  const gate = listGate(known)
  const { running } = useAtom(listActions)

  let content: ReactNode
  if (data === undefined) {
    content = <Polling what="searches" error={error} />
  } else if (list.length === 0) {
    content = <Empty>{data.list.length === 0 ? 'No searches yet.' : 'Nothing matches.'}</Empty>
  } else content = <SearchList table={table} gate={gate} />

  return (
    <Flex direction="column" height="100%">
      <NewSearch />
      <Flex align="center" gap="3" px="4" py="2" flexShrink="0" style={toolbarStyle}>
        <FilterField
          placeholder="Filter searches"
          value={filter.text}
          onChange={filter.change}
          style={{ width: 280 }}
        />
        {selected.length > 0 && (
          <SelectionActions count={selected.length} onClear={() => setRowSelection({})}>
            <ActionButton
              label={`Delete ${selected.length.toLocaleString()}`}
              busy="Deleting"
              color="red"
              progress={running.delete}
              gate={gate}
              onClick={() => deleteSearches(selected)}
            />
          </SelectionActions>
        )}
        <Flex ml="auto" align="center" gap="4" flexShrink="0">
          <OutcomeLine atom={listActions} />
          <Freshness resource={searches} interval={searchPollInterval} error={error} live={live} />
        </Flex>
      </Flex>
      {content}
    </Flex>
  )
}
