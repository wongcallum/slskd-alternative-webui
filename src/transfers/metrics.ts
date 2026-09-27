import { metricsHub } from '../lib/hubs'
import { createResource, type Resource } from '../lib/store'
import { type Direction, perDirection } from './transfers'

type RawDirection = {
  inProgress: { files: number; averageSpeed: number; totalSpeed: number }
  queued: { files: number }
  completed: { succeeded: number; failed: number }
}

export type RawMetrics = { downloads: RawDirection; uploads: RawDirection }

type Metrics = { running: number; queued: number; speed: number }

// slskd's gauges lag the lists by a few seconds and can briefly dip below zero (see docs/facts.md).
const createMetrics = (direction: Direction): Resource<Metrics> =>
  createResource((sink) => ({
    stop: metricsHub.on<RawMetrics>('Update', (metrics) => {
      const { inProgress, queued } = metrics[`${direction}s`]
      sink.set({
        running: Math.max(0, inProgress.files),
        queued: Math.max(0, queued.files),
        // totalSpeed only counts files running at its 5 s recount, so it misses short files that averageSpeed catches.
        speed: Math.max(inProgress.totalSpeed, inProgress.averageSpeed),
      })
    }),
  }))

export const metrics = perDirection(createMetrics)
