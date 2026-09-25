import { Badge, Tooltip } from '@radix-ui/themes'

import { plural } from '../lib/format'
import { useTransferFigures } from './figures'

export function DownloadsBadge() {
  const { exact, live, counts } = useTransferFigures('download')
  const count = counts === undefined ? 0 : counts.running + counts.queued
  if (count === 0) return null
  const unfinished = plural(count, 'unfinished download')
  return (
    <Tooltip content={exact ? unfinished : `About ${unfinished}`}>
      <Badge ml="2" radius="full" color={live ? undefined : 'gray'}>
        {count.toLocaleString()}
      </Badge>
    </Tooltip>
  )
}
