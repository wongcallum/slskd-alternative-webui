import { Badge, Button, DropdownMenu, Flex, Text } from '@radix-ui/themes'
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react'
import * as v from 'valibot'
import { stringify } from 'yaml'

import { describeError } from '../lib/api'
import { formatFullPreciseTime, formatPreciseTime, plural } from '../lib/format'
import { textParam } from '../lib/params'
import { useAtom, useResource } from '../lib/store'
import { toStringOptions, yamlVersion } from '../lib/yaml'
import { useFilterText } from '../ui/controls'
import { DetailsPane } from '../ui/details'
import { HeldList, HeldToolbar, useHold } from '../ui/hold'
import { Busy, Empty, Freshness, Polling } from '../ui/status'
import { Cell, GridRow, type Layout, Parts, rowHeight, StackedRow } from '../ui/table'
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
        {held.length === 0 ? 'No events yet.' : 'None of the loaded events match.'}
      </Empty>
    )
  } else {
    content = (
      <HeldList
        templates={templates}
        labels={labels}
        records={shown}
        itemKey={eventId}
        selected={selected?.id}
        onSelect={setSelected}
        renderRow={(record, layout, isSelected, toggle) => (
          <EventRow record={record} layout={layout} selected={isSelected} onSelect={toggle} />
        )}
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
      <HeldToolbar placeholder="Filter by type, user or text" filter={filter} hold={hold} unseen={unseen}>
        <TypesMenu
          hidden={hidden}
          records={records}
          onChange={(next) => onSearchChange({ hide: formatHidden(next) })}
        />
        {data !== undefined && (
          <Text size="2" color="gray">
            {filtered
              ? `${shown.length.toLocaleString()} of the ${held.length.toLocaleString()} loaded events match`
              : `${held.length.toLocaleString()} of ${plural(data.total, 'event')} loaded`}
          </Text>
        )}
        {data !== undefined && filtered && (
          <Text size="2" color="gray">
            {data.total.toLocaleString()} in total
          </Text>
        )}
      </HeldToolbar>
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
  else if (!hasOlder(data)) content = 'All events are loaded.'
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

const templates = {
  wide: '170px 160px 180px minmax(300px, 1fr)',
  medium: '140px 150px 130px minmax(300px, 1fr)',
}

const labels = ['Time', 'Type', 'User', 'Details']

const eventId = (record: EventRecord) => record.id

type EventRowProps = {
  record: EventRecord
  layout: Layout
  selected: boolean
  onSelect: (record: EventRecord) => void
}

const EventRow = memo(function EventRow({ record, layout, selected, onSelect }: EventRowProps) {
  const { user, room, text, replayed } = record.summary
  const details = (
    <>
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
          Replayed
        </Badge>
      )}
    </>
  )
  if (layout === 'stacked') {
    // An event with nothing to say, such as a connect, is titled by its type.
    const titled = text === undefined || text === ''
    return (
      <StackedRow
        selected={selected}
        title={titled ? <Text size="2">{typeLabel(record.type)}</Text> : details}
        meta={
          <Parts
            items={[
              formatPreciseTime(record.time),
              !titled && typeLabel(record.type),
              user !== undefined && <UserMenu key="user" username={user} />,
            ]}
          />
        }
        style={{ cursor: 'pointer' }}
        onClick={() => onSelect(record)}
      />
    )
  }
  return (
    <GridRow
      template={templates[layout]}
      selected={selected}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(record)}
    >
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
        {details}
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
