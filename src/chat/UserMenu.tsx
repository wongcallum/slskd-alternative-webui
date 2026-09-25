import { DropdownMenu } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'

import { useBrowseUser } from '../browse/useBrowseUser'

// TODO(users): search results and transfers get this menu too once there's a user page to add to it.
export function UserMenu({ username }: { username: string }) {
  const navigate = useNavigate()
  const browseUser = useBrowseUser()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="chat-name-button">
          {username}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1">
        <DropdownMenu.Item onSelect={() => void navigate({ to: '/chat', search: { user: username } })}>
          Message
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => browseUser(username)}>Browse</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

export const renderUserMenu = (username: string) => <UserMenu username={username} />
