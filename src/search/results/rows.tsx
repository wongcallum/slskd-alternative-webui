import {
  CardStackPlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  InfoCircledIcon,
  LockClosedIcon,
} from '@radix-ui/react-icons'
import { Badge, Checkbox, DataList, Flex, IconButton, Popover, Spinner, Text } from '@radix-ui/themes'
import { memo, type ReactNode } from 'react'
import { BrowseUserButton } from '../../browse/BrowseUserButton'
import { formatBytes, formatDuration, formatSpeed, formatTime, plural } from '../../lib/format'
import type { Mark } from '../../transfers/enqueue'
import { MarkBadge } from '../../transfers/MarkBadge'
import { GatedIconButton } from '../../ui/controls'
import { preventShiftSelection, stop } from '../../ui/table'
import { download, type FolderFetch, fetchFolder, type ResultFile, type ResultGroup } from './results'
import { template } from './table'

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <DataList.Root size="1">
      {rows.map(([label, value]) => (
        <DataList.Item key={label}>
          <DataList.Label minWidth="120px">{label}</DataList.Label>
          <DataList.Value style={{ wordBreak: 'break-word' }}>{value}</DataList.Value>
        </DataList.Item>
      ))}
    </DataList.Root>
  )
}

function DetailsButton({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Popover.Root>
      <Popover.Trigger>
        <IconButton size="1" variant="ghost" color="gray" aria-label="Details">
          <InfoCircledIcon />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="480px">
        <Details rows={rows} />
      </Popover.Content>
    </Popover.Root>
  )
}

type FileRowProps = {
  searchId: string
  file: ResultFile
  selected: boolean
  pending: boolean
  mark?: Mark
  gate?: string
  onSelect: (id: string, shiftKey: boolean) => void
}

export const FileRow = memo(function FileRow({
  searchId,
  file,
  selected,
  pending,
  mark,
  gate,
  onSelect,
}: FileRowProps) {
  const details: [string, ReactNode][] = [
    ['User', file.username],
    ['Folder', file.directory],
    ['File', file.name],
    ['Size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`],
  ]
  if (file.bitRate !== undefined) details.push(['Bitrate', `${file.bitRate} kbps`])
  if (file.isVariableBitRate !== undefined) details.push(['Variable bitrate', file.isVariableBitRate ? 'Yes' : 'No'])
  if (file.bitDepth !== undefined) details.push(['Bit depth', file.bitDepth])
  if (file.sampleRate !== undefined) details.push(['Sample rate', `${file.sampleRate.toLocaleString()} Hz`])
  if (file.length !== undefined) details.push(['Length', formatDuration(file.length)])
  details.push(
    ['Matched', file.matched ? 'Yes' : 'No, fetched with the full folder'],
    ['Locked', file.locked ? 'Yes, only shared with some users' : 'No'],
  )
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: template }}
      data-selected={selected || undefined}
      data-dimmed={file.locked || undefined}
      onMouseDown={preventShiftSelection}
      onClick={(event) => !file.locked && onSelect(file.id, event.shiftKey)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox checked={selected} disabled={file.locked} onClick={(event) => onSelect(file.id, event.shiftKey)} />
      </div>
      <Flex className="table-cell" align="center" gap="2" style={{ paddingLeft: 36 }} title={file.filename}>
        {file.locked && <LockClosedIcon style={{ flexShrink: 0 }} />}
        <Text size="2" truncate>
          {file.name}
        </Text>
        {!file.matched && <Badge color="gray">not matched</Badge>}
        {mark !== undefined && <MarkBadge mark={mark} />}
        {pending && <Spinner size="1" />}
      </Flex>
      <div className="table-cell" />
      <div className="table-cell" />
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(file.size)}
        </Text>
      </div>
      <div className="table-cell">
        <Text size="2" color="gray">
          {file.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {file.length !== undefined && formatDuration(file.length)}
        </Text>
      </div>
      <div className="table-cell" />
      <div className="table-cell" />
      <Flex className="table-cell" gap="3" align="center" justify="end" onClick={stop}>
        {!file.locked && (
          <GatedIconButton label="Download" gate={gate} onClick={() => void download(searchId, [file])}>
            <DownloadIcon />
          </GatedIconButton>
        )}
        <IconButton size="1" variant="ghost" aria-hidden tabIndex={-1} style={{ visibility: 'hidden' }}>
          <CardStackPlusIcon />
        </IconButton>
        <IconButton size="1" variant="ghost" aria-hidden tabIndex={-1} style={{ visibility: 'hidden' }}>
          <CardStackPlusIcon />
        </IconButton>
        <DetailsButton rows={details} />
      </Flex>
    </div>
  )
})

