import { ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import { Flex, Text } from '@radix-ui/themes'
import { type ReactNode, useEffect, useMemo } from 'react'

import { entriesByUser } from '../lib/db'
import { formatBytes } from '../lib/format'
import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { GatedIconButton } from '../ui/controls'
import { Ago } from '../ui/status'
import { ActionsCell, Cell, GridRow } from '../ui/table'
import { UserLinkCell, UserListPage } from '../ui/UserList'
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

const columns = [
  { label: 'User' },
  { label: 'Folders', end: true },
  { label: 'Files', end: true },
  { label: 'Size', end: true },
  { label: 'Locked', end: true },
  { label: 'Fetched' },
  { label: 'Status' },
]

export function BrowsePage() {
  useEffect(() => {
    void loadShareList()
  }, [])
  const list = useAtom(shareList)
  const running = useAtom(browses)
  const failed = useAtom(failures)
  const memory = useAtom(loadedShares)

  const entries = useMemo(() => {
    const time = (entry: Entry) => entry.stats?.fetchedAt ?? entry.failure?.at ?? 0
    return entriesByUser<Entry>((entryOf) => {
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
    }).sort(
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

  return (
    <UserListPage
      toolbar={
        <>
          <UserBox />
          <Text size="2" color="gray" ml="auto">
            {formatBytes(stored)} stored
          </Text>
        </>
      }
      list={list}
      what="the cache"
      empty="Nothing browsed yet. Browse a user by name, or from a search result or a transfer."
      template={template}
      minWidth={minWidth}
      columns={columns}
      entries={entries}
      renderRow={(entry) => <LandingRow entry={entry} />}
    />
  )
}

function LandingRow({ entry }: { entry: Entry }) {
  const soulseekGate = useSoulseekGate()
  const { username, stats, browse: running, failure, notCached } = entry
  const cached = stats !== undefined && notCached === undefined
  const gate = running === undefined ? soulseekGate : `Already browsing ${username}`
  let status: ReactNode = null
  if (running !== undefined) status = <BrowseProgress running={running} />
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
      <UserLinkCell username={username} to="/browse" />
      <Cell end>{stats?.folders.toLocaleString()}</Cell>
      <Cell end>{stats?.files.toLocaleString()}</Cell>
      <Cell end>{stats !== undefined && formatBytes(stats.size)}</Cell>
      <Cell end>{stats?.locked.toLocaleString()}</Cell>
      <Cell>{stats !== undefined && <Ago time={stats.fetchedAt} />}</Cell>
      <Flex className="table-cell" align="center">
        {status}
      </Flex>
      <ActionsCell>
        {cached && (
          <GatedIconButton label="Delete" onClick={() => void deleteShare(username)}>
            <TrashIcon />
          </GatedIconButton>
        )}
        <GatedIconButton
          label={stats === undefined ? 'Browse again' : 'Re-browse'}
          gate={gate}
          onClick={() => void browse(username)}
        >
          <ReloadIcon />
        </GatedIconButton>
      </ActionsCell>
    </GridRow>
  )
}
