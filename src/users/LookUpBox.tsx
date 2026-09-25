import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { UsernameBox } from '../ui/UsernameBox'
import { lookUp, lookups } from './users'

export function LookUpBox({ current }: { current?: string }) {
  const gate = useSoulseekGate()
  const looking = useAtom(lookups).has(current ?? '')
  return (
    <UsernameBox
      current={current}
      action="Look up"
      to="/users"
      currentGate={looking ? 'Looking up' : gate}
      onAsk={(username) => {
        if (gate === undefined) void lookUp(username)
      }}
    />
  )
}
