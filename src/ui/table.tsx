import './table.css'
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { Checkbox, Flex, type FlexProps, Text } from '@radix-ui/themes'
import { constructSortFn, type ExpandedStateList } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  type CSSProperties,
  type Key,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react'

import { compareNames } from '../lib/text'

// Clicks on controls inside a row mustn't also select or expand it, and React bubbles clicks out of portals too.
export const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

const preventShiftSelection = (event: MouseEvent) => {
  if (event.shiftKey) event.preventDefault()
}

export const sortByName = constructSortFn({ sort: compareNames })

export type Expansion = { all: boolean; toggled: ExpandedStateList }

export const collapsed: Expansion = { all: false, toggled: {} }

export const isExpanded = (expansion: Expansion, id: string) => expansion.toggled[id] ?? expansion.all

export const toggleExpanded = (expansion: Expansion, id: string): Expansion => ({
  ...expansion,
  toggled: { ...expansion.toggled, [id]: !isExpanded(expansion, id) },
})

// TanStack skips expansion entirely while the expanded state is empty, so "all expanded" has to be spelled out.
export function expandedState(expansion: Expansion, rows: Iterable<{ id: string }>) {
  if (!expansion.all) return expansion.toggled
  const all: ExpandedStateList = {}
  for (const { id } of rows) all[id] = isExpanded(expansion, id)
  return all
}

type SelectableRow = {
  subRows: readonly unknown[]
  getIsSelected: () => boolean
  getIsAllSubRowsSelected: () => boolean
  getToggleSelectedHandler: (options?: { deselectParents?: boolean }) => (event: unknown) => void
}

// Rows are memoised, so they get one stable callback that toggles through whichever table is current.
export function useRowToggle(table: { getRow: (id: string, searchAll?: boolean) => SelectableRow }) {
  const tableRef = useRef(table)
  useLayoutEffect(() => {
    tableRef.current = table
  })
  return useCallback((id: string, shiftKey: boolean) => {
    const row = tableRef.current.getRow(id, true)
    const selected = row.subRows.length > 0 ? row.getIsAllSubRowsSelected() : row.getIsSelected()
    row.getToggleSelectedHandler({ deselectParents: true })({ shiftKey, target: { checked: !selected } })
  }, [])
}

export const rowHeight = 36

export const columnsHeight = 32

export function GridRow({
  template,
  group,
  selected,
  dimmed,
  style,
  onClick,
  children,
}: {
  template: string
  group?: boolean
  selected?: boolean
  dimmed?: boolean
  style?: CSSProperties
  onClick?: (event: MouseEvent) => void
  children: ReactNode
}) {
  return (
    <div
      className={group ? 'table-row table-group' : 'table-row'}
      style={{ gridTemplateColumns: template, ...style }}
      data-selected={selected || undefined}
      data-dimmed={dimmed || undefined}
      onMouseDown={preventShiftSelection}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CheckCell({
  selected,
  partial,
  disabled,
  onToggle,
}: {
  selected: boolean
  partial?: boolean
  disabled?: boolean
  onToggle: (shiftKey: boolean) => void
}) {
  return (
    <div className="table-cell table-check" onClick={stop}>
      <Checkbox
        checked={selected ? true : partial ? 'indeterminate' : false}
        disabled={disabled}
        onClick={(event) => onToggle(event.shiftKey)}
      />
    </div>
  )
}

export function Cell({ end, title, children }: { end?: boolean; title?: string; children?: ReactNode }) {
  return (
    <div className="table-cell" data-align={end ? 'end' : undefined} title={title}>
      <Text size="2" color="gray">
        {children}
      </Text>
    </div>
  )
}

export function GroupNameCell({
  expanded,
  name,
  title,
  children,
}: {
  expanded: boolean
  name: string
  title: string
  children?: ReactNode
}) {
  return (
    <Flex className="table-cell" align="center" gap="2" title={title}>
      {expanded ? <ChevronDownIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
      <Text size="2" weight="medium" truncate>
        {name}
      </Text>
      {children}
    </Flex>
  )
}

export function ActionsCell({ gap = '3', children }: { gap?: FlexProps['gap']; children: ReactNode }) {
  return (
    <Flex className="table-cell" gap={gap} align="center" justify="end" onClick={stop}>
      {children}
    </Flex>
  )
}

type SelectAll = {
  getIsAllRowsSelected: () => boolean
  getSelectedRowModel: () => { flatRows: readonly unknown[] }
  toggleAllRowsSelected: () => void
}

export function HeaderRow({ template, table, children }: { template: string; table?: SelectAll; children: ReactNode }) {
  return (
    <div className="table-row table-columns" style={{ gridTemplateColumns: template, height: columnsHeight }}>
      {table !== undefined && (
        <CheckCell
          selected={table.getIsAllRowsSelected()}
          // getIsSomeRowsSelected counts ids left in the state by rows that were deleted, filtered out or moved.
          partial={table.getSelectedRowModel().flatRows.length > 0}
          onToggle={() => table.toggleAllRowsSelected()}
        />
      )}
      {children}
    </div>
  )
}

type SortableColumn = {
  getIsSorted: () => false | 'asc' | 'desc'
  getToggleSortingHandler: () => ((event: unknown) => void) | undefined
}

export function ColumnHeader({ label, end, column }: { label: string; end?: boolean; column?: SortableColumn }) {
  const align = end ? 'end' : undefined
  if (column === undefined) {
    return (
      <div className="table-cell table-label" data-align={align}>
        {label}
      </div>
    )
  }
  const sorted = column.getIsSorted()
  return (
    <div className="table-cell" data-align={align}>
      <button type="button" className="table-sort table-label" onClick={column.getToggleSortingHandler()}>
        {label}
        {sorted === 'asc' ? <ArrowUpIcon /> : sorted === 'desc' ? <ArrowDownIcon /> : null}
      </button>
    </div>
  )
}

export const rowId = (row: { id: string }) => row.id

export const virtualRowStyle = (size: number, start: number): CSSProperties => ({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: size,
  transform: `translateY(${start}px)`,
  contain: 'strict',
})

// Rows have a fixed height, and the column header sticks to the top while scrolling with the rows sideways.
// A new reveal key scrolls its row into view once the row exists, which may be a render or two later.
// itemKey has to keep its identity, because a new one makes the virtualizer measure every row again.
export function VirtualTable<T>({
  minWidth,
  header,
  items,
  itemKey,
  renderItem,
  rowSize = rowHeight,
  reveal,
  role,
  label,
  scrollRef: externalRef,
  onScroll,
}: {
  minWidth: number
  header?: ReactNode
  items: readonly T[]
  itemKey: (item: T) => Key
  renderItem: (item: T) => ReactNode
  rowSize?: number
  reveal?: { key: unknown; index: number }
  role?: string
  label?: string
  scrollRef?: RefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalRef ?? ownRef
  const headHeight = header === undefined ? 0 : columnsHeight
  const getItemKey = useCallback(
    (index: number) => {
      const item = items[index]
      return item === undefined ? index : itemKey(item)
    },
    [items, itemKey],
  )
  const virtualizer = useVirtualizer({
    count: items.length,
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
    <div ref={scrollRef} className="table-scroll" role={role} aria-label={label} onScroll={onScroll}>
      {header !== undefined && (
        <div className="table-head" style={{ minWidth, height: columnsHeight }}>
          {header}
        </div>
      )}
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const item = items[virtual.index]
          return (
            <div key={virtual.key} style={virtualRowStyle(virtual.size, virtual.start - headHeight)}>
              {item !== undefined && renderItem(item)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