type GroupRowProps = {
  searchId: string
  group: ResultGroup
  expanded: boolean
  selected: boolean
  partial: boolean
  fetch?: FolderFetch
  gate?: string
  folderGate?: string
  onSelect: (id: string, shiftKey: boolean) => void
  onToggle: (id: string) => void
}

export const GroupRow = memo(function GroupRow({
  searchId,
  group,
  expanded,
  selected,
  partial,
  fetch,
  gate,
  folderGate,
  onSelect,
  onToggle,
}: GroupRowProps) {
  const { peer } = group
  const open = group.files.filter((file) => !file.locked)
  const extra = group.files.length - group.matched
  const hidden = group.total - group.files.length
  const fetched = fetch?.files !== undefined
  const details: [string, ReactNode][] = [
    ['Folder', group.directory],
    ['User', group.username],
    ['Upload speed', formatSpeed(peer.speed)],
    ['Free upload slot', peer.free ? 'Yes' : 'No'],
    ['Queue length', peer.queueLength.toLocaleString()],
    ['Matched files', group.matched.toLocaleString()],
  ]
  if (fetched) details.push(['Fetched files', `${extra.toLocaleString()} more`])
  if (hidden > 0) details.push(['Filtered out', plural(hidden, 'file')])
  if (fetch?.at !== undefined) {
    details.push([fetch.error === undefined ? 'Folder fetched' : 'Folder fetch failed', formatTime(fetch.at)])
  }
  if (fetch?.error !== undefined) details.push(['Error', fetch.error])
  return (
    <div
      className="table-row table-group"
      style={{ gridTemplateColumns: template }}
      data-selected={selected || undefined}
      data-dimmed={open.length === 0 || undefined}
      onMouseDown={preventShiftSelection}
      onClick={() => onToggle(group.id)}
    >
      <div className="table-cell table-check" onClick={stop}>
        <Checkbox
          checked={selected ? true : partial ? 'indeterminate' : false}
          disabled={open.length === 0}
          onClick={(event) => onSelect(group.id, event.shiftKey)}
        />
      </div>
      <Flex className="table-cell" align="center" gap="2" title={group.directory}>
        {expanded ? <ChevronDownIcon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
        <Text size="2" weight="medium" truncate>
          {group.name}
        </Text>
      </Flex>
      <div className="table-cell" title={group.username}>
        <Text size="2">{group.username}</Text>
      </div>
      <div
        className="table-cell"
        data-align="end"
        title={hidden > 0 ? `${plural(hidden, 'file')} filtered out` : undefined}
      >
        <Text size="2" color="gray">
          {hidden > 0
            ? `${group.files.length.toLocaleString()} of ${group.total.toLocaleString()}`
            : `${group.matched.toLocaleString()}${fetched ? ` + ${extra.toLocaleString()}` : ''}`}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatBytes(group.size)}
        </Text>
      </div>
      <div className="table-cell" title={group.qualityLabel}>
        <Text size="2" color="gray">
          {group.qualityLabel}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {group.length > 0 && formatDuration(group.length)}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {formatSpeed(peer.speed)}
        </Text>
      </div>
      <div className="table-cell" data-align="end">
        {peer.free ? (
          <Text size="2" color="green">
            free
          </Text>
        ) : (
          <Text size="2" color="gray">
            {peer.queueLength.toLocaleString()}
          </Text>
        )}
      </div>
      <Flex className="table-cell" gap="3" align="center" justify="end" onClick={stop}>
        {open.length > 0 && (
          <GatedIconButton label="Download folder" gate={gate} onClick={() => void download(searchId, open)}>
            <DownloadIcon />
          </GatedIconButton>
        )}
        {fetch?.pending ? (
          <Spinner size="1" />
        ) : (
          <GatedIconButton
            label={
              fetch?.error !== undefined
                ? `Couldn't get the full folder: ${fetch.error}. Try again`
                : fetched
                  ? 'Get the full folder again'
                  : 'Get the full folder'
            }
            color={fetch?.error === undefined ? undefined : 'red'}
            gate={folderGate}
            onClick={() => void fetchFolder(searchId, group)}
          >
            <CardStackPlusIcon />
          </GatedIconButton>
        )}
        <BrowseUserButton username={group.username} directory={group.directory} />
        <DetailsButton rows={details} />
      </Flex>
    </div>
  )
})
