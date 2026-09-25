import { ArchiveIcon } from '@radix-ui/react-icons'
import { IconButton, Tooltip } from '@radix-ui/themes'

import { useBrowseUser } from './useBrowseUser'

export function BrowseUserButton({ username, directory }: { username: string; directory: string }) {
  const browseUser = useBrowseUser()
  return (
    <Tooltip content={`Browse ${username}`}>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        aria-label={`Browse ${username}`}
        onClick={() => browseUser(username, directory)}
      >
        <ArchiveIcon />
      </IconButton>
    </Tooltip>
  )
}
