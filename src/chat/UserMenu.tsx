import { DropdownMenu } from '@radix-ui/themes'

import { useBrowseUser } from '../browse/useBrowseUser'

export function UserMenu({ username }: { username: string }) {
  const browseUser = useBrowseUser()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="chat-name-button">
          {username}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1">
        <DropdownMenu.Item onSelect={() => browseUser(username)}>Browse</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

export const renderUserMenu = (username: string) => <UserMenu username={username} />
