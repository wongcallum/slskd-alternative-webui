import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual'
import {
  type AriaAttributes,
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  claimFocus,
  clearIntent,
  isFocusLost,
  noteListFocus,
  peekIntent,
  recall,
  registerList,
  remember,
} from './focus'

const RowTabbable = createContext(true)

// Only the row the keyboard is on has its controls in the Tab order, so Tab leaves the list after them.
export const useRowTabIndex = () => (useContext(RowTabbable) ? undefined : -1)

export function RowScope({ tabbable, children }: { tabbable: boolean; children: ReactNode }) {
  return <RowTabbable value={tabbable}>{children}</RowTabbable>
}

export type ListNavOptions<T> = {
  // Unique on its page. It names the list for focus handling and for Back, which returns to the row it was on.
  name: string
  items: readonly T[]
  itemKey: (item: T) => string
  // Items that aren't rows, such as a section's header, are skipped.
  isRow?: (item: T) => boolean
  // A page's main list takes focus when a navigation loses it. The highest rank wins.
  rank?: number
  // The row the list's Tab stop moves to whenever this changes, such as the open folder.
  anchor?: string
  start?: 'first' | 'last'
  role?: Role
  label?: string
  // The scroll viewport, when it is outside the row container.
  scrollRef?: RefObject<HTMLElement | null>
  multiselectable?: boolean
  aria?: (item: T) => AriaAttributes
  // → and ← open and close rows with children, and move between parents and children.
  depth?: (item: T) => number
  canToggle?: (item: T) => boolean
  isOpen?: (item: T) => boolean
  onToggle?: (item: T) => void
  onEnter?: (item: T) => void
  onSpace?: (item: T, range: boolean) => void
  // Shift with ↑ or ↓. Returning false keeps the focus where it is.
  onExtend?: (from: T, to: T) => boolean | void
  onSelectAll?: () => void
  // Returns whether Escape did something.
  onEscape?: () => boolean
  // The keyboard moved to another row.
  onMove?: (item: T) => void
}

const always = () => true

type Role = 'grid' | 'treegrid' | 'tree'

export const rowAttributes = (index: number, tabbable: boolean, role: Role = 'grid') => ({
  'data-row': index,
  tabIndex: tabbable ? 0 : -1,
  role: role === 'tree' ? 'treeitem' : 'row',
  'aria-rowindex': role === 'tree' ? undefined : index + 1,
})

function nearestRow<T>(items: readonly T[], isRow: (item: T) => boolean, from: number, direction = 1) {
  if (items.length === 0) return -1
  const start = Math.min(Math.max(from, 0), items.length - 1)
  for (let index = start; index >= 0 && index < items.length; index += direction) {
    if (isRow(items[index] as T)) return index
  }
  for (let index = start - direction; index >= 0 && index < items.length; index -= direction) {
    if (isRow(items[index] as T)) return index
  }
  return -1
}

