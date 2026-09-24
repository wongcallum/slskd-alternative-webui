import './Transfers.css'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Cross2Icon,
  InfoCircledIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  ReloadIcon,
} from '@radix-ui/react-icons'
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Checkbox,
  DataList,
  Flex,
  IconButton,
  Popover,
  Progress,
  SegmentedControl,
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
  type SortingState,
  tableFeatures,
  type Updater,
  useTable,
} from '@tanstack/react-table'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import { memo, type ReactNode, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as v from 'valibot'
import { describeError } from './api'
import { formatAge, formatBytes, formatProgress, formatSpeed, formatTime, toTime, useAgo } from './format'
import { DelayedSpinner } from './pages'
import { useSoulseekGate } from './soulseek'
import { type Atom, createAtom, isStale, type Resource, useAtom, useFreshness, useResource, useStale } from './store'
import {
  actions,
  cancel,
  clearFinished,
  dismissOutcome,
  type Lookup,
  lookUpPositions,
  lookups,
  type Progress as ActionProgress,
  remove,
  retry,
} from './transferActions'
import {
  compareNames,
  countFiles,
  type Direction,
  filterGroups,
  type Group,
  isFailed,
  isFinished,
  isTransferring,
  pollInterval,
  type Section,
  type Transfer,
  type Transfers,
  transfers,
} from './transfers'

const columnIds = {
  active: ['name', 'user', 'status', 'size', 'speed', 'time'],
  finished: ['name', 'user', 'status', 'size', 'time'],
} as const

type ColumnId = (typeof columnIds.active)[number]

const sortValues = <const T extends string>(ids: readonly T[]) =>
  ids.flatMap((id) => [`${id}.asc`, `${id}.desc`] as const)

const oneOf = <const T extends string>(options: readonly T[], fallback: NoInfer<T>) =>
  v.optional(v.fallback(v.picklist(options), fallback), fallback)

export const transfersSearch = v.object({
  q: v.optional(v.fallback(v.string(), ''), ''),
  show: oneOf(['all', 'succeeded', 'failed'], 'all'),
  activeSort: v.fallback(v.optional(v.picklist(sortValues(columnIds.active))), undefined),
  finishedSort: v.fallback(v.optional(v.picklist(sortValues(columnIds.finished))), undefined),
})

export const transfersSearchDefaults = { q: '', show: 'all' } as const

export type TransfersSearch = v.InferOutput<typeof transfersSearch>

const parseSort = (value: string | undefined): SortingState => {
  if (value === undefined) return []
  const [id = '', direction] = value.split('.')
  return [{ id, desc: direction === 'desc' }]
}

const formatSort = ([sort]: SortingState) => sort && `${sort.id}.${sort.desc ? 'desc' : 'asc'}`

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowSelectionFeature,
})

type Item = Group | Transfer

type TableRow = Row<typeof features, Item>

const helper = createColumnHelper<typeof features, Item>()

const byNumber: SortFn<typeof features, Item> = (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id)

const byName: SortFn<typeof features, Item> = (a, b, id) => compareNames(a.getValue<string>(id), b.getValue<string>(id))

const fraction = (item: Item) => (item.size > 0 ? item.bytesTransferred / item.size : 0)

const speedOf = (item: Item) =>
  item.kind === 'group' ? item.speed : isTransferring(item.state) ? item.averageSpeed : 0

function timeOf(section: Section, item: Item) {
  if (item.kind === 'group') return item.time
  const at = section === 'active' ? item.requestedAt : item.endedAt
  return at === undefined ? 0 : toTime(at)
}

function statusOf(section: Section, item: Item) {
  if (section === 'active') return fraction(item)
  return item.kind === 'group' ? item.failed : isFailed(item.state) ? 1 : 0
}

const columnsFor = (section: Section) =>
  helper.columns([
    helper.accessor((item) => item.name, { id: 'name', sortFn: byName, sortDescFirst: false }),
    helper.accessor((item) => item.username, { id: 'user', sortFn: byName, sortDescFirst: false }),
    helper.accessor((item) => statusOf(section, item), { id: 'status', sortFn: byNumber, sortDescFirst: true }),
    helper.accessor((item) => item.size, { id: 'size', sortFn: byNumber, sortDescFirst: true }),
    ...(section === 'active' ? [helper.accessor(speedOf, { id: 'speed', sortFn: byNumber, sortDescFirst: true })] : []),
    helper.accessor((item) => timeOf(section, item), { id: 'time', sortFn: byNumber, sortDescFirst: true }),
  ])

