import { ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import { Flex, Link, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo } from 'react'

import { describeError } from '../lib/api'
import { formatBytes } from '../lib/format'
import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { GatedIconButton, toolbarStyle } from '../ui/controls'
import { Ago, Empty, ErrorCallout, Loading } from '../ui/status'
import { ActionsCell, Cell, ColumnHeader, GridRow, HeaderRow, VirtualTable } from '../ui/table'
import {
  type Browse,
  browse,
  browses,
  deleteShare,
  type Failure,
  failures,
  loadedShares,
  loadShareList,
  shareList,
} from './browse'
import { BrowseProgress, FailureLine } from './BrowseStatus'
import { UserBox } from './UserBox'

type Stats = { folders: number; files: number; locked: number; size: number; fetchedAt: number }

type Entry = { username: string; stats?: Stats; notCached?: string; browse?: Browse; failure?: Failure }

const template = 'minmax(200px, 1fr) 90px 100px 100px 90px 110px minmax(240px, 1.2fr) 76px'

const minWidth = 1006

const entryKey = (entry: Entry) => entry.username

export function BrowsePage() {
  useEffect(() => {
    void loadShareList()
  }, [])
  const list = useAtom(shareList)
  const running = useAtom(browses)
  const failed = useAtom(failures)
  const memory = useAtom(loadedShares)

  const entries = useMemo(() => {
    const byUser = new Map<string, Entry>()
    const entryOf = (username: string) => {
      let entry = byUser.get(username)
      if (entry === undefined) byUser.set(username, (entry = { username }))
      return entry
    }
    for (const record of list.records.values()) entryOf(record.username).stats = record
    for (const [username, loaded] of memory) {
      if (loaded.status !== 'ready' || loaded.notCached === undefined) continue
      const { share } = loaded
      const entry = entryOf(username)
      entry.notCached = loaded.notCached
      entry.stats = {
        folders: share.folderCount,
        files: share.top.fileCount,
        locked: share.top.lockedCount,
        size: share.top.size,
        fetchedAt: loaded.fetchedAt,
      }
    }
    for (const [username, each] of running) entryOf(username).browse = each
    for (const [username, failure] of failed) entryOf(username).failure = failure
    const time = (entry: Entry) => entry.stats?.fetchedAt ?? entry.failure?.at ?? 0
    return [...byUser.values()].sort(
      (a, b) =>
        Number(b.browse !== undefined) - Number(a.browse !== undefined) ||
        (b.browse?.startedAt ?? 0) - (a.browse?.startedAt ?? 0) ||
        time(b) - time(a),
    )
  }, [list.records, memory, running, failed])
  const stored = useMemo(
    () => [...list.records.values()].reduce((sum, record) => sum + record.bytes, 0),
    [list.records],
  )

  let content: ReactNode
  if (!list.loaded) content = <Loading />
  else if (entries.length === 0) {
    content =
      list.error !== undefined ? (
        <ErrorCallout>Can't read the cache: {describeError(list.error)}</ErrorCallout>
      ) : (
        <Empty>Nothing browsed yet. Browse a user by name, or from a search result or a transfer.</Empty>
      )
  } else {
    const header = (
      <HeaderRow template={template}>
        <ColumnHeader label="User" />
        <ColumnHeader label="Folders" end />
        <ColumnHeader label="Files" end />
        <ColumnHeader label="Size" end />
        <ColumnHeader label="Locked" end />
        <ColumnHeader label="Fetched" />
        <ColumnHeader label="Status" />
        <div />
      </HeaderRow>
    )
    content = (
      <VirtualTable
        minWidth={minWidth}
        header={header}
        items={entries}
        itemKey={entryKey}
        renderItem={(entry) => <LandingRow entry={entry} />}
      />
    )
  }

  return (
    <Flex direction="column" height="100%">
      <Flex align="center" gap="4" px="4" py="3" flexShrink="0" style={toolbarStyle}>
        <UserBox />
        <Text size="2" color="gray" ml="auto">
          {formatBytes(stored)} stored
        </Text>
      </Flex>
      {content}
    </Flex>
  )
}

function LandingRow({ entry }: { entry: Entry }) {
  const soulseekGate = useSoulseekGate()
  const { username, stats, browse: running, failure, notCached } = entry
  const cached = stats !== undefined && notCached === undefined
  const gate = running === undefined ? soulseekGate : `Already browsing ${username}`
  let status: ReactNode = null
  if (running !== undefined) status = <BrowseProgress username={username} running={running} />
  else if (failure !== undefined) status = <FailureLine username={username} failure={failure} />
  else if (notCached !== undefined) {
    status = (
      <Text size="2" color="amber" truncate title={notCached}>
        Not cached: {notCached}
      </Text>
    )
  }
  return (
    <GridRow template={template}>
      <div className="table-cell" title={username}>
        <Link asChild size="2" weight="medium">
          <RouterLink to="/browse" search={{ user: username }}>
            {username}
          </RouterLink>
        </Link>
      </div>
      <Cell end>{stats?.folders.toLocaleString()}</Cell>
      <Cell end>{stats?.files.toLocaleString()}</Cell>
      <Cell end>{stats !== undefined && formatBytes(stats.size)}</Cell>
      <Cell end>{stats?.locked.toLocaleString()}</Cell>
      <Cell>{stats !== undefined && <Ago time={stats.fetchedAt} />}</Cell>
      <Flex className="table-cell" align="center">
        {status}
      </Flex>
      <ActionsCell>
        <GatedIconButton
          label={stats === undefined ? 'Browse again' : 'Re-browse'}
          gate={gate}
          onClick={() => void browse(username)}
        >
          <ReloadIcon />
        </GatedIconButton>
        {cached && (
          <GatedIconButton label="Delete" onClick={() => void deleteShare(username)}>
            <TrashIcon />
          </GatedIconButton>
        )}
      </ActionsCell>
    </GridRow>
  )
}
