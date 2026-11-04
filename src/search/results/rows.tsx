import { CardStackPlusIcon, DownloadIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Badge, Flex, IconButton, Spinner, Text } from '@radix-ui/themes'
import { memo } from 'react'

import type { Browse } from '../../browse/browse'
import { describeBrowse } from '../../browse/browseStatus'
import { BrowseUserButton } from '../../browse/BrowseUserButton'
import { nameOf } from '../../lib/files'
import { formatBytes, formatDuration, formatSpeed, formatTime, plural, useAgo } from '../../lib/format'
import type { Mark } from '../../transfers/enqueue'
import { MarkBadge } from '../../transfers/MarkBadge'
import { type Detail, DetailList, DetailsButton, fileDetails, GatedIconButton, Tip } from '../../ui/controls'
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
  rowId: string
  file: ResultFile
  layout: Layout
  shown: ReadonlySet<string>
  selected: boolean
  pending: boolean
  mark?: Mark
  gate?: string
  onSelect: (id: string, shiftKey: boolean) => void
}

export const FileRow = memo(function FileRow({
  searchId,
  rowId,
  file,
  layout,
  shown,
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
      onToggle={(shiftKey) => onSelect(rowId, shiftKey)}
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
  const onClick = (event: { shiftKey: boolean }) => !file.locked && onSelect(rowId, event.shiftKey)
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
    <GridRow selected={selected} dimmed={file.locked} onClick={onClick}>
      {check}
      <Flex className="table-cell" align="center" gap="2" style={{ paddingLeft: 36 }} title={file.filename}>
        {name}
      </Flex>
      {shown.has('user') && <div className="table-cell" />}
      {shown.has('files') && <div className="table-cell" />}
      {shown.has('size') && <Cell end>{formatBytes(file.size)}</Cell>}
      {shown.has('quality') && <Cell>{file.qualityLabel}</Cell>}
      {shown.has('length') && <Cell end>{length}</Cell>}
      {shown.has('speed') && <div className="table-cell" />}
      {shown.has('queue') && <div className="table-cell" />}
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
  shown: ReadonlySet<string>
  expanded: boolean
  selected: boolean
  partial: boolean
  fetch?: FolderFetch
  cached: boolean
  browsing?: Browse
  gate?: string
  folderGate?: string
  onSelect: (id: string, shiftKey: boolean) => void
  onToggle: (id: string) => void
  onHide: (username: string) => void
}

export const GroupRow = memo(function GroupRow({
  searchId,
  group,
  layout,
  shown,
  expanded,
  selected,
  partial,
  fetch,
  cached,
  browsing,
  gate,
  folderGate,
  onSelect,
  onToggle,
  onHide,
}: GroupRowProps) {
  const { peer } = group
  const parent = group.directory.slice(0, group.directory.length - group.name.length)
  const open = group.files.filter((file) => !file.locked)
  const extra = group.files.length - group.matched
  const hidden = group.total - group.files.length
  const fetched = fetch?.files !== undefined
  const age = useAgo(fetch?.fetchedAt ?? 0)
  const error = fetch?.missing
    ? `“${nameOf(group.directory)}” isn't in ${group.username}'s share as of ${age}`
    : fetch?.error
  const browses = !cached || fetched || error !== undefined
  let fetchLabel =
    error === undefined
      ? fetched
        ? 'Get the full folder again'
        : 'Get the full folder'
      : `Couldn't get the full folder: ${error}. Try again`
  if (browses) fetchLabel += ` (browses ${group.username}'s whole share)`
  const progress = browsing === undefined ? 'Reading the cached share…' : describeBrowse(browsing)
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
  if (fetch?.pending) details.push(['Getting the full folder', progress])
  if (fetch?.fetchedAt !== undefined) details.push(['Share fetched', formatTime(fetch.fetchedAt)])
  if (error !== undefined && fetch?.failedAt !== undefined) {
    details.push(['Folder fetch failed', formatTime(fetch.failedAt)])
  }
  if (error !== undefined) details.push(['Error', error])
  const ofTotal = `${group.files.length.toLocaleString()} of ${group.total.toLocaleString()}`
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
        <Tip content={progress}>
          <Spinner size="1" />
        </Tip>
      ) : (
        <GatedIconButton
          label={fetchLabel}
          color={error === undefined ? undefined : 'red'}
          gate={browses ? folderGate : undefined}
          onClick={() => void fetchFolder(searchId, group, browses)}
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
        title={<GroupName expanded={expanded} name={group.name} parent={parent} />}
        meta={
          <Parts
            items={[
              hidden > 0 ? `${ofTotal} files` : `${plural(group.matched, 'file')}${plus}`,
              formatBytes(group.size),
              group.qualityLabel,
              length,
            ]}
          />
        }
        more={
          <Parts
            items={[
              <UserMenu key="user" username={group.username} onHide={() => onHide(group.username)} />,
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
    <GridRow group selected={selected} dimmed={open.length === 0} onClick={() => onToggle(group.id)}>
      {check}
      <GroupNameCell expanded={expanded} name={group.name} parent={parent} title={group.directory} />
      {shown.has('user') && <UserCell username={group.username} onHide={() => onHide(group.username)} />}
      {shown.has('files') && (
        <Cell end title={hidden > 0 ? `${plural(hidden, 'file')} filtered out` : undefined}>
          {hidden > 0 ? ofTotal : `${group.matched.toLocaleString()}${plus}`}
        </Cell>
      )}
      {shown.has('size') && <Cell end>{formatBytes(group.size)}</Cell>}
      {shown.has('quality') && <Cell title={group.qualityLabel}>{group.qualityLabel}</Cell>}
      {shown.has('length') && <Cell end>{length}</Cell>}
      {shown.has('speed') && <Cell end>{formatSpeed(peer.speed)}</Cell>}
      {shown.has('queue') && (
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
      )}
      <ActionsCell>{actions}</ActionsCell>
    </GridRow>
  )
})
