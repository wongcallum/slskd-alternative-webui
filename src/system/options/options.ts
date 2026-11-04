import { api, optionsQueue } from '../../lib/api'
import { applicationHub, followHub, useLiveResource, type Via } from '../../lib/hubs'
import { createResource, load, keepItems, useResource } from '../../lib/store'

// Secrets arrive redacted. Only what's read here is typed, and the rest is shown as it is.
export type RawOptions = {
  remoteConfiguration: boolean
  remoteFileManagement: boolean
  directories: { downloads: string; incomplete: string }
  shares: { directories: string[]; filters: string[] }
  relay: { enabled: boolean }
  integrations: { vpn?: { enabled: boolean } }
}

export type Settings = { readonly [key: string]: unknown }

export type Options = {
  via: Via
  remoteConfiguration: boolean
  remoteFileManagement: boolean
  downloads: string
  incomplete: string
  shareDirectories: readonly string[]
  shareFilters: readonly string[]
  relay: boolean
  vpn: boolean
  // Everything, without the nulls the hub keeps and REST leaves out.
  settings: Settings
}

export const optionsPollInterval = 10_000

function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== null)
      .map(([key, child]) => [key, withoutNulls(child)]),
  )
}

let held: { json: string; settings: Settings } | undefined

// The whole object keeps its identity while nothing in it changes.
function keepSettings(raw: RawOptions) {
  const settings = withoutNulls(raw) as Settings
  const json = JSON.stringify(settings)
  if (held?.json !== json) held = { json, settings }
  return held.settings
}

function toOptions(via: Via, raw: RawOptions): Options {
  const previous = options.getSnapshot().data
  return {
    via,
    remoteConfiguration: raw.remoteConfiguration,
    remoteFileManagement: raw.remoteFileManagement,
    downloads: raw.directories.downloads,
    incomplete: raw.directories.incomplete,
    shareDirectories: keepItems(previous?.shareDirectories, raw.shares.directories),
    shareFilters: keepItems(previous?.shareFilters, raw.shares.filters),
    relay: raw.relay.enabled,
    vpn: raw.integrations.vpn?.enabled === true,
    settings: keepSettings(raw),
  }
}

const fetchOptions = async (via: Via, signal: AbortSignal) =>
  toOptions(via, await optionsQueue(() => api.get('options', { signal }).json<RawOptions>()))

export const options = createResource<Options>((sink) => {
  const offOptions = applicationHub.on<RawOptions>('OPTIONS', (raw) => sink.set(toOptions('hub', raw)))
  const following = followHub(applicationHub, sink, {
    snapshot: (signal) => fetchOptions('hub', signal),
    request: (signal) => fetchOptions('poll', signal),
    interval: optionsPollInterval,
  })
  return {
    stop() {
      following.stop()
      offOptions()
    },
  }
})

export const optionsPending = "Checking slskd's options"

export const useOptionsData = () => useResource(options).data

export const useOptions = () => useLiveResource(options, applicationHub, optionsPollInterval)

// Only a new process changes these, so they're read again whenever the application hub connects.
export const startupOptions = createResource<{ debug: boolean }>((sink) => {
  const source = load(sink, async (signal) => {
    const raw = await api.get('options/startup', { signal }).json<{ debug: boolean }>()
    return { debug: raw.debug }
  })
  let connected = applicationHub.getStatus().state === 'connected'
  const unsubscribe = applicationHub.subscribe(() => {
    const now = applicationHub.getStatus().state === 'connected'
    if (now && !connected) source.refresh()
    connected = now
  })
  return {
    stop() {
      unsubscribe()
      source.stop()
    },
  }
})
