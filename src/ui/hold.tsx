import { PauseIcon, PlayIcon } from '@radix-ui/react-icons'
import { Button, Tooltip } from '@radix-ui/themes'
import { type Key, type ReactNode, type UIEvent, useCallback, useRef, useState } from 'react'

import { formatFullPreciseTime, usePreciseTime } from '../lib/format'
import { FilterField, Toolbar, ToolbarEnd } from './controls'
import { useListNav } from './listNav'
import {
  Cell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  type Layout,
  Parts,
  rowHeight,
  StackedRow,
  stackedHeight,
  type Templates,
  useListLayout,
  VirtualTable,
} from './table'

// A list with the newest rows on top holds still while it's scrolled down or paused, so reading isn't disturbed by
// rows arriving at the top. The marker is whatever the list needs to tell the rows it held from the new ones.
export function useHold<M>(capture: () => M) {
  const [hold, setHold] = useState<{ marker: M; paused: boolean }>()
  const scrollRef = useRef<HTMLDivElement>(null)

  const freeze = (paused: boolean) =>
    setHold((current) => ({ marker: current === undefined ? capture() : current.marker, paused }))

  return {
    marker: hold?.marker,
    held: hold !== undefined,
    scrollRef,
    pause: () => freeze(true),
    resume: () => {
      setHold(undefined)
      scrollRef.current?.scrollTo({ top: 0 })
    },
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      const away = event.currentTarget.scrollTop >= 1
      if (away && hold === undefined) freeze(false)
      else if (!away && hold?.paused === false) setHold(undefined)
    },
    // Without the list there's nothing to scroll back up. Called while rendering.
    releaseIfEmpty: (empty: boolean) => {
      if (empty && hold?.paused === false) setHold(undefined)
    },
  }
}

type Hold<M> = ReturnType<typeof useHold<M>>

function HoldButton({ hold, unseen }: { hold: Hold<unknown>; unseen: string }) {
  if (hold.held) {
    return (
      <Button size="1" variant="soft" onClick={hold.resume}>
        <PlayIcon />
        Resume{unseen}
      </Button>
    )
  }
  return (
    <Tooltip content="Keep new rows from moving the list. Scrolling down also pauses it.">
      <Button size="1" variant="soft" color="gray" onClick={hold.pause}>
        <PauseIcon />
        Pause
      </Button>
    </Tooltip>
  )
}

export function HeldToolbar({
  placeholder,
  filter,
  hold,
  unseen,
  children,
}: {
  placeholder: string
  filter: { text: string; change: (value: string) => void }
  hold: Hold<unknown>
  unseen: string
  children: ReactNode
}) {
  return (
    <Toolbar>
      <FilterField
        placeholder={placeholder}
        value={filter.text}
        onChange={filter.change}
        width="280px"
        main
        list="held"
      />
      {children}
      <ToolbarEnd>
        <HoldButton hold={hold} unseen={unseen} />
      </ToolbarEnd>
    </Toolbar>
  )
}

export function HeldRow({
  layout,
  templates,
  time,
  selected,
  dimmed,
  title,
  details,
  cells,
  onClick,
}: {
  layout: Layout
  templates: Templates
  time: number
  selected: boolean
  dimmed?: boolean
  title: ReactNode
  details: ReactNode[]
  cells: ReactNode
  onClick: () => void
}) {
  const shown = usePreciseTime(time)
  if (layout === 'stacked') {
    return (
      <StackedRow
        selected={selected}
        dimmed={dimmed}
        title={title}
        meta={<Parts items={[shown, ...details]} />}
        style={{ cursor: 'pointer' }}
        onClick={onClick}
      />
    )
  }
  return (
    <GridRow
      template={templates[layout]}
      selected={selected}
      dimmed={dimmed}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <Cell title={formatFullPreciseTime(time)}>{shown}</Cell>
      {cells}
    </GridRow>
  )
}

// Enter opens a row's details, which then follow the keyboard from row to row until Escape closes them.
export function HeldList<T>({
  label,
  templates,
  labels,
  records,
  itemKey,
  selected,
  onSelect,
  renderRow,
  hold,
  onScroll,
  footer,
}: {
  label: string
  templates: Templates
  labels: readonly string[]
  records: readonly T[]
  itemKey: (record: T) => Key
  selected?: Key
  onSelect: (record: T | undefined) => void
  renderRow: (record: T, layout: Layout, selected: boolean, toggle: (record: T) => void) => ReactNode
  hold: Hold<unknown>
  onScroll?: (element: HTMLDivElement) => void
  footer?: ReactNode
}) {
  const toggle = useCallback(
    (record: T) => onSelect(itemKey(record) === selected ? undefined : record),
    [itemKey, selected, onSelect],
  )
  const layout = useListLayout()
  const recordKey = useCallback((record: T) => String(itemKey(record)), [itemKey])
  const nav = useListNav({
    name: 'held',
    items: records,
    itemKey: recordKey,
    rank: 1,
    label,
    aria: (record) => ({ 'aria-selected': itemKey(record) === selected }),
    onEnter: onSelect,
    onMove: (record) => selected !== undefined && onSelect(record),
    onEscape: () => {
      if (selected === undefined) return false
      onSelect(undefined)
      return true
    },
  })
  return (
    <VirtualTable
      minWidth={layout === 'wide' ? 900 : 0}
      header={
        layout === 'stacked' ? undefined : (
          <HeaderRow template={templates[layout]}>
            {labels.map((each) => (
              <ColumnHeader key={each} label={each} />
            ))}
          </HeaderRow>
        )
      }
      items={records}
      itemKey={itemKey}
      rowSize={layout === 'stacked' ? stackedHeight : rowHeight}
      nav={nav}
      renderItem={(record) => renderRow(record, layout, itemKey(record) === selected, toggle)}
      scrollRef={hold.scrollRef}
      onScroll={(event) => {
        hold.onScroll(event)
        onScroll?.(event.currentTarget)
      }}
      footer={footer}
    />
  )
}
