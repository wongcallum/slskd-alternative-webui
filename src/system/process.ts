import { api } from '../lib/api'
import { createResource, poll } from '../lib/store'

type Metric = { samples: { value: number; labels?: Record<string, string> }[] }

type Metrics = Partial<Record<string, Metric>>

export type ProcessInfo = { startedAt?: number; runtime?: string; os?: string; architecture?: string; memory?: number }

export const processPollInterval = 10_000

// slskd answers with JSON only when Accept is exactly application/json, which is what ky sends for .json().
export const processInfo = createResource<ProcessInfo>((sink) =>
  poll(
    sink,
    async (signal) => {
      const metrics = await api.get('telemetry/metrics', { signal }).json<Metrics>()
      const value = (name: string) => metrics[name]?.samples[0]?.value
      const build = metrics.dotnet_build_info?.samples[0]?.labels
      const started = value('process_start_time_seconds')
      return {
        startedAt: started === undefined ? undefined : started * 1000,
        runtime: build?.runtime_version,
        os: build?.os_version,
        architecture: build?.process_architecture,
        memory: value('process_working_set_bytes'),
      }
    },
    processPollInterval,
  ),
)
