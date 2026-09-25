import { Badge, Tooltip } from '@radix-ui/themes'

import { metricsHub, useHub } from '../lib/hubs'
import { useResource, useStale, useWatchedResource } from '../lib/store'
import { unfinishedDownloads } from './metrics'
import { pollInterval, transfers } from './transfers'

// While the Downloads page polls the list, the badge shows its exact count instead of the metrics estimate.
export function DownloadsBadge() {
  const metrics = useResource(unfinishedDownloads)
  const hub = useHub(metricsHub)
  const list = useWatchedResource(transfers.download)
  const listStale = useStale(transfers.download, pollInterval)
  const exact =
    transfers.download.isRunning() && list.data !== undefined && !listStale
      ? list.data.transferring + list.data.queued
      : undefined
  const count = exact ?? metrics.data?.count
  if (!count) return null
  const unfinished = `${count} download${count === 1 ? '' : 's'} unfinished`
  return (
    <Tooltip content={exact === undefined ? `About ${unfinished}` : unfinished}>
      <Badge ml="2" radius="full" color={exact !== undefined || hub.state === 'connected' ? undefined : 'gray'}>
        {count}
      </Badge>
    </Tooltip>
  )
}
