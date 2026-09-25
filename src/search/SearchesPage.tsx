import { MagnifyingGlassIcon } from '@radix-ui/react-icons'
import { Box, Button, Callout, Flex, Text, TextField } from '@radix-ui/themes'
import type { RowSelectionState } from '@tanstack/react-table'
import { type ReactNode, useDeferredValue, useMemo, useState } from 'react'
import * as v from 'valibot'
import { describeError } from '../lib/api'
import { textParam } from '../lib/params'
import { useAtom } from '../lib/store'
import { ActionButton, DelayedSpinner, Freshness, OutcomeLine, toolbarStyle } from '../ui/controls'
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
  const [text, setText] = useState(search.q)
  const [urlText, setUrlText] = useState(search.q)
  if (search.q !== urlText) {
    setUrlText(search.q)
    setText(search.q)
  }
  const query = useDeferredValue(text)
  const list = useMemo(() => {
    const all = data?.list ?? none
    const needle = query.toLowerCase()
    return needle === '' ? all : all.filter((each) => each.search.includes(needle))
  }, [data?.list, query])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useListTable(list, rowSelection, setRowSelection)
  const selected = table.getSelectedRowModel().rows.map((row) => row.original)
  const gate = listGate(known)
  const { running } = useAtom(listActions)

  let content: ReactNode
  if (data === undefined) {
    content =
      error === undefined ? (
        <Flex justify="center" p="6">
          <DelayedSpinner />
        </Flex>
      ) : (
        <Box p="4">
          <Callout.Root color="red">
            <Callout.Text>Can't load searches: {describeError(error)}. Retrying.</Callout.Text>
          </Callout.Root>
        </Box>
      )
  } else if (list.length === 0) {
    content = (
      <Box p="5">
        <Text color="gray">{data.list.length === 0 ? 'No searches yet.' : 'Nothing matches.'}</Text>
      </Box>
    )
  } else content = <SearchList table={table} gate={gate} />

  return (
    <Flex direction="column" height="100%">
      <NewSearch />
      <Flex align="center" gap="3" px="4" py="2" flexShrink="0" style={toolbarStyle}>
        <TextField.Root
          size="2"
          placeholder="Filter searches"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setUrlText(event.target.value)
            onSearchChange({ q: event.target.value })
          }}
          style={{ width: 280 }}
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
        {selected.length > 0 && (
          <Flex align="center" gap="2">
            <Text size="2" color="gray">
              {selected.length.toLocaleString()} selected
            </Text>
            <ActionButton
              label={`Delete ${selected.length.toLocaleString()}`}
              busy="Deleting"
              color="red"
              progress={running.delete}
              gate={gate}
              onClick={() => deleteSearches(selected)}
            />
            <Button size="1" variant="ghost" color="gray" onClick={() => setRowSelection({})}>
              Clear selection
            </Button>
          </Flex>
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
