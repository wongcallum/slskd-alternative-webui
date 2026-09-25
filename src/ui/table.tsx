import './table.css'
import { ArrowDownIcon, ArrowUpIcon } from '@radix-ui/react-icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type Key, type ReactNode, useLayoutEffect, useRef } from 'react'

// Clicks on controls inside a row mustn't also select or expand it, and React bubbles clicks out of portals too.
export const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export const preventShiftSelection = (event: { shiftKey: boolean; preventDefault: () => void }) => {
  if (event.shiftKey) event.preventDefault()
}

export function SortButton({
  label,
  sorted,
  onClick,
}: {
  label: string
  sorted: false | 'asc' | 'desc' | undefined
  onClick?: (event: unknown) => void
}) {
  return (
    <button type="button" className="table-sort table-label" onClick={onClick}>
      {label}
      {sorted === 'asc' ? <ArrowUpIcon /> : sorted === 'desc' ? <ArrowDownIcon /> : null}
    </button>
  )
}

export const rowHeight = 36

export const columnsHeight = 32

// Rows have a fixed height, and the column header sticks to the top while scrolling with the rows sideways.
// A new reveal key scrolls its row into view once the row exists, which may be a render or two later.
export function VirtualTable({
  minWidth,
  header,
  count,
  getItemKey,
  renderRow,
  rowSize = rowHeight,
  reveal,
  role,
  label,
}: {
  minWidth: number
  header?: ReactNode
  count: number
  getItemKey: (index: number) => Key
  renderRow: (index: number) => ReactNode
  rowSize?: number
  reveal?: { key: unknown; index: number }
  role?: string
  label?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headHeight = header === undefined ? 0 : columnsHeight
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowSize,
    getItemKey,
    overscan: 10,
    scrollMargin: headHeight,
  })
  const found = reveal !== undefined && reveal.index >= 0
  // Rows moving because others opened or closed above them don't scroll.
  useLayoutEffect(() => {
    if (reveal !== undefined && reveal.index >= 0) virtualizer.scrollToIndex(reveal.index, { align: 'auto' })
  }, [reveal?.key, found]) // oxlint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={scrollRef} className="table-scroll" role={role} aria-label={label}>
      {header !== undefined && (
        <div className="table-head" style={{ minWidth, height: columnsHeight }}>
          {header}
        </div>
      )}
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
        {virtualizer.getVirtualItems().map((virtual) => (
          <div
            key={virtual.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: virtual.size,
              transform: `translateY(${virtual.start - headHeight}px)`,
              contain: 'strict',
            }}
          >
            {renderRow(virtual.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
