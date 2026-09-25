import { useSoulseekGate } from '../soulseek/soulseek'
import { UsernameBox } from '../ui/UsernameBox'
import { browseIfMissing } from './browse'

// Asking for a user is the gesture that browses them, unless their share is cached.
export function UserBox({ current }: { current?: string }) {
  const gate = useSoulseekGate()
  return (
    <UsernameBox
      current={current}
      action="Browse"
      to="/browse"
      onAsk={(username) => {
        if (gate === undefined) void browseIfMissing(username)
      }}
    />
  )
}