const columns = { active: columnsFor('active'), finished: columnsFor('finished') }

const columnLabels: Record<Section, Record<ColumnId, string>> = {
  active: { name: 'Name', user: 'User', status: 'Status', size: 'Size', speed: 'Speed', time: 'Requested' },
  finished: { name: 'Name', user: 'User', status: 'Status', size: 'Size', speed: 'Speed', time: 'Ended' },
}

const templates: Record<Section, string> = {
  active: '40px minmax(240px, 1fr) 160px 280px 170px 110px 90px 76px',
  finished: '40px minmax(240px, 1fr) 160px 280px 170px 200px 76px',
}

const minWidth = 1166
const rowHeight = 36
const barHeight = 44
const columnsHeight = 32

type Expansion = Record<Section, ExpandedStateList>

const expansions: Record<Direction, Atom<Expansion>> = {
  download: createAtom<Expansion>({ active: {}, finished: {} }),
  upload: createAtom<Expansion>({ active: {}, finished: {} }),
}

const openSections: Record<Direction, Atom<Record<Section, boolean>>> = {
  download: createAtom<Record<Section, boolean>>({ active: true, finished: true }),
  upload: createAtom<Record<Section, boolean>>({ active: true, finished: true }),
}

// Active groups start expanded and finished ones collapsed, so only toggles are stored.
const expandedByDefault = (section: Section) => section === 'active'

const noGroups: Group[] = []

const allFiles = (groups: Group[]) => groups.flatMap((group) => group.files)

