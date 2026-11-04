import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { Button, DropdownMenu, Flex, SegmentedControl, Text } from '@radix-ui/themes'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import { countFiles } from '../lib/files'
import { formatSpeed, plural } from '../lib/format'
import { useFrom } from '../lib/media'
import { useAtom } from '../lib/store'
import { ColumnsMenu } from '../ui/ColumnsMenu'
import { type Choices, ChoiceSelect, ConfirmButton, ConfirmDialog, disabledProps, Tip, barHeight } from '../ui/controls'
import { type ListKey, useListKeys } from '../ui/keys'
import { RowScope, useListNav } from '../ui/listNav'
import {
  ColumnHeader,
  columnsHeight,
  groupNav,
  groupState,
  HeaderRow,
  type Layout,
  rowHeight,
  stackedHeight,
  stackedThreeLineHeight,
  toggleExpanded,
  tracksFor,
  useLayout,
  useRowToggle,
  useSelectionKeys,
  virtualRowStyle,
} from '../ui/table'
import { type Columns, columnsVar, useColumns } from '../ui/widths'
import { actions, cancel, clearFinished, lookups, remove, retry } from './actions'
import { FileRow, GroupRow } from './rows'
import {
  columnLabels,
  columnsOf,
  expansions,
  type Gates,
  openSections,
  type SectionTable,
  type TableRow,
  trackLabels,
  tracks,
  twoLineBarHeight,
} from './table'
import {
  type Direction,
  type Group,
  isFailed,
  isFinished,
  isRetryable,
  isTransferring,
  type Section,
  type Show,
  type Transfer,
  type Transfers,
} from './transfers'

type RowItem = { type: 'row'; section: Section; row: TableRow }

type ListItem = { type: 'header'; section: Section } | { type: 'empty'; section: Section } | RowItem

const listKey = (item: ListItem) => (item.type === 'row' ? item.row.id : `${item.type}:${item.section}`)

const isRow = (item: ListItem): item is RowItem => item.type === 'row'

type ListProps = {
  direction: Direction
  data: Transfers
  groups: Record<Section, Group[]>
  tables: Record<Section, SectionTable>
  filtered: boolean
  selected: Transfer[]
  show: Show
  onShowChange: (show: Show) => void
  gates: Gates
}

