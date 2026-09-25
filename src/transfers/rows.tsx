import { ChevronDownIcon, ChevronRightIcon, InfoCircledIcon, ListBulletIcon, ReloadIcon } from '@radix-ui/react-icons'
import { Checkbox, DataList, Flex, IconButton, Popover, Progress, Spinner, Text, Tooltip } from '@radix-ui/themes'
import { memo, type ReactNode } from 'react'
import { BrowseUserButton } from '../browse/BrowseUserButton'
import { formatBytes, formatProgress, formatSpeed, formatTime, toTime } from '../lib/format'
import { Ago, GatedIconButton } from '../ui/controls'
import { preventShiftSelection, stop } from '../ui/table'
import { type Lookup, lookUpPositions, retry } from './actions'
import { fraction, templates, timeOf } from './table'
import { type Direction, type Group, isFailed, isTransferring, type Section, type Transfer } from './transfers'

type Color = 'gray' | 'green' | 'red' | 'blue' | 'amber'

const stateLabels: Record<string, [string, Color]> = {
  Requested: ['Requested', 'gray'],
  'Queued, Locally': ['Queued locally', 'gray'],
  'Queued, Remotely': ['Queued remotely', 'gray'],
  Initializing: ['Initializing', 'gray'],
  InProgress: ['In progress', 'blue'],
  'Completed, Succeeded': ['Succeeded', 'green'],
  'Completed, Cancelled': ['Cancelled', 'red'],
  'Completed, TimedOut': ['Timed out', 'red'],
  'Completed, Errored': ['Errored', 'red'],
  'Completed, Rejected': ['Rejected', 'red'],
  'Completed, Aborted': ['Aborted', 'red'],
}

function describeState({ state, attempts }: Transfer): [string, Color] {
  const [label, color] = stateLabels[state] ?? [state, 'gray']
  return [label, color === 'gray' && attempts > 1 ? 'amber' : color]
}

function Bar({ value }: { value: number }) {
  return (
    <Flex align="center" gap="2" flexGrow="1" minWidth="0">
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
  selected: boolean
  pending: boolean
  lookup?: Lookup
  gate?: string
  onSelect: (section: Section, id: string, shiftKey: boolean) => void
}

export const FileRow = memo(function FileRow({
  file,
  section,
  direction,
  selected,
  pending,
  lookup,
  gate,
  onSelect,
}: FileRowProps) {
  const time = timeOf(section, file)
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: templates[section] }}
      data-selected={selected || undefined}
      onMouseDown={preventShiftSelection}
      onClick={(event) => onSelect(section, file.id, event.shiftKey)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox checked={selected} onClick={(event) => onSelect(section, file.id, event.shiftKey)} />
      </div>
      <div className="table-cell" style={{ paddingLeft: 36 }} title={file.filename}>
        <Text size="2">{file.name}</Text>
      </div>
      <div className="table-cell" />
      <div className="table-cell">
        <FileStatus file={file} direction={direction} pending={pending} lookup={lookup} />
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {section === 'active' && file.bytesTransferred > 0
            ? formatProgress(file.bytesTransferred, file.size)
            : formatBytes(file.size)}
        </Text>
      </div>
      {section === 'active' && (
        <div className="table-cell" data-align="end">
          <Text size="2" color="gray">
            {isTransferring(file.state) && formatSpeed(file.averageSpeed)}
          </Text>
        </div>
      )}
      <div className="table-cell">
        <Text size="2" color="gray">
          {time > 0 && <Ago time={time} />}
        </Text>
      </div>
      <Flex className="table-cell" gap="1" align="center" justify="end" onClick={stop}>
        {direction === 'download' && isFailed(file.state) && (
          <GatedIconButton label="Retry" gate={gate} onClick={() => retry([file])}>
            <ReloadIcon />
          </GatedIconButton>
        )}
        {direction === 'download' && file.state === 'Queued, Remotely' && (
          <GatedIconButton label="Check queue position" gate={gate} onClick={() => lookUpPositions([file])}>
            <ListBulletIcon />
          </GatedIconButton>
        )}
        <Popover.Root>
          <Popover.Trigger>
            <IconButton size="1" variant="ghost" color="gray" aria-label="Details">
              <InfoCircledIcon />
            </IconButton>
          </Popover.Trigger>
          <Popover.Content width="480px">
            <FileDetails file={file} direction={direction} />
          </Popover.Content>
        </Popover.Root>
      </Flex>
    </div>
  )
})

