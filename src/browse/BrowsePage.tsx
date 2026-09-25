import { ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import { Box, Callout, Flex, Link, Text } from '@radix-ui/themes'
import { Link as RouterLink } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useMemo } from 'react'
import { describeError } from '../lib/api'
import { formatBytes } from '../lib/format'
import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { Ago, DelayedSpinner, GatedIconButton, toolbarStyle } from '../ui/controls'
import { VirtualTable } from '../ui/table'
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
  const getItemKey = useCallback((index: number) => entries[index]?.username ?? index, [entries])

  let content: ReactNode
  if (!list.loaded) {
    content = (
      <Flex justify="center" p="6">
        <DelayedSpinner />
      </Flex>
    )
  } else if (entries.length === 0) {
    content = (
      <Box p="5">
        {list.error !== undefined ? (
          <Callout.Root color="red">
            <Callout.Text>Can't read the cache: {describeError(list.error)}</Callout.Text>
          </Callout.Root>
        ) : (
          <Text color="gray">Nothing browsed yet. Browse a user by name, or from a search result or a transfer.</Text>
        )}
      </Box>
    )
  } else {
    const header = (
      <div className="table-row table-columns" style={{ gridTemplateColumns: template, height: '100%' }}>
        {['User', 'Folders', 'Files', 'Size', 'Locked', 'Fetched', 'Status'].map((label) => (
          <div
            key={label}
            className="table-cell table-label"
            data-align={label === 'User' || label === 'Fetched' || label === 'Status' ? undefined : 'end'}
          >
            {label}
          </div>
        ))}
        <div />
      </div>
    )
    content = (
      <VirtualTable
        minWidth={minWidth}
        header={header}
        count={entries.length}
        getItemKey={getItemKey}
        renderRow={(index) => {
          const entry = entries[index]
          return entry && <LandingRow entry={entry} />
        }}
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

function NumberCell({ value }: { value?: number }) {
  return (
    <div className="table-cell" data-align="end">
      <Text size="2" color="gray">
        {value?.toLocaleString()}
      </Text>
    </div>
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
    <div className="table-row" style={{ gridTemplateColumns: template }}>
      <div className="table-cell" title={username}>
        <Link asChild size="2" weight="medium">
          <RouterLink to="/browse" search={{ user: username }}>
            {username}
          </RouterLink>
        </Link>
      </div>
      <NumberCell value={stats?.folders} />
      <NumberCell value={stats?.files} />
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {stats !== undefined && formatBytes(stats.size)}
        </Text>
      </div>
      <NumberCell value={stats?.locked} />
      <div className="table-cell">
        <Text size="2" color="gray">
          {stats !== undefined && <Ago time={stats.fetchedAt} />}
        </Text>
      </div>
      <Flex className="table-cell" align="center">
        {status}
      </Flex>
      <Flex className="table-cell" gap="3" align="center" justify="end">
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
      </Flex>
    </div>
  )
}
