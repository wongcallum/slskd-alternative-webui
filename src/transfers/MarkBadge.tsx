import { Badge } from '@radix-ui/themes'

import { Tip } from '../ui/controls'
import type { Mark } from './enqueue'

export function MarkBadge({ mark }: { mark: Mark }) {
  if (mark.ok) return <Badge color="green">Enqueued</Badge>
  return (
    <Tip content={mark.message}>
      <Badge color="red">Failed</Badge>
    </Tip>
  )
}