const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`

type Props = {
  direction: Direction
  search: TransfersSearch
  onSearchChange: (patch: Partial<TransfersSearch>) => void
}

export function TransfersPage({ direction, search, onSearchChange }: Props) {
  const resource = transfers[direction]
  const { data, error } = useResource(resource)
  const [text, setText] = useState(search.q)
  const [urlText, setUrlText] = useState(search.q)
  if (search.q !== urlText) {
    setUrlText(search.q)
    setText(search.q)
  }
  const query = useDeferredValue(text)
  const active = useMemo(() => filterGroups(data?.active ?? noGroups, query, 'all'), [data?.active, query])
  const finished = useMemo(
    () => filterGroups(data?.finished ?? noGroups, query, search.show),
    [data?.finished, query, search.show],
  )
  const expansion = useAtom(expansions[direction])
  const [activeSelection, setActiveSelection] = useState<RowSelectionState>({})
  const [finishedSelection, setFinishedSelection] = useState<RowSelectionState>({})
  const activeTable = useSectionTable(
    'active',
    active,
    search.activeSort,
    expansion.active,
    activeSelection,
    setActiveSelection,
    (value) => onSearchChange({ activeSort: value as TransfersSearch['activeSort'] }),
  )
  const finishedTable = useSectionTable(
    'finished',
    finished,
    search.finishedSort,
    expansion.finished,
    finishedSelection,
    setFinishedSelection,
    (value) => onSearchChange({ finishedSort: value as TransfersSearch['finishedSort'] }),
  )

  const stale = useStale(resource, pollInterval)
  const soulseekGate = useSoulseekGate()
  const listGate = stale ? 'The list is out of date' : undefined
  const gates = useMemo(() => ({ list: listGate, soulseek: listGate ?? soulseekGate }), [listGate, soulseekGate])

  const selected: Transfer[] = []
  for (const table of [activeTable, finishedTable]) {
    for (const row of table.getSelectedRowModel().flatRows)
      if (row.original.kind === 'file') selected.push(row.original)
  }

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
            <Callout.Text>
              Can't load {direction}s: {describeError(error)}. Retrying.
            </Callout.Text>
          </Callout.Root>
        </Box>
      )
  } else if (data.active.length === 0 && data.finished.length === 0) {
    content = (
      <Box p="5">
        <Text color="gray">No {direction}s.</Text>
      </Box>
    )
  } else {
    content = (
      <TransferList
        direction={direction}
        data={data}
        active={active}
        finished={finished}
        activeTable={activeTable}
        finishedTable={finishedTable}
        filtered={query !== ''}
        show={search.show}
        onShowChange={(show) => onSearchChange({ show })}
        gates={gates}
      />
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Toolbar
        direction={direction}
        resource={resource}
        error={data === undefined ? undefined : error}
        text={text}
        onTextChange={(value) => {
          setText(value)
          setUrlText(value)
          onSearchChange({ q: value })
        }}
        selected={selected}
        onClearSelection={() => {
          setActiveSelection({})
          setFinishedSelection({})
        }}
        gates={gates}
      />
      {content}
    </Flex>
  )
}

function useSectionTable(
  section: Section,
  data: Group[],
  sort: string | undefined,
  toggled: ExpandedStateList,
  rowSelection: RowSelectionState,
  onRowSelectionChange: (updater: Updater<RowSelectionState>) => void,
  onSortChange: (value: string | undefined) => void,
) {
  const sorting = useMemo(() => parseSort(sort), [sort])
  // TanStack skips expansion entirely while the expanded state is empty, so defaults have to be spelled out.
  const expanded = useMemo(() => {
    if (!expandedByDefault(section)) return toggled
    const expanded: ExpandedStateList = {}
    for (const group of data) expanded[group.id] = toggled[group.id] ?? true
    return expanded
  }, [section, data, toggled])
  return useTable({
    features,
    columns: columns[section],
    data,
    getRowId: (item) => item.id,
    getSubRows: (item) => (item.kind === 'group' ? item.files : undefined),
    autoResetExpanded: false,
    enableMultiSort: false,
    state: { sorting, expanded, rowSelection },
    onSortingChange: (updater) => onSortChange(formatSort(functionalUpdate(updater, sorting))),
    onRowSelectionChange,
  })
}

type SectionTable = ReturnType<typeof useSectionTable>

type Gates = { list?: string; soulseek?: string }

type ListItem =
  | { type: 'header'; section: Section }
  | { type: 'empty'; section: Section }
  | { type: 'row'; section: Section; row: TableRow }

type ListProps = {
  direction: Direction
  data: Transfers
  active: Group[]
  finished: Group[]
  activeTable: SectionTable
  finishedTable: SectionTable
  filtered: boolean
  show: TransfersSearch['show']
  onShowChange: (show: TransfersSearch['show']) => void
  gates: Gates
}

function TransferList(props: ListProps) {
  const { direction, activeTable, finishedTable, gates } = props
  const open = useAtom(openSections[direction])
  const { pending } = useAtom(actions[direction])
  const lookupMap = useAtom(lookups)
  const activeRows = activeTable.getRowModel().rows
  const finishedRows = finishedTable.getRowModel().rows
  const activeCount = open.active ? Math.max(activeRows.length, 1) : 0
  const finishedHeader = activeCount + 1
  const finishedCount = open.finished ? Math.max(finishedRows.length, 1) : 0

  const itemAt = useCallback(
    (index: number): ListItem => {
      if (index === 0) return { type: 'header', section: 'active' }
      if (index === finishedHeader) return { type: 'header', section: 'finished' }
      const [section, rows, offset] =
        index < finishedHeader
          ? (['active', activeRows, 1] as const)
          : (['finished', finishedRows, finishedHeader + 1] as const)
      const row = rows[index - offset]
      return row === undefined ? { type: 'empty', section } : { type: 'row', section, row }
    },
    [activeRows, finishedRows, finishedHeader],
  )

  const headerHeight = (section: Section) => barHeight + (open[section] ? columnsHeight : 0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(0)
  const virtualizer = useVirtualizer({
    count: finishedHeader + 1 + finishedCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      index === 0 ? headerHeight('active') : index === finishedHeader ? headerHeight('finished') : rowHeight,
    getItemKey: useCallback(
      (index: number) => {
        const item = itemAt(index)
        return item.type === 'row' ? item.row.id : `${item.type}:${item.section}:${open[item.section]}`
      },
      [itemAt, open],
    ),
    overscan: 10,
    rangeExtractor: useCallback(
      (range: Range) => {
        stickyRef.current = range.startIndex >= finishedHeader ? finishedHeader : 0
        const indexes = defaultRangeExtractor(range)
        return indexes.includes(stickyRef.current) ? indexes : [stickyRef.current, ...indexes]
      },
      [finishedHeader],
    ),
  })

  const tables = useRef({ active: activeTable, finished: finishedTable })
  useLayoutEffect(() => {
    tables.current = { active: activeTable, finished: finishedTable }
  })
  const onSelect = useCallback((section: Section, id: string, shiftKey: boolean) => {
    const row = tables.current[section].getRow(id, true)
    const selected = row.subRows.length > 0 ? row.getIsAllSubRowsSelected() : row.getIsSelected()
    row.getToggleSelectedHandler({ deselectParents: true })({ shiftKey, target: { checked: !selected } })
  }, [])
  const onToggle = useCallback(
    (section: Section, id: string) =>
      expansions[direction].set((state) => ({
        ...state,
        [section]: { ...state[section], [id]: !(state[section][id] ?? expandedByDefault(section)) },
      })),
    [direction],
  )

  function render(item: ListItem) {
    if (item.type === 'header') return <SectionHeader {...props} section={item.section} open={open[item.section]} />
    if (item.type === 'empty') {
      return (
        <Flex align="center" height="100%" px="4">
          <Text size="2" color="gray">
            {props.filtered || (item.section === 'finished' && props.show !== 'all')
              ? 'Nothing matches.'
              : item.section === 'active'
                ? `Nothing ${direction === 'download' ? 'downloading' : 'uploading'} or queued.`
                : 'Nothing finished.'}
          </Text>
        </Flex>
      )
    }
    const { row, section } = item
    const original = row.original
    if (original.kind === 'group') {
      return (
        <GroupRow
          group={original}
          direction={direction}
          expanded={row.getIsExpanded()}
          selected={row.getIsAllSubRowsSelected()}
          partial={row.getIsSomeSelected()}
          gate={gates.soulseek}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      )
    }
    return (
      <FileRow
        file={original}
        section={section}
        direction={direction}
        selected={row.getIsSelected()}
        pending={pending.has(original.id)}
        lookup={lookupMap.get(original.id)}
        gate={gates.soulseek}
        onSelect={onSelect}
      />
    )
  }

  return (
    <div ref={scrollRef} className="transfer-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
        {virtualizer.getVirtualItems().map((virtual) => (
          <div
            key={virtual.key}
            style={
              virtual.index === stickyRef.current
                ? { position: 'sticky', top: 0, zIndex: 1, height: virtual.size }
                : {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtual.size,
                    transform: `translateY(${virtual.start}px)`,
                  }
            }
          >
            {render(itemAt(virtual.index))}
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionHeader({
  direction,
  data,
  active,
  finished,
  activeTable,
  finishedTable,
  filtered,
  show,
  onShowChange,
  gates,
  section,
  open,
}: ListProps & { section: Section; open: boolean }) {
  const { running } = useAtom(actions[direction])
  const table = section === 'active' ? activeTable : finishedTable
  const groups = section === 'active' ? active : finished
  let summary: string
  if (filtered || (section === 'finished' && show !== 'all')) {
    const total = section === 'active' ? data.transferring + data.queued : data.succeeded + data.failed
    summary = `${countFiles(groups).toLocaleString()} of ${total.toLocaleString()}`
  } else if (section === 'active') {
    summary = `${data.transferring.toLocaleString()} ${direction}ing · ${data.queued.toLocaleString()} queued`
    if (data.speed > 0) summary += ` · ${formatSpeed(data.speed)}`
  } else summary = `${data.succeeded.toLocaleString()} succeeded · ${data.failed.toLocaleString()} failed`

  const everything = allFiles(section === 'active' ? data.active : data.finished)
  const failed = everything.filter((file) => isFailed(file.state))
  return (
    <div className="transfer-section">
      <Flex align="center" gap="3" px="3" height={`${barHeight}px`}>
        <Button
          variant="ghost"
          color="gray"
          onClick={() => openSections[direction].set((state) => ({ ...state, [section]: !state[section] }))}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <Text weight="bold" size="3">
            {section === 'active' ? 'Active' : 'Finished'}
          </Text>
        </Button>
        <Text size="2" color="gray">
          {summary}
        </Text>
        <Flex ml="auto" gap="2" align="center">
          {section === 'active' ? (
            <ConfirmButton
              label="Cancel all"
              busy="Cancelling"
              color="red"
              progress={running.cancel}
              gate={everything.length === 0 ? `Nothing to cancel` : gates.list}
              title={`Cancel ${plural(everything.length, direction)}?`}
              description={`Every active ${direction} is cancelled, including any hidden by the filter.`}
              action={`Cancel ${direction}s`}
              onConfirm={() => cancel(direction, everything)}
            />
          ) : (
            <>
              <SegmentedControl.Root
                size="1"
                value={show}
                onValueChange={(value) => onShowChange(value as typeof show)}
              >
                <SegmentedControl.Item value="all">All</SegmentedControl.Item>
                <SegmentedControl.Item value="succeeded">Succeeded</SegmentedControl.Item>
                <SegmentedControl.Item value="failed">Failed</SegmentedControl.Item>
              </SegmentedControl.Root>
              {direction === 'download' && (
                <ConfirmButton
                  label="Retry failed"
                  busy="Retrying"
                  progress={running.retry}
                  gate={failed.length === 0 ? 'Nothing has failed' : gates.soulseek}
                  title={`Retry ${plural(failed.length, 'download')}?`}
                  description="Every failed download is enqueued again, including any hidden by the filter."
                  action="Retry"
                  onConfirm={() => retry(failed)}
                />
              )}
              <ConfirmButton
                label="Clear finished"
                busy="Clearing"
                progress={running.clear}
                gate={everything.length === 0 ? 'Nothing has finished' : gates.list}
                title={`Clear ${plural(everything.length, `finished ${direction}`)}?`}
                description={`Every finished ${direction} is removed from the list, succeeded and failed, including any hidden by the filter. Files on disk aren't touched.`}
                action="Clear"
                onConfirm={() => clearFinished(direction)}
              />
            </>
          )}
        </Flex>
      </Flex>
      {open && (
        <div
          className="transfer-row transfer-columns"
          style={{ gridTemplateColumns: templates[section], height: columnsHeight }}
        >
          <div className="transfer-cell transfer-check">
            <Checkbox
              checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
              onClick={() => table.toggleAllRowsSelected()}
            />
          </div>
          {columnIds[section].map((id) => {
            const column = table.getColumn(id)
            const sorted = column?.getIsSorted()
            return (
              <div key={id} className="transfer-cell" data-align={id === 'size' || id === 'speed' ? 'end' : undefined}>
                <button type="button" className="transfer-sort" onClick={column?.getToggleSortingHandler()}>
                  {columnLabels[section][id]}
                  {sorted === 'asc' ? <ArrowUpIcon /> : sorted === 'desc' ? <ArrowDownIcon /> : null}
                </button>
              </div>
            )
          })}
          <div />
        </div>
      )}
    </div>
  )
}

