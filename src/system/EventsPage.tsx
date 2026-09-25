import { Badge, Button, DropdownMenu, Flex, Text } from '@radix-ui/themes'
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react'
import * as v from 'valibot'
import { stringify } from 'yaml'

import { describeError } from '../lib/api'
import { formatFullPreciseTime, formatPreciseTime, plural } from '../lib/format'
import { textParam } from '../lib/params'
import { useAtom, useResource } from '../lib/store'
import { toStringOptions, yamlVersion } from '../lib/yaml'
import { FilterField, toolbarStyle, useFilterText } from '../ui/controls'
import { DetailsPane } from '../ui/details'
import { HoldButton, useHold } from '../ui/hold'
import { Busy, Empty, Freshness, Polling } from '../ui/status'
import { Cell, ColumnHeader, GridRow, HeaderRow, rowHeight, VirtualTable } from '../ui/table'
import { YamlView } from '../ui/YamlView'
import { UserMenu } from '../users/UserMenu'
import {
  type EventRecord,
  eventMatcher,
  events,
  eventsPageSize,
  eventsPollInterval,
  type Events,
  hasOlder,
  knownTypes,
  loadOlder,
  olderLoad,
  typeLabel,
} from './events'
import { SystemPage } from './SystemPage'

export const eventsSearch = v.object({ q: textParam, hide: textParam })

export const eventsSearchDefaults = { q: '', hide: '' } as const

export type EventsSearch = v.InferOutput<typeof eventsSearch>

const parseHidden = (hide: string) => new Set(hide.split(',').filter((type) => type !== ''))

const formatHidden = (hidden: ReadonlySet<string>) => [...hidden].sort().join(',')

const none: readonly EventRecord[] = []

// Rows found at the top after the hold are new. Older pages keep arriving at the bottom, unless the held rows were
// thrown away for the newest page, when only the snapshot is left to show.
type Marker = { order: number; generation: number; records: readonly EventRecord[] }

const newestOrder = (records: readonly EventRecord[]) => records.reduce((max, record) => Math.max(max, record.order), 0)

// Close enough to the end that the next page is fetched before it's reached.
const nearEnd = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < 20 * rowHeight

type Props = {
  search: EventsSearch
  onSearchChange: (patch: Partial<EventsSearch>) => void
}

