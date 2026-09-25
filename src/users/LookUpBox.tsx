import { useSoulseekGate } from '../soulseek/soulseek'
import { UsernameBox } from '../ui/UsernameBox'
import { lookUp } from './users'

export function LookUpBox({ current }: { current?: string }) {
  const gate = useSoulseekGate()
  return (
    <UsernameBox
      current={current}
      action="Look up"
      to="/users"
      onAsk={(username) => {
        if (gate === undefined) void lookUp(username)
      }}
    />
  )
}
