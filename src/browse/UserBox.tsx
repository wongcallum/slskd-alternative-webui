import { useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { UsernameBox } from '../ui/UsernameBox'
import { browseIfMissing, browses, loadedShares } from './browse'

// Asking for a user is the gesture that browses them, unless their share is cached.
export function UserBox({ current }: { current?: string }) {
  const gate = useSoulseekGate()
  const loaded = useAtom(loadedShares).get(current ?? '')
  const browsing = useAtom(browses).has(current ?? '')
  return (
    <UsernameBox
      current={current}
      action="Browse"
      to="/browse"
      currentGate={browsing ? 'Already browsing' : loaded?.status === 'ready' ? 'Already open' : gate}
      onAsk={(username) => {
        if (gate === undefined) void browseIfMissing(username)
      }}
    />
  )
}
