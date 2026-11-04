import { Flex, Text } from '@radix-ui/themes'
import { type ReactNode, useMemo } from 'react'

import { entriesByUser, type UserEntry } from '../lib/db'
import type { UserRecord } from '../lib/db'
import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { Ago, Busy } from '../ui/status'
import { Cell, type Layout } from '../ui/table'
import { UserListPage, UserListRow } from '../ui/userList'
import { LookUpBox } from './LookUpBox'
import { LookupErrorLine, PresenceLabel } from './lookupStatus'
import { deleteUser, lookedUpAt, lookUp, type LookupErrors, lookupErrors, lookups, useUserList } from './users'

type Fields = { record: UserRecord; startedAt: number; errors: LookupErrors }

type Entry = UserEntry<Fields>

const templates = {
  wide: 'minmax(200px, 1fr) 100px 90px 80px 100px minmax(240px, 1.2fr) 76px',
  medium: 'minmax(160px, 1fr) 100px 80px 100px minmax(160px, 1.2fr) 76px',
}

const columns = [
  { label: 'User' },
  { label: 'Presence' },
  { label: 'Free slot', wide: true },
  { label: 'Queue', end: true },
  { label: 'Updated' },
  { label: 'Status' },
]

export function UsersPage() {
  const list = useUserList()
  const running = useAtom(lookups)
  const failed = useAtom(lookupErrors)

  const entries = useMemo(() => {
    const time = (entry: Entry) =>
      Math.max(entry.record === undefined ? 0 : lookedUpAt(entry.record), entry.errors?.at ?? 0)
    return entriesByUser<Fields>((entryOf) => {
      for (const record of list.records.values()) entryOf(record.username).record = record
      for (const [username, startedAt] of running) entryOf(username).startedAt = startedAt
      for (const [username, errors] of failed) entryOf(username).errors = errors
    }).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || time(b) - time(a))
  }, [list.records, running, failed])

  return (
    <UserListPage
      toolbar={<LookUpBox />}
      to="/users"
      label="Looked-up users"
      list={list}
      what="the stored profiles"
      empty="No one looked up yet. Look up a user by name, or from the menu on their name elsewhere."
      templates={templates}
      minWidth={886}
      columns={columns}
      entries={entries}
      renderRow={(entry, layout) => <UserRow entry={entry} layout={layout} />}
    />
  )
}

function UserRow({ entry, layout }: { entry: Entry; layout: Layout }) {
  const soulseekGate = useSoulseekGate()
  const { username, record, startedAt, errors } = entry
  const gate = startedAt === undefined ? soulseekGate : `Already looking up ${username}`
  let status: ReactNode = null
  if (startedAt !== undefined) status = <Busy>Looking up…</Busy>
  else if (errors !== undefined) status = <LookupErrorLine username={username} errors={errors} />
  const info = record?.info
  return (
    <UserListRow
      username={username}
      to="/users"
      layout={layout}
      templates={templates}
      status={status}
      details={[
        record?.status !== undefined && <PresenceLabel key="presence" presence={record.status.presence} size="1" />,
        info !== undefined && (
          <Text key="slot" color={info.freeSlot ? 'green' : undefined}>
            {info.freeSlot ? 'Free slot' : 'No free slot'}
          </Text>
        ),
        info !== undefined && `${info.queue.toLocaleString()} queued`,
        record !== undefined && (
          <span key="updated">
            Updated <Ago time={lookedUpAt(record)} />
          </span>
        ),
      ]}
      cells={
        <>
          <Flex className="table-cell" align="center">
            {record?.status !== undefined && <PresenceLabel presence={record.status.presence} />}
          </Flex>
          {layout === 'wide' && (
            <div className="table-cell">
              {info !== undefined && (
                <Text size="2" color={info.freeSlot ? 'green' : 'gray'}>
                  {info.freeSlot ? 'Yes' : 'No'}
                </Text>
              )}
            </div>
          )}
          <Cell end>{info?.queue.toLocaleString()}</Cell>
          <Cell>{record !== undefined && <Ago time={lookedUpAt(record)} />}</Cell>
        </>
      }
      onDelete={record === undefined ? undefined : () => void deleteUser(username)}
      again={{ label: 'Look up again', gate, onClick: () => void lookUp(username) }}
    />
  )
}