type Color = 'gray' | 'green' | 'red' | 'blue' | 'amber'

const stateLabels: Record<string, [string, Color]> = {
  Requested: ['Requested', 'gray'],
  'Queued, Locally': ['Queued locally', 'gray'],
  'Queued, Remotely': ['Queued remotely', 'gray'],
  Initializing: ['Initializing', 'gray'],
  InProgress: ['In progress', 'blue'],
  'Completed, Succeeded': ['Succeeded', 'green'],
  'Completed, Cancelled': ['Cancelled', 'red'],
  'Completed, TimedOut': ['Timed out', 'red'],
  'Completed, Errored': ['Errored', 'red'],
  'Completed, Rejected': ['Rejected', 'red'],
  'Completed, Aborted': ['Aborted', 'red'],
}

function describeState({ state, attempts }: Transfer): [string, Color] {
  const [label, color] = stateLabels[state] ?? [state, 'gray']
  return [label, color === 'gray' && attempts > 1 ? 'amber' : color]
}

// Clicks on controls inside a row mustn't also select or expand it, and React bubbles clicks out of portals too.
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

const preventShiftSelection = (event: { shiftKey: boolean; preventDefault: () => void }) => {
  if (event.shiftKey) event.preventDefault()
}

function Ago({ time }: { time: number }) {
  return <span title={formatTime(time)}>{useAgo(time)}</span>
}

