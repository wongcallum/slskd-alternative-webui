import { Badge, Tooltip } from '@radix-ui/themes'

import { useTransferFigures } from './figures'

export function DownloadsBadge() {
  const { exact, live, counts } = useTransferFigures('download')
  const count = counts === undefined ? 0 : counts.running + counts.queued
  if (count === 0) return null
  const unfinished = `${count} download${count === 1 ? '' : 's'} unfinished`
  return (
    <Tooltip content={exact ? unfinished : `About ${unfinished}`}>
      <Badge ml="2" radius="full" color={live ? undefined : 'gray'}>
        {count}
      </Badge>
    </Tooltip>
  )
}