export function EventsPage({ search, onSearchChange }: Props) {
  const { data, error } = useResource(events)
  const older = useAtom(olderLoad)
  const filter = useFilterText(search.q, (q) => onSearchChange({ q }))
  const hidden = useMemo(() => parseHidden(search.hide), [search.hide])
  const records = data?.records ?? none
  const generation = data?.generation
  const hold = useHold<Marker>(() => ({ order: newestOrder(records), generation: generation ?? 0, records }))
  const frozen = hold.marker
  const [selected, setSelected] = useState<EventRecord>()

  const matches = useMemo(() => eventMatcher(filter.query, hidden), [filter.query, hidden])
  const replaced = frozen !== undefined && frozen.generation !== generation
  const held = useMemo(() => {
    if (frozen === undefined) return records
    if (replaced) return frozen.records
    return records.filter((record) => record.order <= frozen.order)
  }, [frozen, replaced, records])
  const shown = useMemo(() => (matches === undefined ? held : held.filter(matches)), [held, matches])
  const unseen = useMemo(() => {
    if (frozen === undefined) return ''
    let count = 0
    for (const record of records) if (record.order > frozen.order && (matches?.(record) ?? true)) count++
    if (count === 0 && !replaced) return ''
    return ` (${count.toLocaleString()}${replaced ? '+' : ''} new)`
  }, [frozen, replaced, records, matches])

  hold.releaseIfEmpty(shown.length === 0)

  const filtered = matches !== undefined
  const automatic =
    data !== undefined && !filtered && !replaced && hasOlder(data) && !older.loading && older.error === undefined

  useEffect(() => {
    const element = hold.scrollRef.current
    if (automatic && shown.length > 0 && element !== null && nearEnd(element)) void loadOlder()
  }, [automatic, shown, hold.scrollRef])

  let content: ReactNode
  if (data === undefined) {
    content = <Polling what="the events" error={error} />
  } else if (shown.length === 0) {
    content = (
      <Empty actions={!replaced && <OlderButton data={data} filtered={filtered} />}>
        {held.length === 0 ? 'No events yet.' : 'Nothing loaded matches.'}
      </Empty>
    )
  } else {
    content = (
      <EventList
        records={shown}
        selected={selected?.id}
        onSelect={(record) => setSelected(record.id === selected?.id ? undefined : record)}
        hold={hold}
        onScroll={(element) => {
          if (automatic && nearEnd(element)) void loadOlder()
        }}
        footer={<ListEnd data={data} filtered={filtered} replaced={replaced} />}
      />
    )
  }

  return (
    <SystemPage
      status={
        <Freshness resource={events} interval={eventsPollInterval} error={data === undefined ? undefined : error} />
      }
    >
      <Flex align="center" gap="3" px="4" py="2" flexShrink="0" wrap="wrap" style={toolbarStyle}>
        <FilterField
          placeholder="Filter by type, user or text"
          value={filter.text}
          onChange={filter.change}
          style={{ width: 280 }}
        />
        <TypesMenu
          hidden={hidden}
          records={records}
          onChange={(next) => onSearchChange({ hide: formatHidden(next) })}
        />
        {data !== undefined && (
          <Text size="2" color="gray">
            {filtered
              ? `${shown.length.toLocaleString()} of ${held.length.toLocaleString()} loaded match · ${data.total.toLocaleString()} in total`
              : `${held.length.toLocaleString()} of ${plural(data.total, 'event')} loaded`}
          </Text>
        )}
        <Flex ml="auto" align="center" gap="3" flexShrink="0">
          <HoldButton held={hold.held} unseen={unseen} onPause={hold.pause} onResume={hold.resume} />
        </Flex>
      </Flex>
      {content}
      {selected !== undefined && <EventDetails record={selected} onClose={() => setSelected(undefined)} />}
    </SystemPage>
  )
}