function Bar({ value }: { value: number }) {
  return (
    <Flex align="center" gap="2" flexGrow="1" minWidth="0">
      <Progress value={value * 100} size="1" style={{ flex: 1 }} />
      <Text size="1" color="gray">
        {Math.floor(value * 100)}%
      </Text>
    </Flex>
  )
}

type FileRowProps = {
  file: Transfer
  section: Section
  direction: Direction
  selected: boolean
  pending: boolean
  lookup?: Lookup
  gate?: string
  onSelect: (section: Section, id: string, shiftKey: boolean) => void
}

const FileRow = memo(function FileRow({
  file,
  section,
  direction,
  selected,
  pending,
  lookup,
  gate,
  onSelect,
}: FileRowProps) {
  const time = timeOf(section, file)
  return (
    <div
      className="transfer-row"
      style={{ gridTemplateColumns: templates[section] }}
      data-selected={selected || undefined}
      onMouseDown={preventShiftSelection}
      onClick={(event) => onSelect(section, file.id, event.shiftKey)}
    >
      <div className="transfer-cell transfer-check" onClick={stop}>
        <Checkbox checked={selected} onClick={(event) => onSelect(section, file.id, event.shiftKey)} />
      </div>
      <div className="transfer-cell" style={{ paddingLeft: 36 }} title={file.filename}>
        <Text size="2">{file.name}</Text>
      </div>
      <div className="transfer-cell" />
      <div className="transfer-cell">
        <FileStatus file={file} direction={direction} pending={pending} lookup={lookup} />
      </div>
      <div className="transfer-cell" data-align="end">
        <Text size="2" color="gray">
          {section === 'active' && file.bytesTransferred > 0
            ? formatProgress(file.bytesTransferred, file.size)
            : formatBytes(file.size)}
        </Text>
      </div>
      {section === 'active' && (
        <div className="transfer-cell" data-align="end">
          <Text size="2" color="gray">
            {isTransferring(file.state) && formatSpeed(file.averageSpeed)}
          </Text>
        </div>
      )}
      <div className="transfer-cell">
        <Text size="2" color="gray">
          {time > 0 && <Ago time={time} />}
        </Text>
      </div>
      <Flex className="transfer-cell" gap="1" align="center" justify="end" onClick={stop}>
        {direction === 'download' && isFailed(file.state) && (
          <GatedIconButton label="Retry" gate={gate} onClick={() => retry([file])}>
            <ReloadIcon />
          </GatedIconButton>
        )}
        {direction === 'download' && file.state === 'Queued, Remotely' && (
          <GatedIconButton label="Check queue position" gate={gate} onClick={() => lookUpPositions([file])}>
            <ListBulletIcon />
          </GatedIconButton>
        )}
        <Popover.Root>
          <Popover.Trigger>
            <IconButton size="1" variant="ghost" color="gray" aria-label="Details">
              <InfoCircledIcon />
            </IconButton>
          </Popover.Trigger>
          <Popover.Content width="480px">
            <FileDetails file={file} direction={direction} />
          </Popover.Content>
        </Popover.Root>
      </Flex>
    </div>
  )
})

