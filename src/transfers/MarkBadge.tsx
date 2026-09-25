import { Badge, Tooltip } from '@radix-ui/themes'
import type { Mark } from './enqueue'

export function MarkBadge({ mark }: { mark: Mark }) {
  if (mark.ok) return <Badge color="green">Enqueued</Badge>
  return (
    <Tooltip content={mark.message}>
      <Badge color="red">Failed</Badge>
    </Tooltip>
  )
}
