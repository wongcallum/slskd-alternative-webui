import 'uplot/dist/uPlot.min.css'
import { Box, Flex, Text } from '@radix-ui/themes'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import uPlot from 'uplot'

import { formatBytes, formatBytesIn, plural } from '../lib/format'
import type { Direction } from '../transfers/transfers'
import type { Measure } from './params'
import type { Bar, Figures, Unit } from './reports'

const colors: Record<Direction, string> = { download: '--accent-9', upload: '--teal-9' }

const names: Record<Direction, string> = { download: 'Downloads', upload: 'Uploads' }

const values: Record<Measure, (figures: Figures) => number> = {
  size: (figures) => figures.bytes,
  files: (figures) => figures.files,
  failed: (figures) => figures.failed,
}

const formats: Record<Measure, (value: number) => string> = {
  size: (value) => formatBytes(value),
  files: (value) => plural(value, 'file'),
  failed: (value) => `${value.toLocaleString()} failed`,
}

const hours = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const

const ticks: Record<Unit, Intl.DateTimeFormat> = {
  hour: new Intl.DateTimeFormat(undefined, hours),
  sixHours: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  day: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
  month: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }),
}

const spans: Record<Unit, Intl.DateTimeFormat> = {
  hour: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...hours }),
  sixHours: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...hours }),
  day: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
  month: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }),
}

const span = (bar: Bar, unit: Unit) =>
  unit === 'hour' || unit === 'sixHours' ? spans[unit].formatRange(bar.start, bar.end) : spans[unit].format(bar.start)

// Steps of 1, 2 or 5 of a power of ten, of the largest binary unit for sizes, with about three on each side of zero.
function scaleOf(high: number, low: number, measure: Measure) {
  const reach = Math.max(high, -low)
  if (reach === 0) return { domain: [0, 1] as const, ticks: [0], exponent: 0 }
  const exponent = measure === 'size' ? Math.floor(Math.log(reach) / Math.log(1024)) : 0
  const unit = 1024 ** exponent
  const rough = reach / unit / 3
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = Math.max(1, ([1, 2, 5].find((multiple) => multiple * magnitude >= rough) ?? 10) * magnitude * unit)
  const bottom = Math.floor(low / step)
  const top = Math.ceil(high / step)
  return {
    domain: [bottom * step, top * step] as const,
    ticks: Array.from({ length: top - bottom + 1 }, (_, index) => (bottom + index) * step),
    exponent,
  }
}

const fontSize = 12
const labelGap = 8
const tickGap = 12
const tipOffset = 10
// Whole numbers of bars, so every label is under one, that divide days and years.
const labelSteps = [1, 2, 3, 4, 6, 12, 24, 36, 48, 60, 120]

const measurer = document.createElement('canvas').getContext('2d')!

function widest(font: string, labels: readonly string[]) {
  measurer.font = font
  return Math.ceil(Math.max(0, ...labels.map((label) => measurer.measureText(label).width)))
}