function FileStatus({
  file,
  direction,
  pending,
  lookup,
}: {
  file: Transfer
  direction: Direction
  pending: boolean
  lookup?: Lookup
}) {
  if (file.state === 'InProgress') return <Bar value={fraction(file)} />
  const [label, color] = describeState(file)
  const place = lookup?.place ?? file.placeInQueue
  return (
    <Flex align="center" gap="2">
      {file.exception === undefined ? (
        <Text size="2" color={color}>
          {label}
        </Text>
      ) : (
        <Tooltip content={file.exception}>
          <Text size="2" color={color}>
            {label}
          </Text>
        </Tooltip>
      )}
      {file.state === 'Queued, Remotely' &&
        lookup?.pending !== true &&
        lookup?.error === undefined &&
        place !== undefined && (
          <Text size="1" color="gray">
            #{place}
            {lookup?.at !== undefined && (
              <>
                {' · '}
                <Ago time={lookup.at} />
              </>
            )}
          </Text>
        )}
      {lookup?.error !== undefined && lookup.pending === false && file.state === 'Queued, Remotely' && (
        <Tooltip content={lookup.error}>
          <Text size="1" color="red">
            lookup failed
          </Text>
        </Tooltip>
      )}
      {direction === 'download' && file.attempts > 1 && (
        <Text size="1" color="gray">
          attempt {file.attempts}
        </Text>
      )}
      {(pending || lookup?.pending === true) && <Spinner size="1" />}
    </Flex>
  )
}