export function TransferList(props: ListProps) {
  const { direction, data, groups, tables, filtered, selected, show, onShowChange, gates } = props
  const layout = useLayout()
  const twoLines = !useFrom('sm')
  const sectionTracks = tracksFor(tracks, layout)
  const columns = {
    active: useColumns('transfers', sectionTracks.active),
    finished: useColumns('transfers', sectionTracks.finished),
  }
  const open = useAtom(openSections[direction])
  const { pending, running } = useAtom(actions[direction])
  const lookupMap = useAtom(lookups)
  // A second retry would re-enqueue what the first hasn't reached yet, and they'd share one progress count.
  const retryGate = running.retry === undefined ? gates.soulseek : 'A retry is running'
  const activeRows = tables.active.getRowModel().rows
  const finishedRows = tables.finished.getRowModel().rows
  const items = useMemo(() => {
    const list: ListItem[] = []
    for (const [section, rows] of [
      ['active', activeRows],
      ['finished', finishedRows],
    ] as const) {
      list.push({ type: 'header', section })
      if (!open[section]) continue
      if (rows.length === 0) list.push({ type: 'empty', section })
      for (const row of rows) list.push({ type: 'row', section, row })
    }
    return list
  }, [activeRows, finishedRows, open])
  const finishedHeader = open.active ? Math.max(activeRows.length, 1) + 1 : 1
  const itemAt = useCallback((index: number) => items[index] as ListItem, [items])

  const headerHeight = (section: Section) =>
    (twoLines ? twoLineBarHeight : barHeight) + (open[section] ? columnsHeight : 0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(0)
  const onSelect = { active: useRowToggle(tables.active), finished: useRowToggle(tables.finished) }
  const onToggle = useCallback(
    (section: Section, id: string) =>
      expansions[direction].set((state) => ({ ...state, [section]: toggleExpanded(state[section], id) })),
    [direction],
  )
  const keys = { active: useSelectionKeys(tables.active), finished: useSelectionKeys(tables.finished) }
  const nav = useListNav<ListItem>({
    name: 'transfers',
    items,
    itemKey: listKey,
    isRow,
    rank: 1,
    label: direction === 'download' ? 'Downloads' : 'Uploads',
    role: 'treegrid',
    multiselectable: true,
    depth: (item) => (isRow(item) ? item.row.depth : -1),
    canToggle: (item) => isRow(item) && groupNav.canToggle(item.row),
    isOpen: (item) => isRow(item) && item.row.getIsExpanded(),
    aria: (item) => (isRow(item) ? groupNav.aria(item.row) : {}),
    onToggle: (item) => isRow(item) && onToggle(item.section, item.row.id),
    onEnter: (item) => {
      if (!isRow(item)) return
      if (item.row.original.kind === 'group') onToggle(item.section, item.row.id)
      else onSelect[item.section](item.row.id, false)
    },
    onSpace: (item, range) => isRow(item) && keys[item.section].onSpace(item.row, range),
    // Selection stays within a section, as Shift+click's does.
    onExtend: (from, to) =>
      isRow(from) && isRow(to) && from.section === to.section && keys[from.section].onExtend(from.row, to.row),
    onSelectAll: () => {
      keys.active.onSelectAll()
      keys.finished.onSelectAll()
    },
    onEscape: () => {
      const active = keys.active.onEscape()
      return keys.finished.onEscape() || active
    },
  })
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element
      nav.containerRef.current = element
    },
    [nav.containerRef],
  )
  const chosen = () => {
    if (selected.length > 0) return selected
    const item = nav.focused()
    if (item === undefined || !isRow(item)) return []
    const original = item.row.original
    return original.kind === 'group' ? original.files : [original]
  }
  const retryKey: ListKey = {
    hotkeys: ['R'],
    name: 'Retry',
    enabled: retryGate === undefined,
    run: () => {
      const files = chosen().filter((file) => isRetryable(file.state))
      if (files.length > 0) void retry(files)
    },
  }
  useListKeys(nav.containerRef, [
    ...(direction === 'download' ? [retryKey] : []),
    {
      hotkeys: ['Delete', 'Mod+Backspace'],
      name: 'Cancel, or remove what has finished',
      enabled: gates.list === undefined && running.cancel === undefined && running.remove === undefined,
      run: () => {
        const files = chosen()
        const active = files.filter((file) => !isFinished(file.state))
        const done = files.filter((file) => isFinished(file.state))
        if (active.length > 0) void cancel(direction, active)
        if (done.length > 0) void remove(direction, done)
      },
    },
  ])
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      if (index === 0) return headerHeight('active')
      if (index === finishedHeader) return headerHeight('finished')
      const item = itemAt(index)
      if (layout !== 'stacked' || item.type !== 'row') return rowHeight
      return item.row.original.kind === 'group' ? stackedThreeLineHeight : stackedHeight
    },
    // A new key function is what makes the virtualizer measure again, so a new layout has to make one.
    getItemKey: useCallback(
      (index: number) => {
        const item = itemAt(index)
        return item.type === 'row' ? item.row.id : `${item.type}:${item.section}:${open[item.section]}`
      },
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      [itemAt, open, layout, twoLines],
    ),
    overscan: 10,
    rangeExtractor: (range: Range) =>
      nav.rangeExtractor(range, (base) => {
        stickyRef.current = base.startIndex >= finishedHeader ? finishedHeader : 0
        const indexes = defaultRangeExtractor(base)
        return indexes.includes(stickyRef.current) ? indexes : [stickyRef.current, ...indexes]
      }),
  })

  function render(item: ListItem) {
    if (item.type === 'header') {
      return (
        <SectionHeader
          direction={direction}
          section={item.section}
          data={data}
          table={tables[item.section]}
          groups={groups[item.section]}
          filtered={filtered}
          show={show}
          onShowChange={onShowChange}
          gates={gates}
          columns={columns[item.section]}
          layout={layout}
          twoLines={twoLines}
          open={open[item.section]}
        />
      )
    }
    if (item.type === 'empty') {
      return (
        <Flex align="center" height="100%" px="4">
          <Text size="2" color="gray">
            {filtered || (item.section === 'finished' && show !== 'all')
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
          layout={layout}
          shown={columns[section].shown}
          {...groupState(row)}
          gate={gates.soulseek}
          onSelect={onSelect[section]}
          onToggle={onToggle}
        />
      )
    }
    return (
      <FileRow
        file={original}
        section={section}
        direction={direction}
        layout={layout}
        shown={columns[section].shown}
        selected={row.getIsSelected()}
        pending={pending.has(original.id)}
        lookup={lookupMap.get(original.id)}
        gate={gates.soulseek}
        retryGate={retryGate}
        onSelect={onSelect[section]}
      />
    )
  }

  return (
    <div ref={setRef} className="table-scroll" {...nav.containerProps}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
          minWidth: layout === 'stacked' ? 0 : Math.max(columns.active.minWidth, columns.finished.minWidth),
        }}
      >
        {virtualizer.getVirtualItems().map((virtual) => {
          const item = itemAt(virtual.index)
          return (
            <div
              key={virtual.key}
              style={{
                ...(virtual.index === stickyRef.current
                  ? { position: 'sticky', top: 0, zIndex: 1, height: virtual.size }
                  : { ...virtualRowStyle(virtual.size, virtual.start), scrollMarginTop: headerHeight(item.section) }),
                ...columnsVar(columns[item.section]),
              }}
              {...nav.rowProps(virtual.index)}
            >
              <RowScope tabbable={virtual.index === nav.stop}>{render(item)}</RowScope>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const allFiles = (groups: Group[]) => groups.flatMap((group) => group.files)

const showChoices: Choices<Show> = [
  ['all', 'All'],
  ['succeeded', 'Succeeded'],
  ['failed', 'Failed'],
  ['cancelled', 'Cancelled'],
]

// A select below md, where the segmented control doesn't fit beside the summary and the buttons.
function ShowControl({ show, onShowChange }: { show: Show; onShowChange: (show: Show) => void }) {
  const md = useFrom('md')
  if (!md) return <ChoiceSelect label="Show" size="1" soft choices={showChoices} value={show} onChange={onShowChange} />
  return (
    <SegmentedControl.Root size="1" value={show} onValueChange={(value) => onShowChange(value as Show)}>
      {showChoices.map(([value, label]) => (
        <SegmentedControl.Item key={value} value={value}>
          {label}
        </SegmentedControl.Item>
      ))}
    </SegmentedControl.Root>
  )
}

type CancelScope = 'all' | 'queued' | 'transferring'

function CancelMenu({ direction, files, gate }: { direction: Direction; files: Transfer[]; gate?: string }) {
  const { running } = useAtom(actions[direction])
  const [menuOpen, setMenuOpen] = useState(false)
  const [scope, setScope] = useState<CancelScope>('all')
  const [confirming, setConfirming] = useState(false)
  const transferring = files.filter((file) => isTransferring(file.state))
  const queued = files.filter((file) => !isTransferring(file.state))
  const chosen = { all: files, queued, transferring }
  const progress = running.cancel
  const disabled = gate !== undefined || progress !== undefined
  const choose = (next: CancelScope) => {
    setScope(next)
    setConfirming(true)
  }
  const what = { all: 'active', queued: 'queued', transferring: `${direction}ing` }
  return (
    <>
      <DropdownMenu.Root open={menuOpen} onOpenChange={(open) => setMenuOpen(open && !disabled)}>
        <Tip content={progress === undefined ? gate : undefined}>
          <DropdownMenu.Trigger>
            <Button size="1" variant="soft" color="red" {...disabledProps(disabled)}>
              {progress === undefined
                ? 'Cancel'
                : `Cancelling ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`}
              <DropdownMenu.TriggerIcon />
            </Button>
          </DropdownMenu.Trigger>
        </Tip>
        <DropdownMenu.Content size="1">
          <DropdownMenu.Item onSelect={() => choose('all')}>All ({files.length.toLocaleString()})</DropdownMenu.Item>
          <DropdownMenu.Item disabled={queued.length === 0} onSelect={() => choose('queued')}>
            Queued ({queued.length.toLocaleString()})
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled={transferring.length === 0} onSelect={() => choose('transferring')}>
            {direction === 'download' ? 'Downloading' : 'Uploading'} ({transferring.length.toLocaleString()})
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Cancel ${plural(chosen[scope].length, direction)}?`}
        description={`Every ${what[scope]} ${direction} is cancelled, including any hidden by the filter.`}
        action={`Cancel ${direction}s`}
        color="red"
        onConfirm={() => void cancel(direction, chosen[scope])}
      />
    </>
  )
}

type SectionHeaderProps = Pick<ListProps, 'direction' | 'data' | 'filtered' | 'show' | 'onShowChange' | 'gates'> & {
  section: Section
  table: SectionTable
  groups: Group[]
  columns: Columns
  layout: Layout
  twoLines: boolean
  open: boolean
}

function SectionHeader({
  direction,
  section,
  data,
  table,
  groups,
  filtered,
  show,
  onShowChange,
  gates,
  columns,
  layout,
  twoLines,
  open,
}: SectionHeaderProps) {
  const { running } = useAtom(actions[direction])
  let summary: string
  let speed: string | undefined
  if (filtered || (section === 'finished' && show !== 'all')) {
    const total = section === 'active' ? data.transferring + data.queued : data.succeeded + data.failed + data.cancelled
    summary = `${countFiles(groups).toLocaleString()} of ${total.toLocaleString()}`
  } else if (section === 'active') {
    summary = `${data.transferring.toLocaleString()} ${direction}ing, ${data.queued.toLocaleString()} queued`
    if (data.speed !== undefined && data.speed > 0) speed = formatSpeed(data.speed)
  } else {
    summary = `${data.succeeded.toLocaleString()} succeeded, ${data.failed.toLocaleString()} failed`
    if (data.cancelled > 0) summary += `, ${data.cancelled.toLocaleString()} cancelled`
  }

  const everything = allFiles(section === 'active' ? data.active : data.finished)
  const failed = everything.filter((file) => isFailed(file.state))
  const title = (
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
  )
  const counts: ReactNode = (
    <>
      <Text size="2" color="gray" truncate>
        {summary}
      </Text>
      {speed !== undefined && (
        <Text size="2" style={{ flexShrink: 0 }}>
          {speed}
        </Text>
      )}
    </>
  )
  const buttons =
    section === 'active' ? (
      <CancelMenu
        direction={direction}
        files={everything}
        gate={everything.length === 0 ? 'Nothing to cancel' : gates.list}
      />
    ) : (
      <>
        {direction === 'download' && (
          <ConfirmButton
            label="Retry failed"
            busy="Retrying"
            progress={running.retry}
            gate={failed.length === 0 ? 'Nothing has failed' : gates.soulseek}
            title={`Retry ${plural(failed.length, 'download')}?`}
            description="Every failed download is enqueued again, including any hidden by the filter, but not cancelled ones."
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
          description={`Every finished ${direction} is removed from the list, whatever its outcome, including any hidden by the filter. Files on disk aren't touched.`}
          action="Clear"
          onConfirm={() => clearFinished(direction)}
        />
      </>
    )
  const showControl = section === 'finished' && <ShowControl show={show} onShowChange={onShowChange} />
  const stacked = layout === 'stacked'
  return (
    <div className="table-section">
      {twoLines ? (
        <Flex direction="column" justify="center" px="4" height={`${twoLineBarHeight}px`}>
          <Flex align="center" gap="3" height="36px">
            {title}
            <Flex ml="auto" gap="2" align="center">
              {buttons}
            </Flex>
          </Flex>
          <Flex align="center" gap="3" height="28px" pl="5">
            {counts}
            <Flex ml="auto" flexShrink="0">
              {showControl}
            </Flex>
          </Flex>
        </Flex>
      ) : (
        <Flex align="center" gap="3" px="4" height={`${barHeight}px`}>
          {title}
          {counts}
          <Flex ml="auto" gap="2" align="center">
            {showControl}
            {buttons}
          </Flex>
        </Flex>
      )}
      {open && (
        <HeaderRow columns={columns} table={table} stacked={stacked}>
          {columnsOf(section, stacked, columns.shown).map((id) => (
            <ColumnHeader
              key={id}
              label={columnLabels[section][id]}
              end={!stacked && (id === 'size' || id === 'speed')}
              column={table.getColumn(id)}
            />
          ))}
          {!stacked && <ColumnsMenu columns={columns} labels={trackLabels[section]} />}
        </HeaderRow>
      )}
    </div>
  )
}
