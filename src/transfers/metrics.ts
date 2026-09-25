import { metricsHub } from '../lib/hubs'
import { createResource } from '../lib/store'

type Metrics = { downloads: { inProgress: { files: number }; queued: { files: number } } }

// slskd's gauges lag the downloads list by a few seconds and can briefly dip below zero (see docs/facts.md).
export const unfinishedDownloads = createResource<{ count: number }>((sink) => ({
  stop: metricsHub.on<Metrics>('Update', ({ downloads }) =>
    sink.set({ count: Math.max(0, downloads.inProgress.files) + Math.max(0, downloads.queued.files) }),
  ),
}))
