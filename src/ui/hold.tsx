import { PauseIcon, PlayIcon } from '@radix-ui/react-icons'
import { Button, Tooltip } from '@radix-ui/themes'
import { type Key, type ReactNode, type UIEvent, useCallback, useRef, useState } from 'react'

import { FilterField, Toolbar, ToolbarEnd } from './controls'
import { ColumnHeader, HeaderRow, type Layout, rowHeight, stackedHeight, useListLayout, VirtualTable } from './table'

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

export type Hold<M> = ReturnType<typeof useHold<M>>

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
      <FilterField placeholder={placeholder} value={filter.text} onChange={filter.change} width="280px" />
      {children}
      <ToolbarEnd>
        <HoldButton hold={hold} unseen={unseen} />
      </ToolbarEnd>
    </Toolbar>
  )
}

// Stacked below sm, narrower below md.
export function HeldList<T>({
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
  templates: Record<Exclude<Layout, 'stacked'>, string>
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
  return (
    <VirtualTable
      minWidth={layout === 'wide' ? 900 : 0}
      header={
        layout === 'stacked' ? undefined : (
          <HeaderRow template={templates[layout]}>
            {labels.map((label) => (
              <ColumnHeader key={label} label={label} />
            ))}
          </HeaderRow>
        )
      }
      items={records}
      itemKey={itemKey}
      rowSize={layout === 'stacked' ? stackedHeight : rowHeight}
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
