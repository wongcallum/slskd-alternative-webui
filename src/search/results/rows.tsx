import { CardStackPlusIcon, DownloadIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Badge, Flex, IconButton, Spinner, Text } from '@radix-ui/themes'
import { memo } from 'react'

import { BrowseUserButton } from '../../browse/BrowseUserButton'
import { formatBytes, formatDuration, formatSpeed, formatTime, plural } from '../../lib/format'
import type { Mark } from '../../transfers/enqueue'
import { MarkBadge } from '../../transfers/MarkBadge'
import { type Detail, DetailList, DetailsButton, fileDetails, GatedIconButton } from '../../ui/controls'
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
} from '../../ui/table'
import { UserCell, UserMenu } from '../../users/UserMenu'
import { download, type FolderFetch, fetchFolder, type ResultFile, type ResultGroup } from './results'
import { templates } from './table'

// Keeps a file's actions in line with its folder's, which has two more.
function Placeholder() {
  return (
    <IconButton size="1" variant="ghost" aria-hidden tabIndex={-1} style={{ visibility: 'hidden' }}>
      <CardStackPlusIcon />
    </IconButton>
  )
}

type FileRowProps = {
  searchId: string
  file: ResultFile
  layout: Layout
  selected: boolean
  pending: boolean
  mark?: Mark
  gate?: string
  onSelect: (id: string, shiftKey: boolean) => void
}

export const FileRow = memo(function FileRow({
  searchId,
  file,
  layout,
  selected,
  pending,
  mark,
  gate,
  onSelect,
}: FileRowProps) {
  const details = fileDetails(file)
  if (file.bitRate !== undefined) details.push(['Bitrate', `${file.bitRate} kbps`])
  if (file.isVariableBitRate !== undefined) details.push(['Variable bitrate', file.isVariableBitRate ? 'Yes' : 'No'])
  if (file.bitDepth !== undefined) details.push(['Bit depth', file.bitDepth])
  if (file.sampleRate !== undefined) details.push(['Sample rate', `${file.sampleRate.toLocaleString()} Hz`])
  if (file.length !== undefined) details.push(['Length', formatDuration(file.length)])
  details.push(
    ['Matched', file.matched ? 'Yes' : 'No, fetched with the full folder'],
    ['Locked', file.locked ? 'Yes, only shared with some users' : 'No'],
  )
  const length = file.length !== undefined && formatDuration(file.length)
  const check = (
    <CheckCell
      label={`Select ${file.name}`}
      selected={selected}
      disabled={file.locked}
      onToggle={(shiftKey) => onSelect(file.id, shiftKey)}
    />
  )
  const name = (
    <>
      {file.locked && <LockClosedIcon style={{ flexShrink: 0 }} />}
      <Text size="2" truncate>
        {file.name}
      </Text>
      {!file.matched && <Badge color="gray">Not matched</Badge>}
      <MarkBadge mark={mark} pending={pending} />
    </>
  )
  const downloadButton = !file.locked && (
    <GatedIconButton label="Download" gate={gate} onClick={() => void download(searchId, [file])}>
      <DownloadIcon />
    </GatedIconButton>
  )
  const detailsButton = (
    <DetailsButton>
      <DetailList rows={details} />
    </DetailsButton>
  )
  const onClick = (event: { shiftKey: boolean }) => !file.locked && onSelect(file.id, event.shiftKey)
  if (layout === 'stacked') {
    return (
      <StackedRow
        indent
        selected={selected}
        dimmed={file.locked}
        check={check}
        title={name}
        meta={<Parts items={[formatBytes(file.size), file.qualityLabel, length]} />}
        actions={
          <>
            {downloadButton}
            {detailsButton}
          </>
        }
        onClick={onClick}
      />
    )
  }
  return (
    <GridRow template={templates[layout]} selected={selected} dimmed={file.locked} onClick={onClick}>
      {check}
      <Flex className="table-cell" align="center" gap="2" style={{ paddingLeft: 36 }} title={file.filename}>
        {name}
      </Flex>
      <div className="table-cell" />
      <div className="table-cell" />
      <Cell end>{formatBytes(file.size)}</Cell>
      <Cell>{file.qualityLabel}</Cell>
      {layout === 'wide' && <Cell end>{length}</Cell>}
      <div className="table-cell" />
      <div className="table-cell" />
      <ActionsCell>
        {downloadButton}
        <Placeholder />
        <Placeholder />
        {detailsButton}
      </ActionsCell>
    </GridRow>
  )
})

type GroupRowProps = {
  searchId: string
  group: ResultGroup
  layout: Layout
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
  layout,
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
  const shown = `${group.files.length.toLocaleString()} of ${group.total.toLocaleString()}`
  const plus = fetched && extra > 0 ? ` + ${extra.toLocaleString()}` : ''
  const length = group.length > 0 && formatDuration(group.length)
  const check = (
    <CheckCell
      label={`Select ${group.name}`}
      selected={selected}
      partial={partial}
      disabled={open.length === 0}
      onToggle={(shiftKey) => onSelect(group.id, shiftKey)}
    />
  )
  const actions = (
    <>
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
    </>
  )
  if (layout === 'stacked') {
    return (
      <StackedRow
        group
        selected={selected}
        dimmed={open.length === 0}
        check={check}
        title={<GroupName expanded={expanded} name={group.name} />}
        meta={
          <Parts
            items={[
              hidden > 0 ? `${shown} files` : `${plural(group.matched, 'file')}${plus}`,
              formatBytes(group.size),
              group.qualityLabel,
              length,
            ]}
          />
        }
        more={
          <Parts
            items={[
              <UserMenu key="user" username={group.username} />,
              formatSpeed(peer.speed),
              peer.free ? (
                <Text key="queue" color="green">
                  Free
                </Text>
              ) : (
                `${peer.queueLength.toLocaleString()} queued`
              ),
            ]}
          />
        }
        actions={actions}
        onClick={() => onToggle(group.id)}
      />
    )
  }
  return (
    <GridRow
      template={templates[layout]}
      group
      selected={selected}
      dimmed={open.length === 0}
      onClick={() => onToggle(group.id)}
    >
      {check}
      <GroupNameCell expanded={expanded} name={group.name} title={group.directory} />
      <UserCell username={group.username} />
      <Cell end title={hidden > 0 ? `${plural(hidden, 'file')} filtered out` : undefined}>
        {hidden > 0 ? shown : `${group.matched.toLocaleString()}${plus}`}
      </Cell>
      <Cell end>{formatBytes(group.size)}</Cell>
      <Cell title={group.qualityLabel}>{group.qualityLabel}</Cell>
      {layout === 'wide' && <Cell end>{length}</Cell>}
      <Cell end>{formatSpeed(peer.speed)}</Cell>
      <div className="table-cell" data-align="end">
        {peer.free ? (
          <Text size="2" color="green">
            Free
          </Text>
        ) : (
          <Text size="2" color="gray">
            {peer.queueLength.toLocaleString()}
          </Text>
        )}
      </div>
      <ActionsCell>{actions}</ActionsCell>
    </GridRow>
  )
})
