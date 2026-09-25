import { Flex, Select, Text } from '@radix-ui/themes'
import { memo, type ReactNode, type RefObject, type UIEvent, useId, useMemo, useState } from 'react'
import * as v from 'valibot'

import { formatFullPreciseTime, formatPreciseTime } from '../lib/format'
import { oneOf, textParam } from '../lib/params'
import { type Color, FilterField, toolbarStyle, useFilterText } from '../ui/controls'
import { DetailsPane, Preformatted } from '../ui/details'
import { HoldButton, useHold } from '../ui/hold'
import { Empty, Freshness, Polling } from '../ui/status'
import { Cell, ColumnHeader, GridRow, HeaderRow, VirtualTable } from '../ui/table'
import {
  type Level,
  logMatcher,
  logPollInterval,
  type LogRecord,
  logs,
  maxRecords,
  type MinimumLevel,
  minimumLevels,
  useLogs,
} from './logs'
import { SystemPage } from './SystemPage'

export const logsSearch = v.object({ q: textParam, level: oneOf(minimumLevels, 'debug') })

export const logsSearchDefaults = { q: '', level: 'debug' } as const

export type LogsSearch = v.InferOutput<typeof logsSearch>

const minimumLabels: Record<MinimumLevel, string> = { debug: 'Debug', info: 'Info', warning: 'Warning', error: 'Error' }

const levelLabels: Record<Level, string> = {
  Verbose: 'Verbose',
  Debug: 'Debug',
  Information: 'Info',
  Warning: 'Warning',
  Error: 'Error',
  Fatal: 'Fatal',
}

const levelColors: Partial<Record<Level, Color>> = { Warning: 'amber', Error: 'red', Fatal: 'red' }

const isQuiet = (level: Level) => level === 'Verbose' || level === 'Debug'

const shortName = (name: string) => name.slice(name.lastIndexOf('.') + 1)

const sourceOf = (record: LogRecord) =>
  record.subContext === undefined ? record.context : `${record.context} › ${record.subContext}`

const newestId = (records: LogRecord[]) => records.reduce((newest, record) => Math.max(newest, record.id), -1)

const none: LogRecord[] = []

// Held records are kept whole, since records are also dropped at the bottom.
type Marker = { records: LogRecord[]; newest: number }

type Props = {
  search: LogsSearch
  onSearchChange: (patch: Partial<LogsSearch>) => void
}

export function LogsPage({ search, onSearchChange }: Props) {
  const { data, error, live } = useLogs()
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const records = data?.records ?? none
  const hold = useHold<Marker>(() => ({ records, newest: newestId(records) }))
  const frozen = hold.marker
  const [selected, setSelected] = useState<LogRecord>()

  const matches = useMemo(() => logMatcher(search.level, filter.query), [search.level, filter.query])
  const held = frozen?.records ?? records
  const shown = useMemo(() => (matches === undefined ? held : held.filter(matches)), [held, matches])
  const unseen = useMemo(() => {
    if (frozen === undefined) return ''
    let count = 0
    let old = 0
    for (const record of records) {
      if (record.id <= frozen.newest) old++
      else if (matches?.(record) ?? true) count++
    }
    if (count === 0) return ''
    // Once every record held is new, older new ones have already been dropped.
    return ` (${count.toLocaleString()}${old === 0 && records.length === maxRecords ? '+' : ''} new)`
  }, [frozen, records, matches])

  hold.releaseIfEmpty(shown.length === 0)

  let content: ReactNode
  if (data === undefined) {
    content = <Polling what="the log" error={error} />
  } else if (shown.length === 0) {
    content = <Empty>{held.length === 0 ? 'No log records yet.' : 'Nothing matches.'}</Empty>
  } else {
    content = (
      <LogList
        records={shown}
        selected={selected?.id}
        onSelect={(record) => setSelected(record.id === selected?.id ? undefined : record)}
        scrollRef={hold.scrollRef}
        onScroll={hold.onScroll}
      />
    )
  }

  return (
    <SystemPage
      status={
        <Freshness
          resource={logs}
          interval={logPollInterval}
          error={data === undefined ? undefined : error}
          live={live}
        />
      }
    >
      <Flex align="center" gap="3" px="4" py="2" flexShrink="0" style={toolbarStyle}>
        <FilterField
          placeholder="Filter by message or source"
          value={filter.text}
          onChange={filter.change}
          style={{ width: 280 }}
        />
        <LevelSelect value={search.level} onChange={(level) => onSearchChange({ level })} />
        <Flex ml="auto" align="center" gap="3" flexShrink="0">
          <HoldButton held={hold.held} unseen={unseen} onPause={hold.pause} onResume={hold.resume} />
        </Flex>
      </Flex>
      {content}
      {selected !== undefined && <RecordDetails record={selected} onClose={() => setSelected(undefined)} />}
    </SystemPage>
  )
}

