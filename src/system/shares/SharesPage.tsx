import { ChevronRightIcon, Cross2Icon } from '@radix-ui/react-icons'
import { Box, Callout, Code, Flex, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'

import { describeError } from '../../lib/api'
import {
  type Application,
  application,
  applicationPollInterval,
  rescanNeeded,
  stateGate,
  useApplication,
} from '../../lib/application'
import { plural } from '../../lib/format'
import type { SearchProps } from '../../lib/params'
import { useResource } from '../../lib/store'
import { useRun } from '../../lib/useRun'
import { ActionButton, Tip, toolbarStyle } from '../../ui/controls'
import { type ListNav, RowScope, useListNav } from '../../ui/listNav'
import { Busy, Empty, FetchedResource, Fetching, Freshness } from '../../ui/status'
import {
  Cell,
  ColumnHeader,
  GridRow,
  HeaderRow,
  Parts,
  rowHeight,
  StackedRow,
  stackedHeight,
  useListLayout,
} from '../../ui/table'
import { audioColumns } from '../../ui/tree/columns'
import type { TreeConfig } from '../../ui/tree/FolderPane'
import { TreeView } from '../../ui/tree/TreeView'
import { columnsVar, growing, sized, useColumns } from '../../ui/widths'
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
  const gate = stateGate(known)
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

const noShares: readonly Share[] = []

const tracks = [growing('path', 300, 2), growing('alias', 160), sized('folders', 100), sized('files', 100)]

const hostTracks = [sized('host', 140), ...tracks]

// A share's key matches its folder's row in the contents, so going up from a share lands on it here.
const shareKey = (share: Share) => (share.excluded ? `excluded\n${share.host}\n${share.id}` : `folder\n${share.alias}`)

function ShareTable({ onOpen }: { onOpen: (path: string) => void }) {
  const { data, error } = useResource(shareList)
  const options = useOptions()
  const stacked = useListLayout() === 'stacked'
  const hosts = (data?.hosts ?? 0) > 1
  const columns = useColumns('shares', hosts ? hostTracks : tracks)
  const { containerRef, ...nav } = useListNav({
    name: 'shares',
    items: data?.shares ?? noShares,
    itemKey: shareKey,
    rank: 1,
    label: 'Shares',
    onEnter: (share) => !share.excluded && onOpen(share.alias),
  })
  if (data === undefined) {
    return (
      <Fetching error={error} onRetry={shareList.refresh}>
        Can't load the shares
      </Fetching>
    )
  }
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
        <Box
          ref={containerRef}
          style={stacked ? undefined : { ...columnsVar(columns), minWidth: columns.minWidth }}
          {...nav.containerProps}
        >
          {!stacked && (
            <HeaderRow columns={columns}>
              {hosts && <ColumnHeader label="Host" />}
              <ColumnHeader label="Local path" />
              <ColumnHeader label="Shared as" />
              <ColumnHeader label="Folders" end />
              <ColumnHeader label="Files" end />
            </HeaderRow>
          )}
          {data.shares.map((share, index) => (
            <ShareRow
              key={`${share.host}\n${share.id}`}
              share={share}
              stacked={stacked}
              hosts={hosts}
              row={nav.rowProps(index)}
              tabbable={index === nav.stop}
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
  stacked,
  hosts,
  row: attributes,
  tabbable,
  onOpen,
}: {
  share: Share
  stacked: boolean
  hosts: boolean
  row: ReturnType<ListNav<Share>['rowProps']>
  tabbable: boolean
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
  const path = (
    <>
      {excluded ? <Cross2Icon style={{ flexShrink: 0 }} /> : <ChevronRightIcon style={{ flexShrink: 0 }} />}
      {name}
    </>
  )
  const rowProps = { ...attributes, style: { height: stacked ? stackedHeight : rowHeight } }
  if (stacked) {
    return (
      <div {...rowProps}>
        <RowScope tabbable={tabbable}>
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
        </RowScope>
      </div>
    )
  }
  return (
    <div {...rowProps}>
      <RowScope tabbable={tabbable}>
        <GridRow {...row}>
          {hosts && <Cell>{share.host}</Cell>}
          <Flex className="table-cell" align="center" gap="2" title={share.localPath}>
            {path}
          </Flex>
          <Cell>{excluded ? 'Excluded' : share.alias}</Cell>
          <Cell end>{!excluded && <Count value={share.folders} />}</Cell>
          <Cell end>{!excluded && <Count value={share.files} />}</Cell>
        </GridRow>
      </RowScope>
    </div>
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
  page: '/system/shares',
  scope: 'the shares',
  extras: audioColumns,
  status: <ScanningNote />,
  topList: 'shares',
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
