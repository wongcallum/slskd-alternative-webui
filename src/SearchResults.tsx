import './Table.css'
import {
  ArrowLeftIcon,
  CardStackPlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  InfoCircledIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
} from '@radix-ui/react-icons'
import {
  Badge,
  Box,
  Button,
  Callout,
  Checkbox,
  DataList,
  Flex,
  Heading,
  IconButton,
  Link,
  Popover,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes'
import {
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  type ExpandedStateList,
  functionalUpdate,
  type Row,
  rowExpandingFeature,
  rowSelectionFeature,
  type RowSelectionState,
  rowSortingFeature,
  type SortFn,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import {
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
  SortButton,
  stop,
  toolbarStyle,
  VirtualTable,
} from './controls'
import { formatBytes, formatDuration, formatSpeed, formatTime } from './format'
import { DelayedSpinner } from './pages'
import { formatSort, oneOf, parseSort, sortOf, textParam } from './params'
import {
  download,
  downloadsOf,
  entries,
  type FolderFetch,
  fetchFolder,
  loadResults,
  type Mark,
  openResults,
  type ResultFile,
  type ResultGroup,
  type Results,
  availability,
  viewGroups,
} from './results'
import { describeCounts, SearchState } from './Searches'
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
import { createAtom, useAtom } from './store'
import { compareNames } from './transfers'

const columnIds = ['name', 'user', 'files', 'size', 'quality', 'length', 'speed', 'queue'] as const

export const resultsSearch = v.object({
  q: textParam,
  sort: sortOf(columnIds),
  locked: oneOf(['hide', 'show'], 'hide'),
  free: oneOf(['all', 'only'], 'all'),
})

export const resultsSearchDefaults = { q: '', locked: 'hide', free: 'all' } as const

export type ResultsSearch = v.InferOutput<typeof resultsSearch>

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowSelectionFeature,
})

type Item = ResultGroup | ResultFile

type TableRow = Row<typeof features, Item>

const helper = createColumnHelper<typeof features, Item>()

const byNumber: SortFn<typeof features, Item> = (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id)

const byName: SortFn<typeof features, Item> = (a, b, id) => compareNames(a.getValue<string>(id), b.getValue<string>(id))

