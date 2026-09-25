import { ListBulletIcon, ReloadIcon } from '@radix-ui/react-icons'
import { Flex, Progress, Spinner, Text } from '@radix-ui/themes'
import { memo } from 'react'

import { BrowseUserButton } from '../browse/BrowseUserButton'
import { formatBytes, formatProgress, formatSpeed, formatTime, toTime } from '../lib/format'
import { type Color, type Detail, DetailList, DetailsButton, GatedIconButton, Tip } from '../ui/controls'
import { Ago } from '../ui/status'
import {
  ActionsCell,
  Cell,
  CheckCell,
  GridRow,
  GroupName,
  GroupNameCell,
  type Layout,
  Parts,
  StackedRow,
} from '../ui/table'
import { UserMenu } from '../users/UserMenu'
import { type Lookup, lookUpPositions, retry } from './actions'
import { fraction, templates, timeOf } from './table'
import {
  type Direction,
  type Group,
  isFinished,
  isRetryable,
  isTransferring,
  type Section,
  type Transfer,
} from './transfers'

const stateLabels: Record<string, [string, Color]> = {
  Requested: ['Requested', 'gray'],
  'Queued, Locally': ['Queued locally', 'gray'],
  'Queued, Remotely': ['Queued remotely', 'gray'],
  Initializing: ['Initializing', 'gray'],
  InProgress: ['In progress', 'blue'],
  'Completed, Succeeded': ['Succeeded', 'green'],
  'Completed, Cancelled': ['Cancelled', 'gray'],
  'Completed, TimedOut': ['Timed out', 'red'],
  'Completed, Errored': ['Errored', 'red'],
  'Completed, Rejected': ['Rejected', 'red'],
  'Completed, Aborted': ['Aborted', 'red'],
}

function describeState({ state, attempts }: Transfer): [string, Color] {
  const [label, color] = stateLabels[state] ?? [state, 'gray']
  return [label, color === 'gray' && !isFinished(state) && attempts > 1 ? 'amber' : color]
}

// Stacked, the bar has a width of its own, since the line it's on doesn't stretch.
function Bar({ value, stacked }: { value: number; stacked?: boolean }) {
  return (
    <Flex align="center" gap="2" flexGrow="1" minWidth="0" width={stacked ? '120px' : undefined}>
      <Progress value={value * 100} size="1" style={{ flex: 1 }} />
      <Text size="1" color="gray">
        {Math.floor(value * 100)}%
      </Text>
    </Flex>
  )
}

type FileRowProps = {
  file: Transfer
  section: Section
  direction: Direction
  layout: Layout
  selected: boolean
  pending: boolean
  lookup?: Lookup
  gate?: string
  retryGate?: string
  onSelect: (id: string, shiftKey: boolean) => void
}

export const FileRow = memo(function FileRow({
  file,
  section,
  direction,
  layout,
  selected,
  pending,
  lookup,
  gate,
  retryGate,
  onSelect,
}: FileRowProps) {
  const time = timeOf(section, file)
  const size =
    section === 'active' && file.bytesTransferred > 0
      ? formatProgress(file.bytesTransferred, file.size)
      : formatBytes(file.size)
  const speed = section === 'active' && isTransferring(file.state) ? formatSpeed(file.averageSpeed) : undefined
  const check = <CheckCell selected={selected} onToggle={(shiftKey) => onSelect(file.id, shiftKey)} />
  const actions = (
    <>
      {direction === 'download' && isRetryable(file.state) && (
        <GatedIconButton label="Retry" gate={retryGate} onClick={() => retry([file])}>
          <ReloadIcon />
        </GatedIconButton>
      )}
      {direction === 'download' && file.state === 'Queued, Remotely' && (
        <GatedIconButton label="Check queue position" gate={gate} onClick={() => lookUpPositions([file])}>
          <ListBulletIcon />
        </GatedIconButton>
      )}
      <DetailsButton>
        <FileDetails file={file} direction={direction} />
      </DetailsButton>
    </>
  )
  const status = <FileStatus file={file} direction={direction} pending={pending} lookup={lookup} layout={layout} />
  if (layout === 'stacked') {
    return (
      <StackedRow
        indent
        selected={selected}
        check={check}
        title={
          <Text size="2" truncate>
            {file.name}
          </Text>
        }
        meta={<Parts items={[status, size, speed, time > 0 && <Ago key="time" time={time} />]} />}
        actions={actions}
        onClick={(event) => onSelect(file.id, event.shiftKey)}
      />
    )
  }
  return (
    <GridRow
      template={templates[layout][section]}
      selected={selected}
      onClick={(event) => onSelect(file.id, event.shiftKey)}
    >
      {check}
      <div className="table-cell" style={{ paddingLeft: 36 }} title={file.filename}>
        <Text size="2">{file.name}</Text>
      </div>
      <div className="table-cell" />
      <div className="table-cell">{status}</div>
      <Cell end>{size}</Cell>
      {section === 'active' && <Cell end>{speed}</Cell>}
      {layout === 'wide' && <Cell>{time > 0 && <Ago time={time} />}</Cell>}
      <ActionsCell gap="1">{actions}</ActionsCell>
    </GridRow>
  )
})

