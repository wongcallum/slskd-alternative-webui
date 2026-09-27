import { Box, Flex, Text } from '@radix-ui/themes'
import { Bar as Bars, BarChart, CartesianGrid, ReferenceLine, Tooltip, type TooltipIndex, XAxis, YAxis } from 'recharts'

import { formatBytes, formatBytesIn, plural } from '../lib/format'
import type { Direction } from '../transfers/transfers'
import type { Measure } from './params'
import type { Bar, Figures, Unit } from './reports'

const colors: Record<Direction, string> = { download: 'var(--accent-9)', upload: 'var(--teal-9)' }

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
  if (reach === 0) return { domain: [0, 1], ticks: [0], exponent: 0 }
  const exponent = measure === 'size' ? Math.floor(Math.log(reach) / Math.log(1024)) : 0
  const unit = 1024 ** exponent
  const rough = reach / unit / 3
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = Math.max(1, ([1, 2, 5].find((multiple) => multiple * magnitude >= rough) ?? 10) * magnitude * unit)
  const bottom = Math.floor(low / step)
  const top = Math.ceil(high / step)
  return {
    domain: [bottom * step, top * step],
    ticks: Array.from({ length: top - bottom + 1 }, (_, index) => (bottom + index) * step),
    exponent,
  }
}

const axisTick = { fill: 'var(--gray-11)', fontSize: 12 }

function Key({ direction }: { direction: Direction }) {
  return (
    <Flex align="center" gap="2">
      <Box width="10px" height="10px" flexShrink="0" style={{ background: colors[direction], borderRadius: 2 }} />
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
  const value = values[measure]
  const data = bars.map((bar, index) => ({ index, download: value(bar.download), upload: -value(bar.upload) }))
  const scale = scaleOf(
    Math.max(0, ...data.map((row) => row.download)),
    Math.min(0, ...data.map((row) => row.upload)),
    measure,
  )
  const label = (index: number) => {
    const bar = bars[index]
    return bar === undefined ? '' : ticks[unit].format(bar.start)
  }
  // Six-hour blocks are labelled by the day they start.
  const dayStarts =
    unit === 'sixHours'
      ? data.filter((row) => new Date(bars[row.index]!.start).getHours() === 0).map((row) => row.index)
      : undefined
  return (
    <Flex direction="column" gap="2">
      <Flex gap="4">
        {directions.map((direction) => (
          <Key key={direction} direction={direction} />
        ))}
      </Flex>
      <BarChart
        responsive
        data={data}
        stackOffset="sign"
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        style={{ width: '100%', height }}
      >
        <CartesianGrid vertical={false} stroke="var(--gray-a4)" />
        <XAxis
          dataKey="index"
          ticks={dayStarts}
          interval={dayStarts === undefined ? 'preserveStartEnd' : 0}
          minTickGap={12}
          tickFormatter={label}
          tick={axisTick}
          stroke="var(--gray-a6)"
          tickLine={false}
        />
        <YAxis
          width="auto"
          domain={scale.domain}
          ticks={scale.ticks}
          tickFormatter={(tick: number) =>
            measure === 'size' ? formatBytesIn(Math.abs(tick), scale.exponent) : Math.abs(tick).toLocaleString()
          }
          tick={axisTick}
          axisLine={false}
          tickLine={false}
        />
        <ReferenceLine y={0} stroke="var(--gray-a7)" />
        <Tooltip
          cursor={{ fill: 'var(--gray-a3)' }}
          isAnimationActive={false}
          content={<Details bars={bars} unit={unit} measure={measure} />}
        />
        {directions.map((direction) => (
          <Bars
            key={direction}
            dataKey={direction}
            name={names[direction]}
            stackId="directions"
            fill={colors[direction]}
            maxBarSize={48}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </Flex>
  )
}

// Recharts adds whether a bar is active, and which.
function Details({
  bars,
  unit,
  measure,
  active,
  activeIndex,
}: Omit<Props, 'height'> & { active?: boolean; activeIndex?: TooltipIndex }) {
  const bar = active && activeIndex !== undefined && activeIndex !== null ? bars[Number(activeIndex)] : undefined
  if (bar === undefined) return null
  return (
    <Flex
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
  )
}