const columns = helper.columns([
  helper.accessor((item) => item.name, { id: 'name', sortFn: byName, sortDescFirst: false }),
  helper.accessor((item) => item.username, { id: 'user', sortFn: byName, sortDescFirst: false }),
  helper.accessor((item) => (item.kind === 'group' ? item.files.length : 0), {
    id: 'files',
    sortFn: byNumber,
    sortDescFirst: true,
  }),
  helper.accessor((item) => item.size, { id: 'size', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => item.quality, { id: 'quality', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => item.length ?? 0, { id: 'length', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => item.peer.speed, { id: 'speed', sortFn: byNumber, sortDescFirst: true }),
  helper.accessor((item) => availability(item.peer), { id: 'queue', sortFn: byNumber, sortDescFirst: false }),
])

const columnLabels: Record<(typeof columnIds)[number], string> = {
  name: 'Name',
  user: 'User',
  files: 'Files',
  size: 'Size',
  quality: 'Quality',
  length: 'Length',
  speed: 'Speed',
  queue: 'Queue',
}

const endAligned = new Set<string>(['files', 'size', 'length', 'speed', 'queue'])

const template = '40px minmax(280px, 1fr) 150px 90px 100px 160px 80px 110px 80px 96px'

const minWidth = 1186

type Expansion = { all: boolean; toggled: ExpandedStateList }

const collapsed: Expansion = { all: false, toggled: {} }

const expansions = createAtom<ReadonlyMap<string, Expansion>>(new Map())

const canSelect = (row: TableRow) =>
  row.original.kind === 'group' ? row.original.files.some((file) => !file.locked) : !row.original.locked

const countFiles = (groups: ResultGroup[]) => groups.reduce((count, group) => count + group.files.length, 0)

type Props = {
  id: string
  search: ResultsSearch
  onSearchChange: (patch: Partial<ResultsSearch>) => void
}

export function SearchResultsPage({ id, search: params, onSearchChange }: Props) {
  const { data, error, live, known } = useSearches()
  const search = data?.byId.get(id)
  const entry = useAtom(entries).get(id)
  const saved = search?.endedAt !== undefined
  useEffect(() => {
    openResults(id)
  }, [id])
  useEffect(() => {
    if (saved) void loadResults(id)
  }, [id, saved])

  let content: ReactNode
  if (search === undefined) {
    if (known) {
      content = (
        <Box p="5">
          <Heading mb="2">No such search</Heading>
          <Text as="p" color="gray" mb="3">
            It may have been deleted.
          </Text>
          <Link asChild>
            <RouterLink to="/searches">Go to Search</RouterLink>
          </Link>
        </Box>
      )
    } else if (data === undefined && error !== undefined) {
      content = (
        <Box p="4">
          <Callout.Root color="red">
            <Callout.Text>Can't load searches: {describeError(error)}. Retrying.</Callout.Text>
          </Callout.Root>
        </Box>
      )
    } else {
      content = (
        <Flex justify="center" p="6">
          <DelayedSpinner />
        </Flex>
      )
    }
    return content
  }

  if (!saved) {
    content = <Running search={search} />
  } else if (entry?.results === undefined) {
    content =
      entry?.error === undefined ? (
        <Flex justify="center" p="6">
          <DelayedSpinner />
        </Flex>
      ) : (
        <Box p="4">
          <Callout.Root color="red">
            <Callout.Text>Can't load the results: {describeError(entry.error)}</Callout.Text>
          </Callout.Root>
          <Button mt="3" variant="soft" onClick={() => void loadResults(id)}>
            Try again
          </Button>
        </Box>
      )
  } else if (entry.results.all.length === 0) {
    content = (
      <Box p="5">
        <Text color="gray">No results.</Text>
      </Box>
    )
  } else {
    content = (
      <ResultsView
        searchId={id}
        results={entry.results}
        folders={entry.folders}
        params={params}
        onSearchChange={onSearchChange}
      />
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Header search={search} known={known} live={live} error={error} />
      {content}
    </Flex>
  )
}

function Header({ search, known, live, error }: { search: Search; known: boolean; live: boolean; error: unknown }) {
  const navigate = useNavigate()
  const soulseekGate = useSoulseekGate()
  const gate = listGate(known)
  const { running } = useAtom(listActions)
  const [again, setAgain] = useState<{ busy: boolean; error?: string }>({ busy: false })

  async function searchAgain() {
    setAgain({ busy: true })
    try {
      const id = await createSearch(search.text)
      void navigate({ to: '/searches/$id', params: { id } })
      setAgain({ busy: false })
    } catch (thrown) {
      setAgain({ busy: false, error: describeError(thrown) })
    }
  }

  return (
    <Flex align="center" gap="3" px="4" py="3" flexShrink="0" style={toolbarStyle}>
      <IconButton asChild variant="ghost" color="gray" aria-label="Back to searches">
        <RouterLink to="/searches">
          <ArrowLeftIcon />
        </RouterLink>
      </IconButton>
      <Heading size="4" truncate title={search.text}>
        {search.text}
      </Heading>
      <Flex align="center" gap="3" flexShrink="0">
        <SearchState search={search} />
        <Text size="2" color="gray">
          {describeCounts(search)}
        </Text>
        <Text size="2" color="gray">
          started <Ago time={search.startedAt} />
          {search.endedAt !== undefined &&
            ` · took ${formatDuration(Math.max(0, (search.endedAt - search.startedAt) / 1000))}`}
        </Text>
      </Flex>
      <Flex ml="auto" align="center" gap="2" flexShrink="0">
        {again.error !== undefined && (
          <Text size="2" color="red">
            {again.error}
          </Text>
        )}
        {!search.isComplete && (
          <ActionButton
            label="Stop"
            busy="Stopping"
            progress={running.stop}
            gate={gate}
            onClick={() => stopSearches([search])}
          />
        )}
        <ActionButton
          label="Search again"
          busy="Searching"
          loading={again.busy}
          gate={soulseekGate}
          onClick={() => void searchAgain()}
        />
        <ActionButton
          label="Delete"
          busy="Deleting"
          color="red"
          gate={gate}
          onClick={() => {
            void deleteSearches([search])
            void navigate({ to: '/searches', replace: true })
          }}
        />
        <Box ml="2">
          <Freshness resource={searches} interval={searchPollInterval} error={error} live={live} />
        </Box>
      </Flex>
    </Flex>
  )
}

function Running({ search }: { search: Search }) {
  let message: string
  if (search.state === 'Queued') message = 'Waiting for a search slot: slskd runs 2 searches at once.'
  else if (search.isComplete) message = 'Saving the results…'
  else message = 'Results appear when the search ends. Stop it to see them now.'
  return (
    <Flex direction="column" align="center" gap="2" p="6">
      {search.state === 'InProgress' && (
        <Text size="5" weight="medium">
          {describeCounts(search)}
        </Text>
      )}
      <Text color="gray">{message}</Text>
    </Flex>
  )
}

type ViewProps = {
  searchId: string
  results: Results
  folders: ReadonlyMap<string, FolderFetch>
  params: ResultsSearch
  onSearchChange: (patch: Partial<ResultsSearch>) => void
}

function ResultsView({ searchId, results, folders, params, onSearchChange }: ViewProps) {
  const [text, setText] = useState(params.q)
  const [urlText, setUrlText] = useState(params.q)
  if (params.q !== urlText) {
    setUrlText(params.q)
    setText(params.q)
  }
  const query = useDeferredValue(text)
  const locked = params.locked === 'show'
  const free = params.free === 'only'
  const groups = useMemo(
    () => viewGroups(results, folders, { query, locked, free }),
    [results, folders, query, locked, free],
  )
  const total = useMemo(
    () => countFiles(viewGroups(results, folders, { query: '', locked, free: false })),
    [results, folders, locked],
  )
  const shown = useMemo(() => countFiles(groups), [groups])

  const expansion = useAtom(expansions).get(searchId) ?? collapsed
  // TanStack skips expansion entirely while the expanded state is empty, so "all expanded" has to be spelled out.
  const expanded = useMemo(() => {
    if (!expansion.all) return expansion.toggled
    const expanded: ExpandedStateList = {}
    for (const group of groups) expanded[group.id] = expansion.toggled[group.id] ?? true
    return expanded
  }, [groups, expansion])
  const sorting = useMemo(() => parseSort(params.sort), [params.sort])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const table = useTable({
    features,
    columns,
    data: groups,
    getRowId: (item) => item.id,
    getSubRows: (item) => (item.kind === 'group' ? item.files : undefined),
    autoResetExpanded: false,
    enableMultiSort: false,
    enableRowSelection: canSelect,
    state: { sorting, expanded, rowSelection },
    onSortingChange: (updater) =>
      onSearchChange({ sort: formatSort(functionalUpdate(updater, sorting)) as ResultsSearch['sort'] }),
    onRowSelectionChange: setRowSelection,
  })

  const selected: ResultFile[] = []
  for (const row of table.getSelectedRowModel().flatRows) {
    if (row.original.kind === 'file' && !row.original.locked) selected.push(row.original)
  }
  const selectedSize = selected.reduce((size, file) => size + file.size, 0)
  const soulseekGate = useSoulseekGate()
  const downloads = useAtom(downloadsOf(searchId))

  return (
    <>
      <Flex align="center" gap="4" px="4" py="2" flexShrink="0" style={toolbarStyle}>
        <TextField.Root
          size="2"
          placeholder="Filter by user or path"
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
        {results.locked > 0 && (
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox
                checked={locked}
                onCheckedChange={(checked) => onSearchChange({ locked: checked === true ? 'show' : 'hide' })}
              />
              Locked ({results.locked.toLocaleString()})
            </Flex>
          </Text>
        )}
        <Text as="label" size="2">
          <Flex gap="2" align="center">
            <Checkbox
              checked={free}
              onCheckedChange={(checked) => onSearchChange({ free: checked === true ? 'only' : 'all' })}
            />
            Free slot only
          </Flex>
        </Text>
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => expansions.set((current) => new Map(current).set(searchId, { all: !expansion.all, toggled: {} }))}
        >
          {expansion.all ? 'Collapse all' : 'Expand all'}
        </Button>
        {selected.length > 0 && (
          <Flex align="center" gap="2">
            <ActionButton
              label={`Download ${selected.length.toLocaleString()} (${formatBytes(selectedSize)})`}
              busy="Enqueueing"
              progress={downloads.running.download}
              gate={soulseekGate}
              onClick={() => void download(searchId, selected)}
            />
            <Button size="1" variant="ghost" color="gray" onClick={() => setRowSelection({})}>
              Clear selection
            </Button>
          </Flex>
        )}
        <Flex ml="auto" align="center" gap="4" flexShrink="0">
          <OutcomeLine atom={downloadsOf(searchId)} />
          <Text size="1" color="gray">
            {shown === total
              ? `${total.toLocaleString()} files in ${groups.length.toLocaleString()} folders`
              : `${shown.toLocaleString()} of ${total.toLocaleString()} files`}
          </Text>
        </Flex>
      </Flex>
      {groups.length === 0 ? (
        <Box p="5">
          <Text color="gray">Nothing matches.</Text>
        </Box>
      ) : (
        <ResultList
          searchId={searchId}
          table={table}
          folders={folders}
          gate={downloads.running.download ? 'Wait for the current download to be enqueued' : soulseekGate}
          folderGate={soulseekGate}
        />
      )}
    </>
  )
}

type ResultTable = ReturnType<typeof useTable<typeof features, Item>>

type ListProps = {
  searchId: string
  table: ResultTable
  folders: ReadonlyMap<string, FolderFetch>
  gate?: string
  folderGate?: string
}

function ResultList({ searchId, table, folders, gate, folderGate }: ListProps) {
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

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <DataList.Root size="1">
      {rows.map(([label, value]) => (
        <DataList.Item key={label}>
          <DataList.Label minWidth="120px">{label}</DataList.Label>
          <DataList.Value style={{ wordBreak: 'break-word' }}>{value}</DataList.Value>
        </DataList.Item>
      ))}
    </DataList.Root>
  )
}

function DetailsButton({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Popover.Root>
      <Popover.Trigger>
        <IconButton size="1" variant="ghost" color="gray" aria-label="Details">
          <InfoCircledIcon />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="480px">
        <Details rows={rows} />
      </Popover.Content>
    </Popover.Root>
  )
}

function MarkBadge({ mark }: { mark: Mark }) {
  if (mark.ok) return <Badge color="green">Enqueued</Badge>
  return (
    <Tooltip content={mark.message}>
      <Badge color="red">Failed</Badge>
    </Tooltip>
  )
}

type FileRowProps = {
  searchId: string
  file: ResultFile
  selected: boolean
  pending: boolean
  mark?: Mark
  gate?: string
  onSelect: (id: string, shiftKey: boolean) => void
}

const FileRow = memo(function FileRow({ searchId, file, selected, pending, mark, gate, onSelect }: FileRowProps) {
  const details: [string, ReactNode][] = [
    ['User', file.username],
    ['Folder', file.directory],
    ['File', file.name],
    ['Size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`],
  ]
  if (file.bitRate !== undefined) details.push(['Bitrate', `${file.bitRate} kbps`])
  if (file.isVariableBitRate !== undefined) details.push(['Variable bitrate', file.isVariableBitRate ? 'Yes' : 'No'])
  if (file.bitDepth !== undefined) details.push(['Bit depth', file.bitDepth])
  if (file.sampleRate !== undefined) details.push(['Sample rate', `${file.sampleRate.toLocaleString()} Hz`])
  if (file.length !== undefined) details.push(['Length', formatDuration(file.length)])
  details.push(
    ['Matched', file.matched ? 'Yes' : 'No, fetched with the full folder'],
    ['Locked', file.locked ? 'Yes, only shared with some users' : 'No'],
  )
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: template }}
      data-selected={selected || undefined}
      data-dimmed={file.locked || undefined}
      onMouseDown={preventShiftSelection}
      onClick={(event) => !file.locked && onSelect(file.id, event.shiftKey)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox
          checked={selected}
          disabled={file.locked}
          onClick={(event) => onSelect(file.id, event.shiftKey)}
        />
      </div>
      <Flex className="table-cell" align="center" gap="2" style={{ paddingLeft: 36 }} title={file.filename}>
        {file.locked && <LockClosedIcon style={{ flexShrink: 0 }} />}
        <Text size="2" truncate>
          {file.name}
        </Text>
        {!file.matched && <Badge color="gray">not matched</Badge>}
        {mark !== undefined && <MarkBadge mark={mark} />}
        {pending && <Spinner size="1" />}
      </Flex>
      <div className="table-cell" />
      <div className="table-cell" />
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(file.size)}
        </Text>
      </div>
      <div className="table-cell">
        <Text size="2" color="gray">
          {file.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {file.length !== undefined && formatDuration(file.length)}
        </Text>
      </div>
      <div className="table-cell" />
      <div className="table-cell" />
      <Flex className="table-cell" gap="3" align="center" justify="end" onClick={stop}>
        {!file.locked && (
          <GatedIconButton label="Download" gate={gate} onClick={() => void download(searchId, [file])}>
            <DownloadIcon />
          </GatedIconButton>
        )}
        <IconButton size="1" variant="ghost" aria-hidden tabIndex={-1} style={{ visibility: 'hidden' }}>
          <CardStackPlusIcon />
        </IconButton>
        <DetailsButton rows={details} />
      </Flex>
    </div>
  )
})

type GroupRowProps = {
  searchId: string
  group: ResultGroup
  expanded: boolean
  selected: boolean
  partial: boolean
  fetch?: FolderFetch
  gate?: string
  folderGate?: string
  onSelect: (id: string, shiftKey: boolean) => void
  onToggle: (id: string) => void
}

const GroupRow = memo(function GroupRow({
  searchId,
  group,
  expanded,
  selected,
  partial,
  fetch,
  gate,
  folderGate,
  onSelect,
  onToggle,
}: GroupRowProps) {
  const { peer } = group
  const open = group.files.filter((file) => !file.locked)
  const extra = group.files.length - group.matched
  const fetched = fetch?.files !== undefined
  const details: [string, ReactNode][] = [
    ['Folder', group.directory],
    ['User', group.username],
    ['Upload speed', formatSpeed(peer.speed)],
    ['Free upload slot', peer.free ? 'Yes' : 'No'],
    ['Queue length', peer.queueLength.toLocaleString()],
    ['Matched files', group.matched.toLocaleString()],
  ]
  if (fetched) details.push(['Fetched files', `${extra.toLocaleString()} more`])
  if (fetch?.at !== undefined) {
    details.push([fetch.error === undefined ? 'Folder fetched' : 'Folder fetch failed', formatTime(fetch.at)])
  }
  if (fetch?.error !== undefined) details.push(['Error', fetch.error])
  return (
    <div
      className="table-row table-group"
      style={{ gridTemplateColumns: template }}
      data-selected={selected || undefined}
      data-dimmed={open.length === 0 || undefined}
      onMouseDown={preventShiftSelection}
      onClick={() => onToggle(group.id)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox
          checked={selected ? true : partial ? 'indeterminate' : false}
          disabled={open.length === 0}
          onClick={(event) => onSelect(group.id, event.shiftKey)}
        />
      </div>
      <Flex className="table-cell" align="center" gap="2" title={group.directory}>
        {expanded ? <ChevronDownIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
        <Text size="2" weight="medium" truncate>
          {group.name}
        </Text>
      </Flex>
      <div className="table-cell" title={group.username}>
        <Text size="2">{group.username}</Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {group.matched.toLocaleString()}
          {fetched && ` + ${extra.toLocaleString()}`}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(group.size)}
        </Text>
      </div>
      <div className="table-cell" title={group.qualityLabel}>
        <Text size="2" color="gray">
          {group.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {group.length > 0 && formatDuration(group.length)}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatSpeed(peer.speed)}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        {peer.free ? (
          <Text size="2" color="green">
            free
          </Text>
        ) : (
          <Text size="2" color="gray">
            {peer.queueLength.toLocaleString()}
          </Text>
        )}
      </div>
      <Flex className="table-cell" gap="3" align="center" justify="end" onClick={stop}>
        {open.length > 0 && (
          <GatedIconButton label="Download folder" gate={gate} onClick={() => void download(searchId, open)}>
            <DownloadIcon />
          </GatedIconButton>
        )}
        {fetch?.pending ? (
          <Spinner size="1" />
        ) : (
          <GatedIconButton
            label={
              fetch?.error !== undefined
                ? `Couldn't get the full folder: ${fetch.error}. Try again`
                : fetched
                  ? 'Get the full folder again'
                  : 'Get the full folder'
            }
            color={fetch?.error === undefined ? undefined : 'red'}
            gate={folderGate}
            onClick={() => void fetchFolder(searchId, group)}
          >
            <CardStackPlusIcon />
          </GatedIconButton>
        )}
        <DetailsButton rows={details} />
      </Flex>
    </div>
  )
})
