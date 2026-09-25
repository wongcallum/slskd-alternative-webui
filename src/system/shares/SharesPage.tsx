import { ChevronRightIcon, Cross2Icon } from '@radix-ui/react-icons'
import { Box, Callout, Code, Flex, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { describeError } from '../../lib/api'
import { plural } from '../../lib/format'
import type { SearchProps } from '../../lib/params'
import { useResource } from '../../lib/store'
import { useRun } from '../../lib/useRun'
import { ActionButton, Tip, toolbarStyle } from '../../ui/controls'
import { Busy, Empty, FetchedResource, Fetching, Freshness } from '../../ui/status'
import {
  Cell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  Parts,
  RowButton,
  rowHeight,
  StackedRow,
  stackedHeight,
  useListLayout,
} from '../../ui/table'
import { audioColumns } from '../../ui/tree/columns'
import type { FolderLinkProps, TreeConfig } from '../../ui/tree/FolderPane'
import { TreeView } from '../../ui/tree/TreeView'
import { type Application, application, applicationPollInterval, rescanNeeded, useApplication } from '../application'
import { useOptions } from '../options/options'
import { PendingCallout } from '../PendingCallouts'
import { SystemPage } from '../SystemPage'
import type { SharesSearch } from './params'
import { cancelScan, contents, contentsLoading, notScanned, rescan, type Share, shareList } from './shares'

type Props = SearchProps<SharesSearch>

// The list is the top of the contents, so an empty path shows the list rather than the tree.
export function SharesPage({ search, onSearchChange }: Props) {
  const { data, live, known } = useApplication()
  const listing = search.path === ''
  return (
    <SystemPage
      status={
        listing ? (
          <Freshness resource={application} interval={applicationPollInterval} live={live} />
        ) : (
          <FetchedResource resource={contents} loading={contentsLoading} />
        )
      }
    >
      {data !== undefined && <ScanBar data={data} known={known} />}
      {listing ? (
        <ShareTable onOpen={(path) => onSearchChange({ path })} />
      ) : (
        <ContentsView search={search} onSearchChange={onSearchChange} />
      )}
    </SystemPage>
  )
}

function Bar({ error, children }: { error?: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1" px="4" py="2" flexShrink="0" style={toolbarStyle}>
      <Flex align="center" justify="between" gap="3" minHeight="32px">
        {children}
      </Flex>
      {error !== undefined && (
        <Text size="2" color="red">
          {error}
        </Text>
      )}
    </Flex>
  )
}

function pendingReason(data: Application) {
  if (data.scanFaulted) return 'The last scan failed, so the shares are out of date until a rescan.'
  if (data.scanCancelled) return 'The last scan was cancelled, so search results are out of date until a rescan.'
  return 'The shares changed since the last scan, so they need a rescan.'
}

function ScanBar({ data, known }: { data: Application; known: boolean }) {
  const run = useRun()
  const gate = known ? undefined : "slskd's state is out of date"
  if (data.scanning) {
    return (
      <Bar error={run.error}>
        <Busy>
          {data.scanFolders > 0 ? `Scanning ${plural(data.scanFolders, 'folder')}` : 'Scanning'}:{' '}
          {Math.floor(data.scanProgress * 100)}%, {plural(data.scanFiles, 'file')} so far
        </Busy>
        <ActionButton label="Cancel" loading={run.running} gate={gate} onClick={() => run.run(cancelScan)} />
      </Bar>
    )
  }
  const rescanButton = (color?: 'amber') => (
    <ActionButton label="Rescan" color={color} loading={run.running} gate={gate} onClick={() => run.run(rescan)} />
  )
  if (rescanNeeded(data)) {
    return (
      <Box px="4" py="3" flexShrink="0" style={toolbarStyle}>
        <PendingCallout error={run.error}>
          <Callout.Text>{pendingReason(data)}</Callout.Text>
          {rescanButton('amber')}
        </PendingCallout>
      </Box>
    )
  }
  return (
    <Bar error={run.error}>
      <Text size="2" color="gray">
        {data.scanReady
          ? `${plural(data.scanFiles, 'file')} in ${plural(data.scanFolders, 'folder')} shared`
          : 'Not scanned yet'}
      </Text>
      {rescanButton()}
    </Bar>
  )
}

function ShareTable({ onOpen }: { onOpen: (path: string) => void }) {
  const { data, error } = useResource(shareList)
  const options = useOptions()
  const stacked = useListLayout() === 'stacked'
  if (data === undefined) {
    return (
      <Fetching error={error} onRetry={shareList.refresh}>
        Can't load the shares
      </Fetching>
    )
  }
  const hosts = data.hosts > 1
  const template = `${hosts ? '140px ' : ''}minmax(300px, 2fr) minmax(160px, 1fr) 100px 100px`
  return (
    <Box flexGrow="1" minHeight="0" overflow="auto">
      {error !== undefined && (
        <Box px="4" pt="3">
          <Text size="2" color="red">
            Couldn't update the shares: {describeError(error)}
          </Text>
        </Box>
      )}
      {data.shares.length === 0 ? (
        <Empty>
          Nothing is shared. Shares are set in slskd's config, as <Code>shares.directories</Code>.
        </Empty>
      ) : (
        <Box minWidth={stacked ? undefined : `${(hosts ? 140 : 0) + 660}px`}>
          {!stacked && (
            <HeaderRow template={template}>
              {hosts && <ColumnHeader label="Host" />}
              <ColumnHeader label="Local path" />
              <ColumnHeader label="Shared as" />
              <ColumnHeader label="Folders" end />
              <ColumnHeader label="Files" end />
            </HeaderRow>
          )}
          {data.shares.map((share) => (
            <ShareRow
              key={`${share.host}\n${share.id}`}
              share={share}
              template={template}
              stacked={stacked}
              hosts={hosts}
              onOpen={onOpen}
            />
          ))}
        </Box>
      )}
      {options !== undefined && options.shareFilters.length > 0 && (
        <Flex direction="column" gap="2" p="4">
          <Text size="2" color="gray">
            Files and folders whose local path matches one of these filters aren't shared:
          </Text>
          <Flex gap="2" wrap="wrap">
            {options.shareFilters.map((filter) => (
              <Code key={filter}>{filter}</Code>
            ))}
          </Flex>
        </Flex>
      )}
    </Box>
  )
}

function Count({ value }: { value?: number }) {
  if (value !== undefined) return value.toLocaleString()
  return (
    <Tip content="Counted at the next scan">
      <span>–</span>
    </Tip>
  )
}

function ShareRow({
  share,
  template,
  stacked,
  hosts,
  onOpen,
}: {
  share: Share
  template: string
  stacked: boolean
  hosts: boolean
  onOpen: (path: string) => void
}) {
  const { excluded } = share
  const row = {
    dimmed: excluded,
    style: excluded ? undefined : { cursor: 'pointer' },
    onClick: excluded ? undefined : () => onOpen(share.alias),
  }
  const name = (
    <Text size="2" weight="medium" truncate>
      {share.localPath}
    </Text>
  )
  const path = excluded ? (
    <>
      <Cross2Icon style={{ flexShrink: 0 }} />
      {name}
    </>
  ) : (
    <RowButton>
      <ChevronRightIcon style={{ flexShrink: 0 }} />
      {name}
    </RowButton>
  )
  if (stacked) {
    return (
      <div style={{ height: stackedHeight }}>
        <StackedRow
          {...row}
          title={path}
          meta={
            <Parts
              items={
                excluded
                  ? [hosts && share.host, 'Excluded']
                  : [
                      hosts && share.host,
                      `Shared as ${share.alias}`,
                      <span key="folders">
                        <Count value={share.folders} /> folders
                      </span>,
                      <span key="files">
                        <Count value={share.files} /> files
                      </span>,
                    ]
              }
            />
          }
        />
      </div>
    )
  }
  return (
    <div style={{ height: rowHeight }}>
      <GridRow template={template} {...row}>
        {hosts && <Cell>{share.host}</Cell>}
        <Flex className="table-cell" align="center" gap="2" title={share.localPath}>
          {path}
        </Flex>
        <Cell>{excluded ? 'Excluded' : share.alias}</Cell>
        <Cell end>{!excluded && <Count value={share.folders} />}</Cell>
        <Cell end>{!excluded && <Count value={share.files} />}</Cell>
      </GridRow>
    </div>
  )
}

function SharesFolderLink({ path, ...props }: FolderLinkProps) {
  return (
    <RouterLink {...props} from="/system/shares" to="/system/shares" search={(previous) => ({ ...previous, path })} />
  )
}

function ScanningNote() {
  const scanning = useResource(application).data?.scanning === true
  return (
    scanning && (
      <Text size="2" color="amber">
        Contents change as the scan runs
      </Text>
    )
  )
}

const contentsConfig: TreeConfig = {
  scope: 'the shares',
  extras: audioColumns,
  FolderLink: SharesFolderLink,
  status: <ScanningNote />,
}

function ContentsView({ search, onSearchChange }: Props) {
  const { data, error } = useResource(contents)
  if (data !== undefined) {
    return (
      <TreeView
        tree={data.tree}
        fetchedAt={data.fetchedAt}
        search={search}
        onSearchChange={onSearchChange}
        config={contentsConfig}
      />
    )
  }
  if (notScanned(error)) return <Empty>Nothing has been scanned yet.</Empty>
  return (
    <Fetching error={error} onRetry={contents.refresh}>
      Can't load what's shared
    </Fetching>
  )
}
