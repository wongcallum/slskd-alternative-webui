import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { Button, Flex, SegmentedControl, Text } from '@radix-ui/themes'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useRef } from 'react'

import { countFiles } from '../lib/files'
import { formatSpeed, plural } from '../lib/format'
import { useAtom } from '../lib/store'
import { ConfirmButton } from '../ui/controls'
import {
  ColumnHeader,
  columnsHeight,
  HeaderRow,
  rowHeight,
  toggleExpanded,
  useRowToggle,
  virtualRowStyle,
} from '../ui/table'
import { actions, cancel, clearFinished, lookups, retry } from './actions'
import { FileRow, GroupRow } from './rows'
import {
  barHeight,
  columnIds,
  columnLabels,
  expansions,
  type Gates,
  minWidth,
  openSections,
  type SectionTable,
  type TableRow,
  templates,
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

  const onSelect = { active: useRowToggle(activeTable), finished: useRowToggle(finishedTable) }
  const onToggle = useCallback(
    (section: Section, id: string) =>
      expansions[direction].set((state) => ({ ...state, [section]: toggleExpanded(state[section], id) })),
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
        selected={row.getIsSelected()}
        pending={pending.has(original.id)}
        lookup={lookupMap.get(original.id)}
        gate={gates.soulseek}
        onSelect={onSelect[section]}
      />
    )
  }

  return (
    <div ref={scrollRef} className="table-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
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
    const total = section === 'active' ? data.transferring + data.queued : data.succeeded + data.failed + data.cancelled
    summary = `${countFiles(groups).toLocaleString()} of ${total.toLocaleString()}`
  } else if (section === 'active') {
    summary = `${data.transferring.toLocaleString()} ${direction}ing · ${data.queued.toLocaleString()} queued`
    if (data.speed > 0) summary += ` · ${formatSpeed(data.speed)}`
  } else {
    summary = `${data.succeeded.toLocaleString()} succeeded · ${data.failed.toLocaleString()} failed`
    if (data.cancelled > 0) summary += ` · ${data.cancelled.toLocaleString()} cancelled`
  }

  const everything = allFiles(section === 'active' ? data.active : data.finished)
  const failed = everything.filter((file) => isFailed(file.state))
  return (
    <div className="table-section">
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
                <SegmentedControl.Item value="cancelled">Cancelled</SegmentedControl.Item>
              </SegmentedControl.Root>
              {direction === 'download' && (
                <ConfirmButton
                  label="Retry failed"
                  busy="Retrying"
                  progress={running.retry}
                  gate={failed.length === 0 ? 'Nothing has failed' : gates.soulseek}
                  title={`Retry ${plural(failed.length, 'download')}?`}
                  description="Every failed download is enqueued again, including any hidden by the filter. Cancelled ones aren't."
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
          )}
        </Flex>
      </Flex>
      {open && (
        <HeaderRow template={templates[section]} table={table}>
          {columnIds[section].map((id) => (
            <ColumnHeader
              key={id}
              label={columnLabels[section][id]}
              end={id === 'size' || id === 'speed'}
              column={table.getColumn(id)}
            />
          ))}
          <div />
        </HeaderRow>
      )}
    </div>
  )
}
