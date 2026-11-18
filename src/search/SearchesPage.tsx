import { Flex } from '@radix-ui/themes'
import type { RowSelectionState } from '@tanstack/react-table'
import { type ReactNode, useMemo, useState } from 'react'

import type { SearchProps } from '../lib/params'
import { useAtom } from '../lib/store'
import { queryMatcher } from '../lib/text'
import {
  ActionButton,
  FilterField,
  OutcomeLine,
  SelectionActions,
  Toolbar,
  ToolbarEnd,
  useFilterText,
} from '../ui/controls'
import { Empty, Freshness, Polling } from '../ui/status'
import { NewSearch } from './NewSearch'
import type { SearchesSearch } from './params'
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

const none: Search[] = []

type Props = SearchProps<SearchesSearch>

export function SearchesPage({ search, onSearchChange }: Props) {
  const { data, error, live, known } = useSearches()
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const list = useMemo(() => {
    const all = data?.list ?? none
    const matches = queryMatcher(filter.query)
    return matches === undefined ? all : all.filter((each) => matches(each.search))
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
      <Toolbar>
        <FilterField
          placeholder="Filter searches"
          value={filter.text}
          onChange={filter.change}
          width="280px"
          list="searches"
        />
        {selected.length > 0 && (
          <SelectionActions count={selected.length} onClear={() => setRowSelection({})}>
            <ActionButton
              label={`Delete ${selected.length.toLocaleString()}`}
              busy="Deleting"
              color="red"
              progress={running.delete}
              gate={gate}
              shortcut={{ key: 'Delete', name: 'Delete' }}
              onClick={() => deleteSearches(selected)}
            />
          </SelectionActions>
        )}
        <ToolbarEnd>
          <OutcomeLine atom={listActions} />
          <Freshness resource={searches} interval={searchPollInterval} live={live} />
        </ToolbarEnd>
      </Toolbar>
      {content}
    </Flex>
  )
}
