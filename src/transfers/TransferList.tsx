import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { Button, Flex, SegmentedControl, Text } from '@radix-ui/themes'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useCallback, useRef } from 'react'

import { countFiles } from '../lib/files'
import { formatSpeed, plural } from '../lib/format'
import { useFrom } from '../lib/media'
import { useAtom } from '../lib/store'
import { type Choices, ChoiceSelect, ConfirmButton } from '../ui/controls'
import {
  ColumnHeader,
  columnsHeight,
  HeaderRow,
  type Layout,
  rowHeight,
  stackedHeight,
  stackedHeight3,
  toggleExpanded,
  useLayout,
  useRowToggle,
  virtualRowStyle,
} from '../ui/table'
import { actions, cancel, clearFinished, lookups, retry } from './actions'
import { FileRow, GroupRow } from './rows'
import {
  barHeight,
  columnLabels,
  columnsOf,
  expansions,
  type Gates,
  minWidths,
  openSections,
  type SectionTable,
  type TableRow,
  templates,
  twoLineBarHeight,
} from './table'
import { type Direction, type Group, isFailed, type Section, type Show, type Transfers } from './transfers'

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
  show: Show
  onShowChange: (show: Show) => void
  gates: Gates
}

export function TransferList(props: ListProps) {
  const { direction, activeTable, finishedTable, gates } = props
  const layout = useLayout()
  const twoLines = !useFrom('sm')
  const open = useAtom(openSections[direction])
  const { pending, running } = useAtom(actions[direction])
  const lookupMap = useAtom(lookups)
  // A second retry would re-enqueue what the first hasn't reached yet, and they'd share one progress count.
  const retryGate = running.retry === undefined ? gates.soulseek : 'A retry is running'
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

  const headerHeight = (section: Section) =>
    (twoLines ? twoLineBarHeight : barHeight) + (open[section] ? columnsHeight : 0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(0)
  const virtualizer = useVirtualizer({
    count: finishedHeader + 1 + finishedCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      if (index === 0) return headerHeight('active')
      if (index === finishedHeader) return headerHeight('finished')
      const item = itemAt(index)
      if (layout !== 'stacked' || item.type !== 'row') return rowHeight
      return item.row.original.kind === 'group' ? stackedHeight3 : stackedHeight
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
    rangeExtractor: useCallback(
      (range: Range) => {
        stickyRef.current = range.startIndex >= finishedHeader ? finishedHeader : 0
        const indexes = defaultRangeExtractor(range)
        return indexes.includes(stickyRef.current) ? indexes : [stickyRef.current, ...indexes]
      },
      [finishedHeader],
    ),
  })

  const onSelect = { active: useRowToggle(activeTable), finished: useRowToggle(finishedTable) }
  const onToggle = useCallback(
    (section: Section, id: string) =>
      expansions[direction].set((state) => ({ ...state, [section]: toggleExpanded(state[section], id) })),
    [direction],
  )

  function render(item: ListItem) {
    if (item.type === 'header') {
      return (
        <SectionHeader
          {...props}
          layout={layout}
          twoLines={twoLines}
          section={item.section}
          open={open[item.section]}
        />
      )
    }
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
          layout={layout}
          expanded={row.getIsExpanded()}
          selected={row.getIsAllSubRowsSelected()}
          partial={row.getIsSomeSelected()}
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
    <div ref={scrollRef} className="table-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: minWidths[layout] }}>
        {virtualizer.getVirtualItems().map((virtual) => (
          <div
            key={virtual.key}
            style={
              virtual.index === stickyRef.current
                ? { position: 'sticky', top: 0, zIndex: 1, height: virtual.size }
                : virtualRowStyle(virtual.size, virtual.start)
            }
          >
            {render(itemAt(virtual.index))}
          </div>
        ))}
      </div>
    </div>
  )
}

const allFiles = (groups: Group[]) => groups.flatMap((group) => group.files)

const shows: Choices<Show> = [
  ['all', 'All'],
  ['succeeded', 'Succeeded'],
  ['failed', 'Failed'],
  ['cancelled', 'Cancelled'],
]

// A select below md, where the segmented control doesn't fit beside the summary and the buttons.
function ShowControl({ show, onShowChange }: { show: Show; onShowChange: (show: Show) => void }) {
  const md = useFrom('md')
  if (!md) return <ChoiceSelect label="Show" size="1" soft choices={shows} value={show} onChange={onShowChange} />
  return (
    <SegmentedControl.Root size="1" value={show} onValueChange={(value) => onShowChange(value as Show)}>
      {shows.map(([value, label]) => (
        <SegmentedControl.Item key={value} value={value}>
          {label}
        </SegmentedControl.Item>
      ))}
    </SegmentedControl.Root>
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
  layout,
  twoLines,
  section,
  open,
}: ListProps & { layout: Layout; twoLines: boolean; section: Section; open: boolean }) {
  const { running } = useAtom(actions[direction])
  const table = section === 'active' ? activeTable : finishedTable
  const groups = section === 'active' ? active : finished
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
        <Flex direction="column" justify="center" px="3" height={`${twoLineBarHeight}px`}>
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
        <Flex align="center" gap="3" px="3" height={`${barHeight}px`}>
          {title}
          {counts}
          <Flex ml="auto" gap="2" align="center">
            {showControl}
            {buttons}
          </Flex>
        </Flex>
      )}
      {open && (
        <HeaderRow template={layout === 'stacked' ? '' : templates[layout][section]} table={table} stacked={stacked}>
          {columnsOf(section, layout).map((id) => (
            <ColumnHeader
              key={id}
              label={columnLabels[section][id]}
              end={!stacked && (id === 'size' || id === 'speed')}
              column={table.getColumn(id)}
            />
          ))}
          {!stacked && <div />}
        </HeaderRow>
      )}
    </div>
  )
}
