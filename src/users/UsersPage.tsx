import { ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import { Flex, Text } from '@radix-ui/themes'
import { type ReactNode, useEffect, useMemo } from 'react'

import { entriesByUser } from '../lib/db'
import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { GatedIconButton } from '../ui/controls'
import { Ago, Busy } from '../ui/status'
import { ActionsCell, Cell, GridRow } from '../ui/table'
import { UserLinkCell, UserListPage } from '../ui/UserList'
import { LookUpBox } from './LookUpBox'
import { LookupErrorLine, PresenceLabel } from './LookupStatus'
import {
  deleteUser,
  loadUserList,
  lookedUpAt,
  lookUp,
  type LookupErrors,
  lookupErrors,
  lookups,
  type UserRecord,
  userList,
} from './users'

type Entry = { username: string; record?: UserRecord; startedAt?: number; errors?: LookupErrors }

const template = 'minmax(200px, 1fr) 100px 90px 80px 100px minmax(240px, 1.2fr) 76px'

const minWidth = 886

const columns = [
  { label: 'User' },
  { label: 'Presence' },
  { label: 'Free slot' },
  { label: 'Queue', end: true },
  { label: 'Updated' },
  { label: 'Status' },
]

export function UsersPage() {
  useEffect(() => {
    void loadUserList()
  }, [])
  const list = useAtom(userList)
  const running = useAtom(lookups)
  const failed = useAtom(lookupErrors)

  const entries = useMemo(() => {
    const time = (entry: Entry) =>
      Math.max(entry.record === undefined ? 0 : lookedUpAt(entry.record), entry.errors?.at ?? 0)
    return entriesByUser<Entry>((entryOf) => {
      for (const record of list.records.values()) entryOf(record.username).record = record
      for (const [username, startedAt] of running) entryOf(username).startedAt = startedAt
      for (const [username, errors] of failed) entryOf(username).errors = errors
    }).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || time(b) - time(a))
  }, [list.records, running, failed])

  return (
    <UserListPage
      toolbar={<LookUpBox />}
      list={list}
      what="the stored profiles"
      empty="No one looked up yet. Look up a user by name, or from the menu on their name elsewhere."
      template={template}
      minWidth={minWidth}
      columns={columns}
      entries={entries}
      renderRow={(entry) => <UserRow entry={entry} />}
    />
  )
}

function UserRow({ entry }: { entry: Entry }) {
  const soulseekGate = useSoulseekGate()
  const { username, record, startedAt, errors } = entry
  const gate = startedAt === undefined ? soulseekGate : `Already looking up ${username}`
  let status: ReactNode = null
  if (startedAt !== undefined) status = <Busy>Looking up…</Busy>
  else if (errors !== undefined) status = <LookupErrorLine username={username} errors={errors} />
  const info = record?.info
  return (
    <GridRow template={template}>
      <UserLinkCell username={username} to="/users" />
      <Flex className="table-cell" align="center">
        {record?.status !== undefined && <PresenceLabel presence={record.status.presence} />}
      </Flex>
      <div className="table-cell">
        {info !== undefined && (
          <Text size="2" color={info.freeSlot ? 'green' : 'gray'}>
            {info.freeSlot ? 'Yes' : 'No'}
          </Text>
        )}
      </div>
      <Cell end>{info?.queue.toLocaleString()}</Cell>
      <Cell>{record !== undefined && <Ago time={lookedUpAt(record)} />}</Cell>
      <Flex className="table-cell" align="center">
        {status}
      </Flex>
      <ActionsCell>
        {record !== undefined && (
          <GatedIconButton label="Delete" onClick={() => void deleteUser(username)}>
            <TrashIcon />
          </GatedIconButton>
        )}
        <GatedIconButton label="Look up again" gate={gate} onClick={() => void lookUp(username)}>
          <ReloadIcon />
        </GatedIconButton>
      </ActionsCell>
    </GridRow>
  )
}