// A canvas can't take CSS variables, so the chart reads the theme's colours as it's built, and is built again when the
// root Theme's class switches between light and dark. The appearance prop itself lands there a render later.
function useThemeChanges(element: RefObject<HTMLElement | null>) {
  const [changes, setChanges] = useState(0)
  useEffect(() => {
    const theme = element.current?.closest('.radix-themes')
    if (!theme) return
    const observer = new MutationObserver(() => setChanges((count) => count + 1))
    observer.observe(theme, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [element])
  return changes
}

type Pointer = { x: number; y: number }

// Right of and below the pointer, or left of and above it where that would leave the chart.
function place(tip: HTMLElement | null, box: HTMLElement | null, pointer: Pointer | undefined) {
  if (!tip || !box || !pointer) return
  let x = pointer.x + tipOffset
  if (x + tip.offsetWidth > box.clientWidth) x = pointer.x - tipOffset - tip.offsetWidth
  let y = pointer.y + tipOffset
  if (y + tip.offsetHeight > box.clientHeight) y = pointer.y - tipOffset - tip.offsetHeight
  tip.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`
}

function Key({ direction }: { direction: Direction }) {
  return (
    <Flex align="center" gap="2">
      <Box
        width="10px"
        height="10px"
        flexShrink="0"
        style={{ background: `var(${colors[direction]})`, borderRadius: 2 }}
      />
      <Text size="1" color="gray">
        {names[direction]}
      </Text>
    </Flex>
  )
}

const directions = ['download', 'upload'] as const

type Props = { bars: readonly Bar[]; unit: Unit; measure: Measure; height: number }

// Downloads rise above the line and uploads hang below it.
export function Chart({ bars, unit, measure, height }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const target = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const pointer = useRef<Pointer>(undefined)
  const [active, setActive] = useState<number>()
  const themeChanges = useThemeChanges(box)

  useLayoutEffect(() => {
    const element = target.current!
    const style = getComputedStyle(element)
    const color = (name: string) => style.getPropertyValue(name).trim()
    const font = `${fontSize}px ${style.fontFamily}`
    const value = values[measure]
    const downloads = bars.map((bar) => value(bar.download))
    const uploads = bars.map((bar) => -value(bar.upload))
    const scale = scaleOf(Math.max(0, ...downloads), Math.min(0, ...uploads), measure)
    const labels = bars.map((bar) => ticks[unit].format(bar.start))
    // Six-hour blocks are labelled by the day they start.
    const dayStarts =
      unit === 'sixHours'
        ? bars.flatMap((bar, index) => (new Date(bar.start).getHours() === 0 ? [index] : []))
        : undefined
    const highlight = document.createElement('div')
    highlight.className = 'dashboard-chart-highlight'
    highlight.hidden = true

    const plot = new uPlot(
      {
        width: element.clientWidth,
        height,
        padding: [8, 4, 0, 0],
        legend: { show: false },
        cursor: { x: false, y: false, points: { show: false }, drag: { x: false, y: false, setScale: false } },
        scales: {
          x: { time: false, range: () => [-0.5, bars.length - 0.5] },
          y: { range: () => [scale.domain[0], scale.domain[1]] },
        },
        axes: [
          {
            font,
            stroke: color('--gray-11'),
            size: fontSize + labelGap * 2,
            gap: labelGap,
            space: widest(font, labels) + tickGap,
            incrs: labelSteps,
            ...(dayStarts && { splits: () => dayStarts }),
            values: (_, splits) => splits.map((index) => labels[index] ?? ''),
            grid: { show: false },
            ticks: { show: false },
            border: { show: true, stroke: color('--gray-a6'), width: 1 },
          },
          {
            font,
            stroke: color('--gray-11'),
            gap: labelGap,
            size: (_, shown) => widest(font, shown ?? []) + labelGap * 2,
            splits: () => scale.ticks,
            values: (_, splits) =>
              splits.map((tick) =>
                measure === 'size' ? formatBytesIn(Math.abs(tick), scale.exponent) : Math.abs(tick).toLocaleString(),
              ),
            grid: { stroke: color('--gray-a4'), width: 1 },
            ticks: { show: false },
          },
        ],
        series: [
          {},
          ...directions.map((direction) => ({
            fill: color(colors[direction]),
            width: 0,
            paths: uPlot.paths.bars!({ size: [0.8, 48] }),
            points: { show: false },
          })),
        ],
        hooks: {
          setCursor: [
            (self) => {
              const { idx, left = -1, top = -1 } = self.cursor
              if (idx === null || idx === undefined || left < 0) {
                highlight.hidden = true
                pointer.current = undefined
                setActive(undefined)
                return
              }
              const from = self.valToPos(idx - 0.5, 'x')
              highlight.style.left = `${from}px`
              highlight.style.width = `${self.valToPos(idx + 0.5, 'x') - from}px`
              highlight.hidden = false
              pointer.current = { x: self.over.offsetLeft + left, y: self.over.offsetTop + top }
              setActive(idx)
              place(tip.current, box.current, pointer.current)
            },
          ],
          draw: [
            (self) => {
              const width = Math.round(uPlot.pxRatio)
              const y = Math.round(self.valToPos(0, 'y', true)) + (width % 2) / 2
              const { ctx, bbox } = self
              ctx.save()
              ctx.strokeStyle = color('--gray-a7')
              ctx.lineWidth = width
              ctx.beginPath()
              ctx.moveTo(bbox.left, y)
              ctx.lineTo(bbox.left + bbox.width, y)
              ctx.stroke()
              ctx.restore()
            },
          ],
        },
      },
      [bars.map((_, index) => index), downloads, uploads],
      element,
    )
    plot.under.append(highlight)
    const resizes = new ResizeObserver(() => plot.setSize({ width: element.clientWidth, height }))
    resizes.observe(element)
    return () => {
      resizes.disconnect()
      plot.destroy()
      pointer.current = undefined
      setActive(undefined)
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- a theme change has to read its colours again
  }, [bars, unit, measure, height, themeChanges])

  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the tip is measured once its new content is in
  useLayoutEffect(() => place(tip.current, box.current, pointer.current), [active])

  const bar = active === undefined ? undefined : bars[active]
  return (
    <Flex direction="column" gap="2">
      <Flex gap="4">
        {directions.map((direction) => (
          <Key key={direction} direction={direction} />
        ))}
      </Flex>
      <div ref={box} className="dashboard-chart">
        <div ref={target} style={{ height }} />
        {bar !== undefined && (
          <Flex
            ref={tip}
            className="dashboard-chart-tip"
            direction="column"
            gap="1"
            px="3"
            py="2"
            style={{
              background: 'var(--color-panel-solid)',
              borderRadius: 'var(--radius-3)',
              boxShadow: 'var(--shadow-4)',
            }}
          >
            <Text size="1" weight="medium">
              {span(bar, unit)}
            </Text>
            {directions.map((direction) => (
              <Flex key={direction} align="center" justify="between" gap="3">
                <Key direction={direction} />
                <Text size="1">{formats[measure](values[measure](bar[direction]))}</Text>
              </Flex>
            ))}
          </Flex>
        )}
      </div>
    </Flex>
  )
}
