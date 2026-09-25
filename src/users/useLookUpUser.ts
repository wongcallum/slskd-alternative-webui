import { useNavigate } from '@tanstack/react-router'

import { useSoulseekGate } from '../soulseek/soulseek'
import { lookUp } from './users'

// Asking for a user's profile is the gesture that looks them up.
export function useLookUpUser() {
  const navigate = useNavigate()
  const gate = useSoulseekGate()
  return (username: string) => {
    if (gate === undefined) void lookUp(username)
    void navigate({ to: '/users', search: { user: username } })
  }
}
