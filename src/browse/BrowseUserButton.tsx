import { ArchiveIcon } from '@radix-ui/react-icons'
import { IconButton, Tooltip } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'

import { useSoulseekGate } from '../soulseek/soulseek'
import { browseIfMissing } from './browse'

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
