import './Table.css'
import { ArchiveIcon, Cross2Icon, PersonIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import {
  Box,
  Button,
  Callout,
  Flex,
  IconButton,
  Link,
  Progress,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import * as v from 'valibot'
import { describeError } from './api'
import {
  type Browse,
  browse,
  browseIfMissing,
  browses,
  deleteShare,
  dismissFailure,
  type Failure,
  failures,
  loadedShares,
  loadShareList,
  shareList,
} from './browse'
import { Ago, GatedIconButton, stop, toolbarStyle, VirtualTable } from './controls'
import { formatBytes, formatProgress } from './format'
import { DelayedSpinner } from './pages'
import { sortOf, textParam } from './params'
import { useSoulseekGate } from './soulseek'
import { useAtom } from './store'

export const shareColumnIds = ['name', 'folder', 'files', 'size', 'quality', 'length'] as const

export const browseSearch = v.object({
  user: textParam,
  path: textParam,
  q: textParam,
  sort: sortOf(shareColumnIds),
})

export const browseSearchDefaults = { user: '', path: '', q: '' } as const

export type BrowseSearch = v.InferOutput<typeof browseSearch>

// Asking for a user is the gesture that browses them, unless their share is cached.
export function UserBox({ current }: { current?: string }) {
  const navigate = useNavigate()
  const gate = useSoulseekGate()
  const [text, setText] = useState(current ?? '')

  function submit(event: FormEvent) {
    event.preventDefault()
    const username = text.trim()
    if (username === '') return
    if (gate === undefined) void browseIfMissing(username)
    if (username !== current) void navigate({ to: '/browse', search: { user: username } })
  }

  return (
    <form onSubmit={submit}>
      <Flex gap="2" align="center">
        <TextField.Root
          size="2"
          placeholder="Username"
          autoFocus={current === undefined}
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ width: 220 }}
        >
          <TextField.Slot>
            <PersonIcon />
          </TextField.Slot>
        </TextField.Root>
        <Button size="2" type="submit">
          Browse
        </Button>
      </Flex>
    </form>
  )
}

export function BrowseUserButton({ username, directory }: { username: string; directory: string }) {
  const navigate = useNavigate()
  const gate = useSoulseekGate()
  return (
    <Tooltip content={`Browse ${username}`}>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        aria-label={`Browse ${username}`}
        onClick={() => {
          if (gate === undefined) void browseIfMissing(username)
          void navigate({ to: '/browse', search: { user: username, path: directory } })
        }}
      >
        <ArchiveIcon />
      </IconButton>
    </Tooltip>
  )
}

export function BrowseProgress({ username, browse }: { username: string; browse: Browse }) {
  let text: string
  if (browse.phase === 'waiting') text = `Waiting for ${username} to respond…`
  else if (browse.phase === 'receiving') {
    text = `Receiving from ${username}: ${formatProgress(browse.transferred, browse.total)}`
  } else if (browse.phase === 'loading') text = `Loading from slskd: ${formatBytes(browse.loaded)}`
  else text = 'Processing…'
  return (
    <Flex align="center" gap="3" minWidth="0">
      <Spinner size="1" />
      <Text size="2" color="gray" truncate>
        {text}
      </Text>
      {browse.phase === 'receiving' && browse.total > 0 && (
        <Box width="120px" flexShrink="0">
          <Progress size="1" value={Math.min(100, (100 * browse.transferred) / browse.total)} />
        </Box>
      )}
    </Flex>
  )
}

export function FailureLine({ username, failure }: { username: string; failure: Failure }) {
  return (
    <Flex align="center" gap="1" minWidth="0">
      <Text size="2" color="red" truncate title={failure.error}>
        {failure.error}
      </Text>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        aria-label="Dismiss"
        onClick={(event) => {
          stop(event)
          dismissFailure(username)
        }}
      >
        <Cross2Icon />
      </IconButton>
    </Flex>
  )
}

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

function LandingRow({ entry }: { entry: Entry }) {
  const soulseekGate = useSoulseekGate()
  const { username, stats, browse: running, failure, notCached } = entry
  const cached = stats !== undefined && notCached === undefined
  const gate = running === undefined ? soulseekGate : `Already browsing ${username}`
  let status: ReactNode = null
  if (running !== undefined) status = <BrowseProgress username={username} browse={running} />
  else if (failure !== undefined) status = <FailureLine username={username} failure={failure} />
  else if (notCached !== undefined) {
    status = (
      <Text size="2" color="amber" truncate title={notCached}>
        Not cached: {notCached}
      </Text>
    )
  }
  const number = (value: number | undefined) => (
    <div className="table-cell" data-align="end">
      <Text size="2" color="gray">
        {value?.toLocaleString()}
      </Text>
    </div>
  )
  return (
    <div className="table-row" style={{ gridTemplateColumns: template }}>
      <div className="table-cell" title={username}>
        <Link asChild size="2" weight="medium">
          <RouterLink to="/browse" search={{ user: username }}>
            {username}
          </RouterLink>
        </Link>
      </div>
      {number(stats?.folders)}
      {number(stats?.files)}
      <div className="table-cell" data-align="end">
        <Text size="2" color="gray">
          {stats !== undefined && formatBytes(stats.size)}
        </Text>
      </div>
      {number(stats?.locked)}
      <div className="table-cell">
        <Text size="2" color="gray">
          {stats !== undefined && <Ago time={stats.fetchedAt} />}
        </Text>
      </div>
      <Flex className="table-cell" align="center">
        {status}
      </Flex>
      <Flex className="table-cell" gap="3" align="center" justify="end">
        <GatedIconButton label={stats === undefined ? 'Browse again' : 'Re-browse'} gate={gate} onClick={() => void browse(username)}>
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