function LevelSelect({ value, onChange }: { value: MinimumLevel; onChange: (level: MinimumLevel) => void }) {
  const id = useId()
  return (
    <Flex align="center" gap="2">
      <Text as="label" size="2" color="gray" htmlFor={id}>
        Level at least
      </Text>
      <Select.Root value={value} onValueChange={(level) => onChange(level as MinimumLevel)}>
        <Select.Trigger id={id} />
        <Select.Content>
          {minimumLevels.map((level) => (
            <Select.Item key={level} value={level}>
              {minimumLabels[level]}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  )
}

const template = '170px 80px 200px minmax(300px, 1fr)'

const minWidth = 900

const recordId = (record: LogRecord) => record.id

type LogListProps = {
  records: LogRecord[]
  selected?: number
  onSelect: (record: LogRecord) => void
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: (event: UIEvent<HTMLDivElement>) => void
}

function LogList({ records, selected, onSelect, scrollRef, onScroll }: LogListProps) {
  const header = (
    <HeaderRow template={template}>
      <ColumnHeader label="Time" />
      <ColumnHeader label="Level" />
      <ColumnHeader label="Source" />
      <ColumnHeader label="Message" />
    </HeaderRow>
  )
  return (
    <VirtualTable
      minWidth={minWidth}
      header={header}
      items={records}
      itemKey={recordId}
      renderItem={(record) => <LogRow record={record} selected={record.id === selected} onSelect={onSelect} />}
      scrollRef={scrollRef}
      onScroll={onScroll}
    />
  )
}

function LevelText({ level }: { level: Level }) {
  return (
    <Text size="2" color={levelColors[level] ?? 'gray'} weight={level === 'Fatal' ? 'bold' : undefined}>
      {levelLabels[level]}
    </Text>
  )
}

type LogRowProps = { record: LogRecord; selected: boolean; onSelect: (record: LogRecord) => void }

const LogRow = memo(function LogRow({ record, selected, onSelect }: LogRowProps) {
  return (
    <GridRow
      template={template}
      selected={selected}
      dimmed={isQuiet(record.level)}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(record)}
    >
      <Cell title={formatFullPreciseTime(record.time)}>{formatPreciseTime(record.time)}</Cell>
      <div className="table-cell">
        <LevelText level={record.level} />
      </div>
      <Cell title={sourceOf(record)}>{shortName(record.subContext ?? record.context)}</Cell>
      <Flex className="table-cell" align="center" gap="2" title={record.firstLine}>
        <Text size="2" truncate>
          {record.firstLine}
        </Text>
        {record.moreLines > 0 && (
          <Text size="1" color="gray" style={{ flexShrink: 0 }}>
            +{record.moreLines.toLocaleString()} lines
          </Text>
        )}
      </Flex>
    </GridRow>
  )
})

function RecordDetails({ record, onClose }: { record: LogRecord; onClose: () => void }) {
  return (
    <DetailsPane
      header={
        <>
          <LevelText level={record.level} />
          <Text size="2" color="gray">
            {formatFullPreciseTime(record.time)}
          </Text>
          <Text size="2" color="gray" style={{ wordBreak: 'break-word' }}>
            {sourceOf(record)}
          </Text>
        </>
      }
      onClose={onClose}
    >
      <Preformatted>{record.message}</Preformatted>
    </DetailsPane>
  )
}