function FileStatus({
  file,
  direction,
  pending,
  lookup,
}: {
  file: Transfer
  direction: Direction
  pending: boolean
  lookup?: Lookup
}) {
  if (file.state === 'InProgress') return <Bar value={fraction(file)} />
  const [label, color] = describeState(file)
  const place = lookup?.place ?? file.placeInQueue
  return (
    <Flex align="center" gap="2">
      {file.exception === undefined ? (
        <Text size="2" color={color}>
          {label}
        </Text>
      ) : (
        <Tooltip content={file.exception}>
          <Text size="2" color={color}>
            {label}
          </Text>
        </Tooltip>
      )}
      {file.state === 'Queued, Remotely' &&
        lookup?.pending !== true &&
        lookup?.error === undefined &&
        place !== undefined && (
          <Text size="1" color="gray">
            #{place}
            {lookup?.at !== undefined && (
              <>
                {' · '}
                <Ago time={lookup.at} />
              </>
            )}
          </Text>
        )}
      {lookup?.error !== undefined && !lookup.pending && file.state === 'Queued, Remotely' && (
        <Tooltip content={lookup.error}>
          <Text size="1" color="red">
            lookup failed
          </Text>
        </Tooltip>
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
  const rows: [string, ReactNode][] = [
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
  return (
    <DataList.Root size="1">
      {rows.map(([label, value]) => (
        <DataList.Item key={label}>
          <DataList.Label minWidth="110px">{label}</DataList.Label>
          <DataList.Value style={{ wordBreak: 'break-word' }}>{value}</DataList.Value>
        </DataList.Item>
      ))}
    </DataList.Root>
  )
}

type GroupRowProps = {
  group: Group
  direction: Direction
  expanded: boolean
  selected: boolean
  partial: boolean
  gate?: string
  onSelect: (section: Section, id: string, shiftKey: boolean) => void
  onToggle: (section: Section, id: string) => void
}

export const GroupRow = memo(function GroupRow({
  group,
  direction,
  expanded,
  selected,
  partial,
  gate,
  onSelect,
  onToggle,
}: GroupRowProps) {
  const { section, folder } = group
  const queued = direction === 'download' ? group.files.filter((file) => file.state === 'Queued, Remotely') : []
  const done = `${folder.succeeded.toLocaleString()}/${folder.total.toLocaleString()} done`
  return (
    <div
      className="table-row table-group"
      style={{ gridTemplateColumns: templates[section] }}
      data-selected={selected || undefined}
      onMouseDown={preventShiftSelection}
      onClick={() => onToggle(section, group.id)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox
          checked={selected ? true : partial ? 'indeterminate' : false}
          onClick={(event) => onSelect(section, group.id, event.shiftKey)}
        />
      </div>
      <Flex className="table-cell" align="center" gap="2" title={group.directory}>
        {expanded ? <ChevronDownIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
        <Text size="2" weight="medium" truncate>
          {group.name}
        </Text>
        <Text size="1" color="gray">
          {group.files.length.toLocaleString()}
        </Text>
      </Flex>
      <div className="table-cell" title={group.username}>
        <Text size="2">{group.username}</Text>
      </div>
      <Flex className="table-cell" align="center" gap="2">
        {section === 'active' && <Bar value={fraction(group)} />}
        <Text size="1" color="gray" style={{ flexShrink: 0 }}>
          {done}
        </Text>
        {folder.failed > 0 && (
          <Text size="1" color="red" style={{ flexShrink: 0 }}>
            {folder.failed.toLocaleString()} failed
          </Text>
        )}
      </Flex>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {section === 'active' && group.bytesTransferred > 0
            ? formatProgress(group.bytesTransferred, group.size)
            : formatBytes(group.size)}
        </Text>
      </div>
      {section === 'active' && (
        <div className="table-cell" data-align="end">
          <Text size="2" color="gray">
            {group.speed > 0 && formatSpeed(group.speed)}
          </Text>
        </div>
      )}
      <div className="table-cell">
        <Text size="2" color="gray">
          {group.time > 0 && <Ago time={group.time} />}
        </Text>
      </div>
      <Flex className="table-cell" gap="1" align="center" justify="end" onClick={stop}>
        {queued.length > 0 && (
          <GatedIconButton label="Check queue positions" gate={gate} onClick={() => lookUpPositions(queued)}>
            <ListBulletIcon />
          </GatedIconButton>
        )}
        <BrowseUserButton username={group.username} directory={group.directory} />
      </Flex>
    </div>
  )
})
