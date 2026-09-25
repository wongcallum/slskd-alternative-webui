import { Badge, Spinner } from '@radix-ui/themes'

import { Tip } from '../ui/controls'
import type { Mark } from './enqueue'

export function MarkBadge({ mark, pending }: { mark?: Mark; pending: boolean }) {
  return (
    <>
      {mark?.ok === true && <Badge color="green">Enqueued</Badge>}
      {mark?.ok === false && (
        <Tip content={mark.message}>
          <Badge color="red">Failed</Badge>
        </Tip>
      )}
      {pending && <Spinner size="1" />}
    </>
  )
}