function FileDetails({ file, direction }: { file: Transfer; direction: Direction }) {
  const rows: [string, ReactNode][] = [
    ['User', file.username],
    ['Folder', file.directory],
    ['File', file.name],
    ['Size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`],
    ['State', file.state],
    ['Requested', formatTime(toTime(file.requestedAt))],
  ]
  if (file.enqueuedAt !== undefined) rows.push(['Enqueued', formatTime(toTime(file.enqueuedAt))])
  if (file.startedAt !== undefined) rows.push(['Started', formatTime(toTime(file.startedAt))])
  if (file.endedAt !== undefined) rows.push(['Ended', formatTime(toTime(file.endedAt))])
  rows.push(['Transferred', formatBytes(file.bytesTransferred)], ['Average speed', formatSpeed(file.averageSpeed)])
  if (file.placeInQueue !== undefined) rows.push(['Place in queue', file.placeInQueue])
  if (direction === 'download') rows.push(['Attempts', file.attempts])
  if (file.exception !== undefined) rows.push(['Error', file.exception])
  if (file.batchId !== undefined) rows.push(['Batch', file.batchId])
  rows.push(['ID', file.id])
  return (
    <DataList.Root size="1">
      {rows.map(([label, value]) => (
        <DataList.Item key={label}>
          <DataList.Label minWidth="110px">{label}</DataList.Label>
          <DataList.Value style={{ wordBreak: 'break-word' }}>{value}</DataList.Value>
        </DataList.Item>
      ))}
    </DataList.Root>
  )
}

type GroupRowProps = {
  group: Group
  direction: Direction
  expanded: boolean
  selected: boolean
  partial: boolean
  gate?: string
  onSelect: (section: Section, id: string, shiftKey: boolean) => void
  onToggle: (section: Section, id: string) => void
}

const GroupRow = memo(function GroupRow({
  group,
  direction,
  expanded,
  selected,
  partial,
  gate,
  onSelect,
  onToggle,
}: GroupRowProps) {
  const { section, folder } = group
  const queued = direction === 'download' ? group.files.filter((file) => file.state === 'Queued, Remotely') : []
  const done = `${folder.succeeded.toLocaleString()}/${folder.total.toLocaleString()} done`
  return (
    <div
      className="transfer-row transfer-group"
      style={{ gridTemplateColumns: templates[section] }}
      data-selected={selected || undefined}
      onMouseDown={preventShiftSelection}
      onClick={() => onToggle(section, group.id)}
    >
      <div className="transfer-cell transfer-check" onClick={stop}>
        <Checkbox
          checked={selected ? true : partial ? 'indeterminate' : false}
          onClick={(event) => onSelect(section, group.id, event.shiftKey)}
        />
      </div>
      <Flex className="transfer-cell" align="center" gap="2" title={group.directory}>
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <Text size="2" weight="medium" truncate>
          {group.name}
        </Text>
        <Text size="1" color="gray">
          {group.files.length.toLocaleString()}
        </Text>
      </Flex>
      <div className="transfer-cell" title={group.username}>
        <Text size="2">{group.username}</Text>
      </div>
      <Flex className="transfer-cell" align="center" gap="2">
        {section === 'active' && <Bar value={fraction(group)} />}
        <Text size="1" color="gray" style={{ flexShrink: 0 }}>
          {done}
        </Text>
        {folder.failed > 0 && (
          <Text size="1" color="red" style={{ flexShrink: 0 }}>
            {folder.failed.toLocaleString()} failed
          </Text>
        )}
      </Flex>
      <div className="transfer-cell" data-align="end">
        <Text size="2" color="gray">
          {section === 'active' && group.bytesTransferred > 0
            ? formatProgress(group.bytesTransferred, group.size)
            : formatBytes(group.size)}
        </Text>
      </div>
      {section === 'active' && (
        <div className="transfer-cell" data-align="end">
          <Text size="2" color="gray">
            {group.speed > 0 && formatSpeed(group.speed)}
          </Text>
        </div>
      )}
      <div className="transfer-cell">
        <Text size="2" color="gray">
          {group.time > 0 && <Ago time={group.time} />}
        </Text>
      </div>
      <Flex className="transfer-cell" gap="1" align="center" justify="end" onClick={stop}>
        {queued.length > 0 && (
          <GatedIconButton label="Check queue positions" gate={gate} onClick={() => lookUpPositions(queued)}>
            <ListBulletIcon />
          </GatedIconButton>
        )}
      </Flex>
    </div>
  )
})

function GatedIconButton({
  label,
  gate,
  onClick,
  children,
}: {
  label: string
  gate?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip content={gate ?? label}>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        aria-label={label}
        aria-disabled={gate !== undefined || undefined}
        data-disabled={gate !== undefined || undefined}
        onClick={() => gate === undefined && onClick()}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}

type ActionButtonProps = {
  label: string
  busy: string
  progress?: ActionProgress
  gate?: string
  color?: 'red'
  onClick: () => void
}

function ActionButton({ label, busy, progress, gate, color, onClick }: ActionButtonProps) {
  const disabled = gate !== undefined || progress !== undefined
  const button = (
    <Button
      size="1"
      variant="soft"
      color={color}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      onClick={() => !disabled && onClick()}
    >
      {progress === undefined
        ? label
        : `${busy} ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`}
    </Button>
  )
  return gate === undefined || progress !== undefined ? button : <Tooltip content={gate}>{button}</Tooltip>
}

function ConfirmButton({
  title,
  description,
  action,
  onConfirm,
  ...button
}: Omit<ActionButtonProps, 'onClick'> & { title: string; description: string; action: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <ActionButton {...button} onClick={() => setOpen(true)} />
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{description}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Back
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color={button.color} onClick={onConfirm}>
              {action}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}

type ToolbarProps = {
  direction: Direction
  resource: Resource<Transfers>
  error: unknown
  text: string
  onTextChange: (value: string) => void
  selected: Transfer[]
  onClearSelection: () => void
  gates: Gates
}

function Toolbar({ direction, resource, error, text, onTextChange, selected, onClearSelection, gates }: ToolbarProps) {
  const { running } = useAtom(actions[direction])
  const retryable = direction === 'download' ? selected.filter((file) => isFailed(file.state)) : []
  const cancellable = selected.filter((file) => !isFinished(file.state))
  const removable = selected.filter((file) => isFinished(file.state))
  return (
    <Flex align="center" gap="3" px="4" py="2" flexShrink="0" style={{ boxShadow: 'inset 0 -1px 0 0 var(--gray-a5)' }}>
      <TextField.Root
        size="2"
        placeholder="Filter by user or path"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
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
          {direction === 'download' && (
            <ActionButton
              label={`Retry ${retryable.length.toLocaleString()}`}
              busy="Retrying"
              progress={running.retry}
              gate={retryable.length === 0 ? 'Nothing selected has failed' : gates.soulseek}
              onClick={() => retry(retryable)}
            />
          )}
          <ActionButton
            label={`Cancel ${cancellable.length.toLocaleString()}`}
            busy="Cancelling"
            color="red"
            progress={running.cancel}
            gate={cancellable.length === 0 ? 'Nothing selected is active' : gates.list}
            onClick={() => cancel(direction, cancellable)}
          />
          <ActionButton
            label={`Remove ${removable.length.toLocaleString()}`}
            busy="Removing"
            progress={running.remove}
            gate={removable.length === 0 ? 'Nothing selected has finished' : gates.list}
            onClick={() => remove(direction, removable)}
          />
          <Button size="1" variant="ghost" color="gray" onClick={onClearSelection}>
            Clear selection
          </Button>
        </Flex>
      )}
      <Flex ml="auto" align="center" gap="4" flexShrink="0">
        <OutcomeLine direction={direction} />
        <Freshness resource={resource} error={error} />
      </Flex>
    </Flex>
  )
}

function OutcomeLine({ direction }: { direction: Direction }) {
  const { outcome } = useAtom(actions[direction])
  if (outcome === undefined) return null
  const color = outcome.failed ? 'red' : 'gray'
  return (
    <Flex align="center" gap="1">
      {outcome.details.length === 0 ? (
        <Text size="2" color={color}>
          {outcome.summary}
        </Text>
      ) : (
        <Popover.Root>
          <Popover.Trigger>
            <Button size="1" variant="ghost" color={color}>
              {outcome.summary}
            </Button>
          </Popover.Trigger>
          <Popover.Content width="480px" maxHeight="360px">
            <Flex direction="column" gap="1">
              {outcome.details.map((detail, index) => (
                <Text key={index} size="1" style={{ wordBreak: 'break-word' }}>
                  {detail}
                </Text>
              ))}
            </Flex>
          </Popover.Content>
        </Popover.Root>
      )}
      <IconButton size="1" variant="ghost" color="gray" aria-label="Dismiss" onClick={() => dismissOutcome(direction)}>
        <Cross2Icon />
      </IconButton>
    </Flex>
  )
}

function Freshness({ resource, error }: { resource: Resource<Transfers>; error: unknown }) {
  const age = useFreshness(resource)
  const stale = isStale(age, resource.getInterval() ?? pollInterval)
  return (
    <Flex align="center" gap="2">
      {error !== undefined && (
        <Tooltip content={describeError(error)}>
          <Text size="1" color="red">
            Last poll failed
          </Text>
        </Tooltip>
      )}
      <Text size="1" color={stale ? 'amber' : 'gray'}>
        {age === undefined ? 'not loaded yet' : `updated ${formatAge(age)} ago`}
      </Text>
    </Flex>
  )
}
