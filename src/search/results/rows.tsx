import { CardStackPlusIcon, DownloadIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Badge, Flex, IconButton, Spinner, Text } from '@radix-ui/themes'
import { memo } from 'react'
import { BrowseUserButton } from '../../browse/BrowseUserButton'
import { formatBytes, formatDuration, formatSpeed, formatTime, plural } from '../../lib/format'
import type { Mark } from '../../transfers/enqueue'
import { MarkBadge } from '../../transfers/MarkBadge'
import { type Detail, DetailList, DetailsButton, GatedIconButton } from '../../ui/controls'
import { ActionsCell, Cell, CheckCell, GridRow, GroupNameCell } from '../../ui/table'
import { download, type FolderFetch, fetchFolder, type ResultFile, type ResultGroup } from './results'
import { template } from './table'

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
  const details: Detail[] = [
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
    <GridRow
      template={template}
      selected={selected}
      dimmed={file.locked}
      onClick={(event) => !file.locked && onSelect(file.id, event.shiftKey)}
    >
      <CheckCell selected={selected} disabled={file.locked} onToggle={(shiftKey) => onSelect(file.id, shiftKey)} />
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
      <Cell end>{formatBytes(file.size)}</Cell>
      <Cell>{file.qualityLabel}</Cell>
      <Cell end>{file.length !== undefined && formatDuration(file.length)}</Cell>
      <div className="table-cell" />
      <div className="table-cell" />
      <ActionsCell>
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
        <DetailsButton>
          <DetailList rows={details} />
        </DetailsButton>
      </ActionsCell>
    </GridRow>
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
  const details: Detail[] = [
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
    <GridRow
      template={template}
      group
      selected={selected}
      dimmed={open.length === 0}
      onClick={() => onToggle(group.id)}
    >
      <CheckCell
        selected={selected}
        partial={partial}
        disabled={open.length === 0}
        onToggle={(shiftKey) => onSelect(group.id, shiftKey)}
      />
      <GroupNameCell expanded={expanded} name={group.name} title={group.directory} />
      <div className="table-cell" title={group.username}>
        <Text size="2">{group.username}</Text>
      </div>
      <Cell end title={hidden > 0 ? `${plural(hidden, 'file')} filtered out` : undefined}>
        {hidden > 0
          ? `${group.files.length.toLocaleString()} of ${group.total.toLocaleString()}`
          : `${group.matched.toLocaleString()}${fetched ? ` + ${extra.toLocaleString()}` : ''}`}
      </Cell>
      <Cell end>{formatBytes(group.size)}</Cell>
      <Cell title={group.qualityLabel}>{group.qualityLabel}</Cell>
      <Cell end>{group.length > 0 && formatDuration(group.length)}</Cell>
      <Cell end>{formatSpeed(peer.speed)}</Cell>
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
      <ActionsCell>
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
        <DetailsButton>
          <DetailList rows={details} />
        </DetailsButton>
      </ActionsCell>
    </GridRow>
  )
})
