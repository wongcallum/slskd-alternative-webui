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

import { useFrom } from '../lib/media'
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

// Stacked rows have a title line and a line or two of details below it, for screens too narrow for columns.
export const stackedHeight = 56

export const stackedHeight3 = 72

export const columnsHeight = 32

export type Layout = 'stacked' | 'medium' | 'wide'

// The widest tables stack their rows below md, and drop a column between md and lg.
export function useLayout(): Layout {
  const md = useFrom('md')
  const lg = useFrom('lg')
  return !md ? 'stacked' : lg ? 'wide' : 'medium'
}

// Other lists stack below sm, and narrow or drop a column between sm and md.
export function useListLayout(): Layout {
  const sm = useFrom('sm')
  const md = useFrom('md')
  return !sm ? 'stacked' : md ? 'wide' : 'medium'
}

type RowProps = {
  group?: boolean
  selected?: boolean
  dimmed?: boolean
  style?: CSSProperties
  onClick?: (event: MouseEvent) => void
}

function Row({
  className,
  group,
  selected,
  dimmed,
  style,
  onClick,
  children,
}: RowProps & { className: string; children: ReactNode }) {
  return (
    <div
      className={group ? `${className} table-group` : className}
      style={style}
      data-selected={selected || undefined}
      data-dimmed={dimmed || undefined}
      onMouseDown={preventShiftSelection}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function GridRow({ template, style, ...props }: RowProps & { template: string; children: ReactNode }) {
  return <Row className="table-row" style={{ gridTemplateColumns: template, ...style }} {...props} />
}

// The check spans the lines, the title takes the first line whole, and the actions sit at the end of the last.
export function StackedRow({
  check,
  indent,
  title,
  meta,
  more,
  actions,
  ...props
}: RowProps & {
  check?: ReactNode
  indent?: boolean
  title: ReactNode
  meta: ReactNode
  more?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Row
      className={[
        'table-row table-stacked',
        check !== undefined && 'table-stacked-check',
        more !== undefined && 'table-stacked-3',
        indent && 'table-stacked-indent',
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {check}
      <Flex className="table-stacked-title" align="center" gap="2">
        {title}
      </Flex>
      <div className="table-stacked-meta" data-area={more === undefined ? 'last' : 'middle'}>
        {meta}
      </div>
      {more !== undefined && (
        <div className="table-stacked-meta" data-area="last">
          {more}
        </div>
      )}
      {actions !== undefined && (
        <Flex className="table-stacked-actions" gap="3" align="center" justify="end" onClick={stop}>
          {actions}
        </Flex>
      )}
    </Row>
  )
}

// A stacked row's details, separated by dots. When they don't fit, the last one gives way first.
export function Parts({ items }: { items: ReactNode[] }) {
  return items
    .filter((part) => part !== undefined && part !== null && part !== false && part !== '')
    .map((part, index) => (
      // oxlint-disable-next-line react/no-array-index-key -- a row's parts don't reorder
      <span key={index} className="table-part">
        {part}
      </span>
    ))
}

// The whole cell toggles, which makes a finger-sized target of a 16px box.
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
    <div
      className="table-cell table-check"
      onClick={(event) => {
        stop(event)
        if (!disabled) onToggle(event.shiftKey)
      }}
    >
      <Checkbox checked={selected ? true : partial ? 'indeterminate' : false} disabled={disabled} />
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

type GroupNameProps = { expanded: boolean; name: string; children?: ReactNode }

export function GroupName({ expanded, name, children }: GroupNameProps) {
  return (
    <>
      {expanded ? <ChevronDownIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
      <Text size="2" weight="medium" truncate>
        {name}
      </Text>
      {children}
    </>
  )
}

export function GroupNameCell({ title, ...props }: GroupNameProps & { title: string }) {
  return (
    <Flex className="table-cell" align="center" gap="2" title={title}>
      <GroupName {...props} />
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

// Stacked, the columns become a strip of the labels to sort by.
export function HeaderRow({
  template,
  table,
  stacked,
  children,
}: {
  template: string
  table?: SelectAll
  stacked?: boolean
  children: ReactNode
}) {
  return (
    <div
      className="table-row table-columns"
      style={{
        gridTemplateColumns: stacked ? `${table === undefined ? '' : '40px '}minmax(0, 1fr)` : template,
        height: columnsHeight,
      }}
    >
      {table !== undefined && (
        <CheckCell
          selected={table.getIsAllRowsSelected()}
          // getIsSomeRowsSelected counts ids left in the state by rows that were deleted, filtered out or moved.
          partial={table.getSelectedRowModel().flatRows.length > 0}
          onToggle={() => table.toggleAllRowsSelected()}
        />
      )}
      {stacked ? <div className="table-sorts">{children}</div> : children}
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
// itemKey and rowSize have to keep their identity, because a new one makes the virtualizer measure every row again,
// which is also how a new row size takes effect.
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
  footer,
}: {
  minWidth: number
  header?: ReactNode
  items: readonly T[]
  itemKey: (item: T) => Key
  renderItem: (item: T) => ReactNode
  rowSize?: number | ((item: T) => number)
  reveal?: { key: unknown; index: number }
  role?: string
  label?: string
  scrollRef?: RefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
  footer?: ReactNode
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalRef ?? ownRef
  const headHeight = header === undefined ? 0 : columnsHeight
  const getItemKey = useCallback(
    (index: number) => {
      const item = items[index]
      return item === undefined ? index : itemKey(item)
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new size has to remeasure
    [items, itemKey, rowSize],
  )
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = items[index]
      if (typeof rowSize === 'number') return rowSize
      return item === undefined ? rowHeight : rowSize(item)
    },
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
      {footer}
    </div>
  )
}
