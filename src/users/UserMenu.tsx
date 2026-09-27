import './users.css'
import { DropdownMenu, Text } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useRef } from 'react'

import { useBrowseUser } from '../browse/useBrowseUser'
import { useRowTabIndex } from '../ui/listNav'
import { stop } from '../ui/table'
import { useLookUpUser } from './useLookUpUser'

type Place = 'profile' | 'message' | 'browse'

type Props = { username: string; here?: Place; onReply?: () => void; onHide?: () => void; children?: ReactNode }

// Names often sit in rows that toggle on click, and React bubbles clicks out of the menu's portal too.
// The menu hands focus back to its trigger as it closes, so Reply waits for that before moving focus.
export function UserMenu({ username, here, onReply, onHide, children }: Props) {
  const tabIndex = useRowTabIndex()
  const replying = useRef(false)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger onClick={stop}>
        {children ?? (
          <button type="button" className="user-name-button" tabIndex={tabIndex}>
            {username}
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        size="1"
        onClick={stop}
        onCloseAutoFocus={(event) => {
          if (!replying.current) return
          replying.current = false
          event.preventDefault()
          onReply?.()
        }}
      >
        {onReply !== undefined && (
          <>
            <DropdownMenu.Item onSelect={() => (replying.current = true)}>Reply</DropdownMenu.Item>
            <DropdownMenu.Separator />
          </>
        )}
        <Items username={username} here={here} />
        {onHide !== undefined && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={onHide}>Hide in these results</DropdownMenu.Item>
          </>
        )}
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

export function UserCell({ username, onHide }: { username?: string; onHide?: () => void }) {
  return (
    <div className="table-cell" title={username}>
      {username !== undefined && (
        <Text size="2">
          <UserMenu username={username} onHide={onHide} />
        </Text>
      )}
    </div>
  )
}

export const renderUserMenu = (username: string, onReply?: () => void) => (
  <UserMenu username={username} onReply={onReply} />
)
