import './users.css'
import { DropdownMenu, Text } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useBrowseUser } from '../browse/useBrowseUser'
import { useRowTabIndex } from '../ui/listNav'
import { stop } from '../ui/table'
import { useLookUpUser } from './useLookUpUser'

type Place = 'profile' | 'message' | 'browse'

// Names often sit in rows that toggle on click, and React bubbles clicks out of the menu's portal too.
export function UserMenu({ username, here, children }: { username: string; here?: Place; children?: ReactNode }) {
  const tabIndex = useRowTabIndex()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger onClick={stop}>
        {children ?? (
          <button type="button" className="user-name-button" tabIndex={tabIndex}>
            {username}
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" onClick={stop}>
        <Items username={username} here={here} />
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

function Items({ username, here }: { username: string; here?: Place }) {
  const navigate = useNavigate()
  const lookUpUser = useLookUpUser()
  const browseUser = useBrowseUser()
  return (
    <>
      {here !== 'profile' && <DropdownMenu.Item onSelect={() => lookUpUser(username)}>Profile</DropdownMenu.Item>}
      {here !== 'message' && (
        <DropdownMenu.Item onSelect={() => void navigate({ to: '/chat', search: { user: username } })}>
          Message
        </DropdownMenu.Item>
      )}
      {here !== 'browse' && <DropdownMenu.Item onSelect={() => browseUser(username)}>Browse</DropdownMenu.Item>}
    </>
  )
}

export function UserCell({ username }: { username?: string }) {
  return (
    <div className="table-cell" title={username}>
      {username !== undefined && (
        <Text size="2">
          <UserMenu username={username} />
        </Text>
      )}
    </div>
  )
}

export const renderUserMenu = (username: string) => <UserMenu username={username} />
