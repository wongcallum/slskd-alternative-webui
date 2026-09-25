import { Flex, Text, Tooltip } from '@radix-ui/themes'
import { memo, type ReactNode, useDeferredValue, useMemo, useState } from 'react'

import { plural } from '../lib/format'
import { useResource } from '../lib/store'
import { FilterField } from '../ui/controls'
import { Polling } from '../ui/status'
import { Cell, GridRow, VirtualTable } from '../ui/table'
import { UserMenu } from '../users/UserMenu'
import { type RoomUser, roomUsers } from './rooms'

const regions = new Intl.DisplayNames(undefined, { type: 'region' })

function countryName(code: string) {
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

const template = 'minmax(0, 1fr) 36px 56px'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })

const userKey = (user: RoomUser) => user.username

// slskd takes a user's details as they join and never updates them, so status and speed would soon be wrong.
export function RoomUsers({ room, fill }: { room: string; fill?: boolean }) {
  const { data, error } = useResource(roomUsers(room))
  const [filter, setFilter] = useState('')
  const needle = useDeferredValue(filter).toLowerCase()
  const users = data?.users
  const shown = useMemo(
    () =>
      users === undefined || needle === ''
        ? users
        : users.filter((user) => user.username.toLowerCase().includes(needle)),
    [users, needle],
  )

  let content: ReactNode
  if (shown === undefined) content = <Polling what="the users" error={error} />
  else {
    content = (
      <VirtualTable
        minWidth={0}
        items={shown}
        itemKey={userKey}
        rowSize={fill ? 40 : 32}
        renderItem={(user) => <UserRow user={user} />}
      />
    )
  }

  return (
    <Flex
      direction="column"
      width={fill ? undefined : '260px'}
      flexGrow={fill ? '1' : undefined}
      flexShrink="0"
      minHeight="0"
      style={fill ? undefined : { boxShadow: 'inset 1px 0 0 0 var(--gray-a5)' }}
    >
      <Flex direction="column" gap="2" px="3" py="2" flexShrink="0">
        <Text size="2" color="gray">
          {users === undefined ? 'Users' : plural(users.length, 'user')}
        </Text>
        <FilterField placeholder="Filter users" value={filter} onChange={setFilter} style={{ width: '100%' }} />
      </Flex>
      {content}
    </Flex>
  )
}

const UserRow = memo(function UserRow({ user }: { user: RoomUser }) {
  return (
    <GridRow template={template}>
      <div className="table-cell">
        <Text size="2" weight="medium" color={user.self ? undefined : 'gray'} highContrast={!user.self}>
          {user.self ? user.username : <UserMenu username={user.username} />}
        </Text>
      </div>
      {user.country === undefined ? (
        <div />
      ) : (
        <Tooltip content={countryName(user.country)}>
          <div className="table-cell">
            <Text size="1" color="gray">
              {user.country}
            </Text>
          </div>
        </Tooltip>
      )}
      <Cell end title={`${plural(user.files, 'file')} shared`}>
        {compact.format(user.files)}
      </Cell>
    </GridRow>
  )
})