// A roving tab stop over a list's rows: one row takes Tab, and keys move it. The rows are found in the DOM by their
// index, and a virtualised list has to keep the stop's row rendered (rangeExtractor), so it can be focused.
export function useListNav<T>(options: ListNavOptions<T>) {
  const { name, items, itemKey, isRow = always, anchor, start = 'first', role = 'grid', rank = 0 } = options
  const containerRef = useRef<HTMLDivElement | null>(null)
  // The row the keyboard is on, and where it was, which the row nearest takes over from if it goes.
  const [spot, setSpot] = useState<{ key?: string; index?: number }>(() => {
    const remembered = recall(name)
    return { key: peekIntent(name) ?? remembered?.key ?? anchor, index: remembered?.index }
  })
  const [seenAnchor, setSeenAnchor] = useState(anchor)
  if (anchor !== seenAnchor) {
    setSeenAnchor(anchor)
    setSpot((current) => ({ ...current, key: anchor }))
  }
  const found = useMemo(
    () => (spot.key === undefined ? -1 : items.findIndex((item) => itemKey(item) === spot.key)),
    [items, itemKey, spot.key],
  )
  const stop = found >= 0 ? found : nearestRow(items, isRow, spot.index ?? (start === 'last' ? items.length - 1 : 0))
  const stopKey = stop >= 0 ? itemKey(items[stop] as T) : undefined
  const stopRef = useRef(stop)
  const wantFocus = useRef(false)
  const inside = useRef<Element | null>(null)

  const focusRow = useCallback((index: number) => {
    const element = containerRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`)
    if (element === null || element === undefined) return false
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'nearest' })
    return true
  }, [])

  useLayoutEffect(() => {
    stopRef.current = stop
    if (wantFocus.current) {
      wantFocus.current = false
      focusRow(stop)
    } else if (inside.current !== null && !inside.current.isConnected && isFocusLost()) {
      // The focused row went, say filtered out or moved on, so the keyboard goes to the row now in its place.
      inside.current = null
      focusRow(stop)
    } else if (stop >= 0) claimFocus(name)
  })

  // An anchor that moves while the keyboard is in the list takes the keyboard with it.
  useLayoutEffect(() => {
    if (anchor !== undefined && containerRef.current?.contains(document.activeElement)) focusRow(stopRef.current)
  }, [anchor, focusRow])

  useLayoutEffect(() => registerList(name, { rank, focus: () => focusRow(stopRef.current) }), [name, rank, focusRow])

  useEffect(() => {
    if (stopKey !== undefined) remember(name, { key: stopKey, index: stop })
  }, [name, stopKey, stop])

  useEffect(() => {
    clearIntent(name)
  }, [name])

  function go(index: number) {
    const item = items[index]
    if (item === undefined) return
    if (index === stop) focusRow(index)
    else {
      setSpot({ key: itemKey(item), index })
      wantFocus.current = true
    }
    options.onMove?.(item)
  }

  function pageSize(index: number) {
    const container = containerRef.current
    const row = container?.querySelector<HTMLElement>(`[data-row="${index}"]`)
    if (container === null || row === null || row === undefined) return 1
    const viewport = options.scrollRef?.current ?? container
    return Math.max(1, Math.floor(viewport.clientHeight / Math.max(row.offsetHeight, 1)) - 1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    const container = containerRef.current
    const row = (event.target as Element).closest<HTMLElement>('[data-row]')
    if (container === null || row === null || !container.contains(row)) return
    const index = Number(row.dataset.row)
    const item = items[index]
    if (item === undefined) return
    const command = event.ctrlKey || event.metaKey
    if (event.altKey) return
    if (event.key === 'Escape') {
      if (options.onEscape?.() === true) event.preventDefault()
      return
    }
    if (event.target !== row) return
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (command) return
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const next = nearestRow(items, isRow, index + direction, direction)
        if (next < 0 || (next - index) * direction <= 0) break
        if (event.shiftKey && options.onExtend?.(item, items[next] as T) === false) break
        go(next)
        break
      }
      case 'Home':
      case 'End':
        if (command) return
        go(event.key === 'Home' ? nearestRow(items, isRow, 0) : nearestRow(items, isRow, items.length - 1, -1))
        break
      case 'PageDown':
      case 'PageUp': {
        if (command) return
        const direction = event.key === 'PageDown' ? 1 : -1
        go(nearestRow(items, isRow, index + direction * pageSize(index), direction))
        break
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        const { depth, canToggle, isOpen, onToggle } = options
        if (command || depth === undefined) return
        const level = depth(item)
        const open = isOpen?.(item) ?? false
        if (event.key === 'ArrowRight') {
          const next = items[index + 1]
          if (canToggle?.(item) === true && !open) onToggle?.(item)
          else if (open && next !== undefined && depth(next) > level) go(index + 1)
        } else if (canToggle?.(item) === true && open) {
          onToggle?.(item)
        } else {
          for (let above = index - 1; above >= 0; above--) {
            const candidate = items[above] as T
            if (isRow(candidate) && depth(candidate) < level) {
              go(above)
              break
            }
          }
        }
        break
      }
      case 'Enter':
        if (command || options.onEnter === undefined) return
        options.onEnter(item)
        break
      case ' ':
        if (command) return
        options.onSpace?.(item, event.shiftKey)
        break
      case 'a':
      case 'A':
        if (!command || options.onSelectAll === undefined) return
        options.onSelectAll()
        break
      default:
        return
    }
    event.preventDefault()
  }

  // Focus that moves elsewhere isn't the list's to take back, as it is when its row is removed.
  function onBlur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget
    if (next !== null && !containerRef.current?.contains(next)) inside.current = null
  }

  function onFocus(event: FocusEvent<HTMLElement>) {
    noteListFocus(name)
    inside.current = event.target
    const row = event.target.closest<HTMLElement>('[data-row]')
    if (row === null || !containerRef.current?.contains(row)) return
    const index = Number(row.dataset.row)
    const item = items[index]
    if (item === undefined) return
    const key = itemKey(item)
    if (spot.key !== key || spot.index !== index) setSpot({ key, index })
  }

  return {
    containerRef,
    stop,
    focused: () => items[stopRef.current],
    containerProps: {
      role,
      'aria-label': options.label,
      'aria-rowcount': role === 'tree' ? undefined : items.length,
      'aria-multiselectable': options.multiselectable || undefined,
      onKeyDown,
      onFocus,
      onBlur,
    },
    rowProps: (index: number) => {
      const item = items[index]
      if (item === undefined || !isRow(item)) return undefined
      return { ...rowAttributes(index, index === stop, role), ...options.aria?.(item) }
    },
    // Keeps the stop's row rendered wherever the list is scrolled, so the keyboard can always reach it.
    rangeExtractor: (range: Range, base: (range: Range) => number[] = defaultRangeExtractor) => {
      const indexes = base(range)
      if (stop < 0 || stop >= range.count || indexes.includes(stop)) return indexes
      const at = indexes.findIndex((index) => index > stop)
      return at < 0 ? [...indexes, stop] : [...indexes.slice(0, at), stop, ...indexes.slice(at)]
    },
  }
}

export type ListNav<T> = ReturnType<typeof useListNav<T>>