function FileStatus({
  file,
  direction,
  pending,
  lookup,
  layout,
}: {
  file: Transfer
  direction: Direction
  pending: boolean
  lookup?: Lookup
  layout: Layout
}) {
  const stacked = layout === 'stacked'
  if (file.state === 'InProgress') return <Bar value={fraction(file)} stacked={stacked} />
  const [label, color] = describeState(file)
  const place = lookup?.place ?? file.placeInQueue
  const text = (
    <Text size={stacked ? '1' : '2'} color={color}>
      {label}
    </Text>
  )
  return (
    <Flex align="center" gap="2">
      {file.exception === undefined ? text : <Tip content={file.exception}>{text}</Tip>}
      {file.state === 'Queued, Remotely' &&
        lookup?.pending !== true &&
        lookup?.error === undefined &&
        place !== undefined && (
          <Text size="1" color="gray">
            #{place}
            {lookup?.at !== undefined && (
              <>
                {' as of '}
                <Ago time={lookup.at} />
              </>
            )}
          </Text>
        )}
      {lookup?.error !== undefined && !lookup.pending && file.state === 'Queued, Remotely' && (
        <Tip content={lookup.error}>
          <Text size="1" color="red">
            position check failed
          </Text>
        </Tip>
      )}
      {direction === 'download' && file.attempts > 1 && (
        <Text size="1" color="gray">
          attempt {file.attempts}
        </Text>
      )}
      {(pending || lookup?.pending === true) && <Spinner size="1" />}
    </Flex>
  )
}

function FileDetails({ file, direction }: { file: Transfer; direction: Direction }) {
  const rows: Detail[] = [
    ['User', file.username],
    ['Folder', file.directory],
    ['File', file.name],
    ['Size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`],
    ['State', file.state],
    ['Requested', formatTime(toTime(file.requestedAt))],
  ]
  if (file.enqueuedAt !== undefined) rows.push(['Enqueued', formatTime(toTime(file.enqueuedAt))])
  if (file.startedAt !== undefined) rows.push(['Started', formatTime(toTime(file.startedAt))])
  if (file.endedAt !== undefined) rows.push(['Ended', formatTime(toTime(file.endedAt))])
  rows.push(['Transferred', formatBytes(file.bytesTransferred)], ['Average speed', formatSpeed(file.averageSpeed)])
  if (file.placeInQueue !== undefined) rows.push(['Place in queue', file.placeInQueue])
  if (direction === 'download') rows.push(['Attempts', file.attempts])
  if (file.exception !== undefined) rows.push(['Error', file.exception])
  if (file.batchId !== undefined) rows.push(['Batch', file.batchId])
  rows.push(['ID', file.id])
  return <DetailList rows={rows} />
}

type GroupRowProps = {
  group: Group
  direction: Direction
  layout: Layout
  expanded: boolean
  selected: boolean
  partial: boolean
  gate?: string
  onSelect: (id: string, shiftKey: boolean) => void
  onToggle: (section: Section, id: string) => void
}

export const GroupRow = memo(function GroupRow({
  group,
  direction,
  layout,
  expanded,
  selected,
  partial,
  gate,
  onSelect,
  onToggle,
}: GroupRowProps) {
  const { section, folder } = group
  const queued = direction === 'download' ? group.files.filter((file) => file.state === 'Queued, Remotely') : []
  const count = (
    <Text size="1" color="gray">
      {group.files.length.toLocaleString()}
    </Text>
  )
  const done = `${folder.succeeded.toLocaleString()}/${folder.total.toLocaleString()} done`
  const failed = folder.failed > 0 && (
    <Text size="1" color="red" style={{ flexShrink: 0 }}>
      {folder.failed.toLocaleString()} failed
    </Text>
  )
  const cancelled = folder.cancelled > 0 && (
    <Text size="1" color="gray" style={{ flexShrink: 0 }}>
      {folder.cancelled.toLocaleString()} cancelled
    </Text>
  )
  const size =
    section === 'active' && group.bytesTransferred > 0
      ? formatProgress(group.bytesTransferred, group.size)
      : formatBytes(group.size)
  const speed = section === 'active' && group.speed > 0 ? formatSpeed(group.speed) : undefined
  const check = (
    <CheckCell selected={selected} partial={partial} onToggle={(shiftKey) => onSelect(group.id, shiftKey)} />
  )
  const actions = (
    <>
      {queued.length > 0 && (
        <GatedIconButton label="Check queue positions" gate={gate} onClick={() => lookUpPositions(queued)}>
          <ListBulletIcon />
        </GatedIconButton>
      )}
      <BrowseUserButton username={group.username} directory={group.directory} />
    </>
  )
  if (layout === 'stacked') {
    return (
      <StackedRow
        group
        selected={selected}
        check={check}
        title={
          <GroupName expanded={expanded} name={group.name}>
            {count}
          </GroupName>
        }
        meta={
          <Parts
            items={[
              <UserMenu key="user" username={group.username} />,
              section === 'active' && <Bar key="bar" value={fraction(group)} stacked />,
              done,
              failed,
              cancelled,
              size,
              speed,
              group.time > 0 && <Ago key="time" time={group.time} />,
            ]}
          />
        }
        actions={actions}
        onClick={() => onToggle(section, group.id)}
      />
    )
  }
  return (
    <GridRow
      template={templates[layout][section]}
      group
      selected={selected}
      onClick={() => onToggle(section, group.id)}
    >
      {check}
      <GroupNameCell expanded={expanded} name={group.name} title={group.directory}>
        {count}
      </GroupNameCell>
      <div className="table-cell" title={group.username}>
        <Text size="2">
          <UserMenu username={group.username} />
        </Text>
      </div>
      <Flex className="table-cell" align="center" gap="2">
        {section === 'active' && <Bar value={fraction(group)} />}
        <Text size="1" color="gray" style={{ flexShrink: 0 }}>
          {done}
        </Text>
        {failed}
        {cancelled}
      </Flex>
      <Cell end>{size}</Cell>
      {section === 'active' && <Cell end>{speed}</Cell>}
      {layout === 'wide' && <Cell>{group.time > 0 && <Ago time={group.time} />}</Cell>}
      <ActionsCell gap="1">{actions}</ActionsCell>
    </GridRow>
  )
})
