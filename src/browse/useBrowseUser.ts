import { useNavigate } from '@tanstack/react-router'

import { useSoulseekGate } from '../soulseek/soulseek'
import { browseIfMissing } from './browse'

export function useBrowseUser() {
  const navigate = useNavigate()
  const gate = useSoulseekGate()
  return (username: string, path = '') => {
    if (gate === undefined) void browseIfMissing(username)
    void navigate({ to: '/browse', search: { user: username, path } })
  }
}
