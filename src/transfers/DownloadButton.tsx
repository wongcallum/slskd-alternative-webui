import { formatBytes } from '../lib/format'
import { type Atom, useAtom } from '../lib/store'
import { useSoulseekGate } from '../soulseek/soulseek'
import { ActionButton } from '../ui/controls'
import type { Downloads } from './enqueue'

type Props = { downloads: Atom<Downloads>; count: number; size: number; onClick: () => void }

export function DownloadButton({ downloads, count, size, onClick }: Props) {
  const gate = useSoulseekGate()
  const { running } = useAtom(downloads)
  return (
    <ActionButton
      label={`Download ${count.toLocaleString()} (${formatBytes(size)})`}
      busy="Enqueueing"
      progress={running.download}
      gate={gate}
      shortcut={{ key: 'D', name: 'Download' }}
      onClick={onClick}
    />
  )
}