function TypesMenu({
  hidden,
  records,
  onChange,
}: {
  hidden: ReadonlySet<string>
  records: readonly EventRecord[]
  onChange: (hidden: ReadonlySet<string>) => void
}) {
  const types = useMemo(() => {
    const all = new Set([...knownTypes, ...hidden])
    for (const record of records) all.add(record.type)
    return [...all]
  }, [hidden, records])
  const toggle = (type: string, shown: boolean) => {
    const next = new Set(hidden)
    if (shown) next.delete(type)
    else next.add(type)
    onChange(next)
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button variant="soft" color="gray">
          {hidden.size === 0 ? 'All types' : `${plural(hidden.size, 'type')} hidden`}
          <DropdownMenu.TriggerIcon />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {types.map((type) => (
          <DropdownMenu.CheckboxItem
            key={type}
            checked={!hidden.has(type)}
            onCheckedChange={(checked) => toggle(type, checked)}
            // Several types are often toggled at once.
            onSelect={(event) => event.preventDefault()}
          >
            {typeLabel(type)}
          </DropdownMenu.CheckboxItem>
        ))}
        <DropdownMenu.Separator />
        <DropdownMenu.Item disabled={hidden.size === 0} onSelect={() => onChange(new Set())}>
          Show all types
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

function OlderButton({ data, filtered }: { data: Events; filtered: boolean }) {
  const older = useAtom(olderLoad)
  if (!hasOlder(data)) return null
  if (older.loading) return <Busy>Loading older events…</Busy>
  return (
    <Flex align="center" gap="3" wrap="wrap">
      {older.error !== undefined && (
        <Text size="2" color="red">
          Couldn't load older events: {describeError(older.error)}
        </Text>
      )}
      {(filtered || older.error !== undefined) && (
        <Button size="1" variant="soft" onClick={() => void loadOlder()}>
          {older.error === undefined ? `Load ${eventsPageSize} older` : 'Try again'}
        </Button>
      )}
    </Flex>
  )
}

function ListEnd({ data, filtered, replaced }: { data: Events; filtered: boolean; replaced: boolean }) {
  let content: ReactNode
  if (replaced) content = 'Resume to see the newest events and load older ones.'
  else if (!hasOlder(data)) content = `All ${plural(data.total, 'event')} are loaded.`
  else content = <OlderButton data={data} filtered={filtered} />
  return (
    <Flex align="center" px="4" py="3" minHeight={`${rowHeight}px`}>
      {typeof content === 'string' ? (
        <Text size="2" color="gray">
          {content}
        </Text>
      ) : (
        content
      )}
    </Flex>
  )
}

const template = '170px 160px 180px minmax(300px, 1fr)'

const minWidth = 900

const eventId = (record: EventRecord) => record.id

type EventListProps = {
  records: readonly EventRecord[]
  selected?: string
  onSelect: (record: EventRecord) => void
  hold: ReturnType<typeof useHold<Marker>>
  onScroll: (element: HTMLDivElement) => void
  footer: ReactNode
}

function EventList({ records, selected, onSelect, hold, onScroll, footer }: EventListProps) {
  const header = (
    <HeaderRow template={template}>
      <ColumnHeader label="Time" />
      <ColumnHeader label="Type" />
      <ColumnHeader label="User" />
      <ColumnHeader label="Details" />
    </HeaderRow>
  )
  return (
    <VirtualTable
      minWidth={minWidth}
      header={header}
      items={records}
      itemKey={eventId}
      renderItem={(record) => <EventRow record={record} selected={record.id === selected} onSelect={onSelect} />}
      scrollRef={hold.scrollRef}
      onScroll={(event) => {
        hold.onScroll(event)
        onScroll(event.currentTarget)
      }}
      footer={footer}
    />
  )
}

type EventRowProps = { record: EventRecord; selected: boolean; onSelect: (record: EventRecord) => void }

const EventRow = memo(function EventRow({ record, selected, onSelect }: EventRowProps) {
  const { user, room, text, replayed } = record.summary
  return (
    <GridRow template={template} selected={selected} style={{ cursor: 'pointer' }} onClick={() => onSelect(record)}>
      <Cell title={formatFullPreciseTime(record.time)}>{formatPreciseTime(record.time)}</Cell>
      <Cell title={record.type}>{typeLabel(record.type)}</Cell>
      <div className="table-cell" title={user}>
        {user !== undefined && (
          <Text size="2">
            <UserMenu username={user} />
          </Text>
        )}
      </div>
      <Flex className="table-cell" align="center" gap="2" title={text}>
        {room !== undefined && (
          <Text size="2" color="gray" truncate style={{ flexShrink: 0, maxWidth: '40%' }}>
            {room}
          </Text>
        )}
        <Text size="2" truncate>
          {text}
        </Text>
        {replayed === true && (
          <Badge size="1" color="gray" style={{ flexShrink: 0 }}>
            replayed
          </Badge>
        )}
      </Flex>
    </GridRow>
  )
})

function EventDetails({ record, onClose }: { record: EventRecord; onClose: () => void }) {
  const source = useMemo(() => stringify(record.data, { version: yamlVersion, ...toStringOptions }), [record.data])
  return (
    <DetailsPane
      header={
        <>
          <Text size="2" weight="medium" title={record.type}>
            {typeLabel(record.type)}
          </Text>
          <Text size="2" color="gray" title={record.timestamp}>
            {formatFullPreciseTime(record.time)}
          </Text>
          <Text size="2" color="gray">
            {record.id}
          </Text>
        </>
      }
      onClose={onClose}
    >
      <YamlView source={source} />
    </DetailsPane>
  )
}
