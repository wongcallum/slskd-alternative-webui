import './Table.css'
import { MagnifyingGlassIcon, StopIcon, TrashIcon } from '@radix-ui/react-icons'
import { Box, Button, Callout, Checkbox, Flex, Link, Spinner, Text, TextField, Tooltip } from '@radix-ui/themes'
import {
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import {
  type FormEvent,
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as v from 'valibot'
import { describeError } from './api'
import {
  ActionButton,
  Ago,
  Freshness,
  GatedIconButton,
  OutcomeLine,
  preventShiftSelection,
  stop,
  toolbarStyle,
  VirtualTable,
} from './controls'
import { DelayedSpinner } from './pages'
import { textParam } from './params'
import {
  createSearch,
  deleteSearches,
  listActions,
  listGate,
  type Search,
  searches,
  searchPollInterval,
  stopSearches,
  useSearches,
} from './searches'
import { useSoulseekGate } from './soulseek'
import { useAtom } from './store'

export const searchesSearch = v.object({ q: textParam })

export const searchesSearchDefaults = { q: '' } as const

export type SearchesSearch = v.InferOutput<typeof searchesSearch>

type Color = 'gray' | 'green' | 'red' | 'blue'

const stateLabels: Record<string, [string, Color, string?]> = {
  None: ['Requested', 'gray'],
  Requested: ['Requested', 'gray'],
  Queued: ['Queued', 'gray', 'Waiting for a slot: slskd runs 2 searches at once'],
  InProgress: ['Searching', 'blue'],
  'Completed, TimedOut': ['Finished', 'green', 'Ended once responses stopped arriving'],
  'Completed, ResponseLimitReached': ['Response limit', 'green', 'Ended at the response limit'],
  'Completed, FileLimitReached': ['File limit', 'green', 'Ended at the file limit'],
  'Completed, Cancelled': ['Stopped', 'gray'],
  'Completed, Errored': ['Errored', 'red', "slskd couldn't finish it, for example because Soulseek disconnected"],
}

export function SearchState({ search }: { search: Search }) {
  const [label, color, hint] = stateLabels[search.state] ?? [search.state, 'gray']
  const text = (
    <Text size="2" color={color}>
      {label}
    </Text>
  )
  return hint === undefined ? text : <Tooltip content={hint}>{text}</Tooltip>
}

export function describeCounts(search: Search) {
  let counts = `${search.responses.toLocaleString()} responses · ${search.files.toLocaleString()} files`
  if (search.locked > 0) counts += ` · ${search.locked.toLocaleString()} locked`
  return counts
}

const features = tableFeatures({ rowSelectionFeature })

const template = '40px 130px minmax(240px, 1fr) 110px 170px 110px 76px'

const minWidth = 1000

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

function NewSearch() {
  const navigate = useNavigate()
  const gate = useSoulseekGate()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const searchText = text.trim()
    if (gate !== undefined || busy || searchText === '') return
    setBusy(true)
    setError(undefined)
    try {
      const id = await createSearch(searchText)
      if (mounted.current) void navigate({ to: '/searches/$id', params: { id } })
    } catch (thrown) {
      if (!mounted.current) return
      setError(describeError(thrown))
      setBusy(false)
    }
  }

  return (
    <Box px="4" pt="4" pb="3" flexShrink="0">
      <form onSubmit={(event) => void submit(event)}>
        <Flex gap="2" align="center">
          <TextField.Root
            size="3"
            placeholder="Search Soulseek"
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            style={{ width: 520 }}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon />
            </TextField.Slot>
            {busy && (
              <TextField.Slot>
                <Spinner />
              </TextField.Slot>
            )}
          </TextField.Root>
          <Button
            size="3"
            type="submit"
            aria-disabled={gate !== undefined || busy || undefined}
            data-disabled={gate !== undefined || busy || undefined}
          >
            Search
          </Button>
        </Flex>
      </form>
      {(error ?? gate) !== undefined && (
        <Text as="p" size="2" mt="2" color={error === undefined ? 'gray' : 'red'}>
          {error ?? gate}
        </Text>
      )}
    </Box>
  )
}

function useListTable(
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

function SearchList({ table, gate }: { table: ReturnType<typeof useListTable>; gate?: string }) {
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
