import { type CSSProperties, type KeyboardEvent, useMemo, useRef, useState } from 'react'

import { createAtom, useAtom } from '../lib/store'
import { createStoredAtom } from '../lib/stored'

// A column's width in px. A growing column shares out what the row has spare, and its width is its minimum.
export type Track = { key?: string; width: number; grow?: number }

export const fixed = (width: number): Track => ({ width })

export const sized = (key: string, width: number): Track => ({ key, width })

export const growing = (key: string, width: number, grow = 1): Track => ({ key, width, grow })

type Widths = Readonly<Record<string, number>>

type Tables = Readonly<Record<string, Widths>>

function parse(stored: unknown): Tables | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined
  const tables: Record<string, Widths> = {}
  for (const [table, widths] of Object.entries(stored)) {
    if (typeof widths !== 'object' || widths === null) continue
    tables[table] = Object.fromEntries(
      Object.entries(widths as Record<string, unknown>).filter(([, width]) => Number.isFinite(width)),
    ) as Widths
  }
  return tables
}

const stored = createStoredAtom<Tables>('slskd-alt-columns', parse, {})

// A drag's widths, which are only stored once it ends.
const dragging = createAtom<Tables>({})

function save(table: string, widths: Widths | undefined) {
  const without = (all: Tables) => Object.fromEntries(Object.entries(all).filter(([each]) => each !== table))
  stored.set((all) => (widths === undefined ? without(all) : { ...all, [table]: widths }))
  dragging.set(without)
}

export type Columns = {
  table: string
  defaults: readonly Track[]
  tracks: readonly Track[]
  widths: Widths
  template: string
  minWidth: number
}

const least = 40

const leastFill = 120

// The fill is the first growing column, which takes what the others leave.
const fillOf = (tracks: readonly Track[]) => tracks.findIndex((track) => track.grow !== undefined)

const none: Widths = {}

// Tables of a kind, such as every tree pane, share their widths.
export function useColumns(table: string, defaults: readonly Track[]): Columns {
  const draft = useAtom(dragging)[table]
  const saved = useAtom(stored)[table]
  const widths = draft ?? saved ?? none
  return useMemo(() => {
    const fill = fillOf(defaults)
    const tracks = defaults.map((track, index) => {
      const width = track.key === undefined ? undefined : widths[track.key]
      if (width === undefined) return track
      // The fill's minimum is kept as a difference from its default, which changes with the layout where others don't.
      if (index === fill) return { ...track, width: Math.max(leastFill, track.width + width) }
      return track.grow === undefined ? { ...track, width } : track
    })
    return {
      table,
      defaults,
      tracks,
      widths,
      template: tracks
        .map(({ width, grow }) => (grow === undefined ? `${width}px` : `minmax(${width}px, ${grow}fr)`))
        .join(' '),
      minWidth: tracks.reduce((sum, { width }) => sum + width, 0),
    }
  }, [table, defaults, widths])
}

// Rows take their columns from their list, so a resize doesn't render them again.
export const columnsVar = (columns: Columns) => ({ '--columns': columns.template }) as CSSProperties

const measure = (row: Element | null) =>
  row === null ? [] : getComputedStyle(row).gridTemplateColumns.split(' ').map(Number.parseFloat)

const sum = (widths: readonly number[]) => widths.reduce((total, width) => total + width, 0)

// The fill gives or takes what the resized column does, so the edge follows the pointer. While the row has width to
// spare, that comes out of the spare before the fill's minimum shrinks. Once the row overflows and scrolls, the fill is
// at its minimum, so its minimum moves instead and the row keeps its width.
function resize(columns: Columns, index: number, by: number, rendered: readonly number[]): Widths {
  const { defaults, tracks, widths } = columns
  const track = tracks[index]
  if (track?.key === undefined) return widths
  const next: Record<string, number> = { ...widths }
  const fillIndex = fillOf(tracks)
  const fill = tracks[fillIndex]
  let growth = by
  if (fill !== undefined) {
    const total = sum(tracks.map(({ width }) => width))
    const others = total - fill.width
    const width = rendered.length === tracks.length ? sum(rendered) : total
    growth = Math.min(growth, width - others - leastFill)
    growth = Math.max(growth, least - track.width)
    const left = width - others - growth
    const fillWidth = Math.round(width > total + 0.5 ? Math.min(fill.width, left) : left)
    if (fill.key !== undefined && fillWidth !== fill.width) {
      next[fill.key] = fillWidth - (defaults[fillIndex]?.width ?? fill.width)
    }
  } else {
    growth = Math.max(growth, least - track.width)
  }
  next[track.key] = Math.round(track.width + growth)
  return next
}

// Once no other column has a width of its own, the fill's minimum goes back to its default too.
function reset(columns: Columns, index: number) {
  const { tracks, widths } = columns
  const key = tracks[index]?.key
  const fillKey = tracks[fillOf(tracks)]?.key
  const next = Object.fromEntries(Object.entries(widths).filter(([each]) => each !== key))
  save(columns.table, Object.keys(next).some((each) => each !== fillKey) ? next : undefined)
}

const resizable = (track: Track) => track.key !== undefined && track.grow === undefined

// A column's edge on the fill's side is the one that moves, and dragging it resizes the column.
export function ResizeHandles({ columns }: { columns: Columns }) {
  const fill = fillOf(columns.tracks)
  return columns.tracks.map(
    (track, index) =>
      resizable(track) && (
        <Handle key={track.key} columns={columns} index={index} edge={fill >= 0 && index > fill ? 'start' : 'end'} />
      ),
  )
}

type Drag = { x: number; columns: Columns; rendered: readonly number[]; widths?: Widths }

function Handle({ columns, index, edge }: { columns: Columns; index: number; edge: 'start' | 'end' }) {
  const drag = useRef<Drag>(undefined)
  const [active, setActive] = useState(false)
  return (
    <div
      className="table-resize"
      data-edge={edge}
      data-active={active || undefined}
      // Without the span, it would run to the end of the row.
      style={{ gridColumn: `${index + 1} / span 1` }}
      aria-hidden
      // Keeps the focus where it is, and stops the drag selecting text.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, columns, rendered: measure(event.currentTarget.parentElement) }
        setActive(true)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (current === undefined) return
        const moved = event.clientX - current.x
        if (moved === 0 && current.widths === undefined) return
        current.widths = resize(current.columns, index, edge === 'start' ? -moved : moved, current.rendered)
        dragging.set((all) => ({ ...all, [current.columns.table]: current.widths as Widths }))
      }}
      onLostPointerCapture={() => {
        const current = drag.current
        drag.current = undefined
        setActive(false)
        if (current?.widths !== undefined) save(current.columns.table, current.widths)
      }}
      onDoubleClick={() => reset(columns, index)}
    />
  )
}

const step = 10

// Shift with ← or → on a column's header narrows or widens the column.
export function onResizeKey(event: KeyboardEvent<HTMLElement>, columns: Columns) {
  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const row = event.currentTarget
  const index = Array.from(row.children).findIndex((child) => child.contains(event.target as Node))
  const track = columns.tracks[index]
  if (track === undefined || !resizable(track)) return
  event.preventDefault()
  save(columns.table, resize(columns, index, event.key === 'ArrowRight' ? step : -step, measure(row)))
}
