import { metricsHub, useHub } from '../lib/hubs'
import { useResource, useStale, useWatchedResource } from '../lib/store'
import { metrics } from './metrics'
import { type Direction, pollInterval, transfers } from './transfers'

export type Figures = {
  exact: boolean
  live: boolean
  counts?: { running: number; queued: number }
  speed?: number
}

// The list's own totals while its page polls it and it's fresh, otherwise slskd's metrics, which are estimates.
export function useTransferFigures(direction: Direction): Figures {
  const hub = useHub(metricsHub)
  const estimate = useResource(metrics[direction]).data
  const list = useWatchedResource(transfers[direction]).data
  const stale = useStale(transfers[direction], pollInterval)
  const hubSpeed = hub.state === 'connected' ? estimate?.speed : undefined
  if (transfers[direction].isRunning() && list !== undefined && !stale) {
    return {
      exact: true,
      live: true,
      counts: { running: list.transferring, queued: list.queued },
      speed: list.speed ?? hubSpeed,
    }
  }
  return { exact: false, live: hub.state === 'connected', counts: estimate, speed: hubSpeed }
}
