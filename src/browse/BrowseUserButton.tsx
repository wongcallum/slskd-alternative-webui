import { ArchiveIcon } from '@radix-ui/react-icons'

import { GatedIconButton } from '../ui/controls'
import { useBrowseUser } from './useBrowseUser'

export function BrowseUserButton({ username, directory }: { username: string; directory: string }) {
  const browseUser = useBrowseUser()
  return (
    <GatedIconButton label={`Browse ${username}`} onClick={() => browseUser(username, directory)}>
      <ArchiveIcon />
    </GatedIconButton>
  )
}
