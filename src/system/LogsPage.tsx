import { Cross2Icon, PauseIcon, PlayIcon } from '@radix-ui/react-icons'
import { Box, Button, Flex, IconButton, Select, Text, Tooltip } from '@radix-ui/themes'
import { memo, type ReactNode, type RefObject, type UIEvent, useId, useMemo, useRef, useState } from 'react'
import * as v from 'valibot'

import { oneOf, textParam } from '../lib/params'
import { type Color, FilterField, toolbarStyle, useFilterText } from '../ui/controls'
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

const clock = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
} as const

const timeOnly = new Intl.DateTimeFormat(undefined, clock)

const dayAndTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...clock })

const fullTime = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', ...clock })

const isToday = (time: number) => new Date(time).toDateString() === new Date().toDateString()

const formatLogTime = (time: number) => (isToday(time) ? timeOnly : dayAndTime).format(time)

const shortName = (name: string) => name.slice(name.lastIndexOf('.') + 1)

const sourceOf = (record: LogRecord) =>
  record.subContext === undefined ? record.context : `${record.context} › ${record.subContext}`

const newestId = (records: LogRecord[]) => records.reduce((newest, record) => Math.max(newest, record.id), -1)

const none: LogRecord[] = []

// The view holds still while scrolled away from the newest records or paused, so reading isn't disturbed by
// records arriving at the top or being dropped at the bottom.
type Frozen = { records: LogRecord[]; newest: number; paused: boolean }

type Props = {
  search: LogsSearch
  onSearchChange: (patch: Partial<LogsSearch>) => void
}

export function LogsPage({ search, onSearchChange }: Props) {
  const { data, error, live } = useLogs()
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const records = data?.records ?? none
  const [frozen, setFrozen] = useState<Frozen>()
  const [selected, setSelected] = useState<LogRecord>()
  const scrollRef = useRef<HTMLDivElement>(null)

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

  // Without the list there's nothing to scroll back up.
  if (frozen?.paused === false && shown.length === 0) setFrozen(undefined)

  const freeze = (paused: boolean) =>
    setFrozen((current) => ({
      records: current?.records ?? records,
      newest: current?.newest ?? newestId(records),
      paused,
    }))

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const away = event.currentTarget.scrollTop >= 1
    if (away && frozen === undefined) freeze(false)
    else if (!away && frozen?.paused === false) setFrozen(undefined)
  }

  function resume() {
    setFrozen(undefined)
    scrollRef.current?.scrollTo({ top: 0 })
  }

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
        scrollRef={scrollRef}
        onScroll={onScroll}
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
          {frozen === undefined ? (
            <Tooltip content="Hold the list still. Scrolling down does too.">
              <Button size="1" variant="soft" color="gray" onClick={() => freeze(true)}>
                <PauseIcon />
                Pause
              </Button>
            </Tooltip>
          ) : (
            <Button size="1" variant="soft" onClick={resume}>
              <PlayIcon />
              Resume{unseen}
            </Button>
          )}
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
      <Cell title={fullTime.format(record.time)}>{formatLogTime(record.time)}</Cell>
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
    <Flex
      direction="column"
      gap="2"
      flexShrink="0"
      maxHeight="45%"
      px="4"
      py="3"
      style={{ boxShadow: 'inset 0 1px 0 0 var(--gray-a5)' }}
    >
      <Flex align="center" gap="3" wrap="wrap">
        <LevelText level={record.level} />
        <Text size="2" color="gray">
          {fullTime.format(record.time)}
        </Text>
        <Text size="2" color="gray" style={{ wordBreak: 'break-word' }}>
          {sourceOf(record)}
        </Text>
        <Flex ml="auto">
          <IconButton size="1" variant="ghost" color="gray" aria-label="Close" onClick={onClose}>
            <Cross2Icon />
          </IconButton>
        </Flex>
      </Flex>
      <Box minHeight="0" overflow="auto">
        <Text asChild size="2">
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--code-font-family)',
            }}
          >
            {record.message}
          </pre>
        </Text>
      </Box>
    </Flex>
  )
}
