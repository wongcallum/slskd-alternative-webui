import { functionalUpdate } from '@tanstack/react-table'
import { useSyncExternalStore } from 'react'

import { createListeners } from './listeners'
import { onSessionEnd } from './session'

type Snapshot<T> = { data?: T; error?: unknown }

export type Sink<T> = {
  set: (data: T) => void
  fail: (error: unknown) => void
  pace: (interval: number) => void
}

export type Source = { stop: () => void; refresh?: () => void }

export type Resource<T> = {
  subscribe: (listener: () => void) => () => void
  watch: (listener: () => void) => () => void
  getSnapshot: () => Snapshot<T>
  getUpdatedAt: () => number | undefined
  getInterval: () => number | undefined
  isRunning: () => boolean
  refresh: () => void
  // Changes the data held while the resource runs, as a push would, such as with the result of an action.
  amend(update: (data: T) => T): void
  // For one that will never be used again, which the session's end would otherwise keep until then.
  dispose: () => void
}

export function shallowEqual<T extends object>(a: T, b: T) {
  const keys = Object.keys(a) as (keyof T)[]
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]))
}

// The previous array while nothing in it changed, since every push and poll carries new ones.
export const keepItems = <T>(previous: readonly T[] | undefined, next: readonly T[]) =>
  previous !== undefined && previous.length === next.length && previous.every((each, i) => Object.is(each, next[i]))
    ? previous
    : next

export function createResource<T extends object>(start: (sink: Sink<T>) => Source): Resource<T> {
  let snapshot: Snapshot<T> = {}
  let updatedAt: number | undefined
  let interval: number | undefined
  let generation = 0
  const listeners = createListeners()
  let subscribers = 0
  let source: Source | undefined
  let live: Sink<T> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  function emit(next: Snapshot<T>) {
    snapshot = next
    listeners.notify()
  }

  function createSink(): Sink<T> {
    const current = generation
    return {
      set(data) {
        if (current !== generation) return
        updatedAt = Date.now()
        const unchanged = snapshot.data !== undefined && shallowEqual(snapshot.data, data)
        if (unchanged && snapshot.error === undefined) return
        emit({ data: unchanged ? snapshot.data : data })
      },
      fail(error) {
        if (current === generation) emit({ data: snapshot.data, error })
      },
      pace(next) {
        if (current === generation) interval = next
      },
    }
  }

  // A source still running when the session ends writes to a dead sink until the app unmounts and stops it.
  const unlisten = onSessionEnd(() => {
    generation++
    updatedAt = undefined
    interval = undefined
    emit({})
  })

  return {
    subscribe(listener) {
      const unwatch = listeners.add(listener)
      clearTimeout(stopTimer)
      if (++subscribers === 1 && source === undefined) {
        live = createSink()
        source = start(live)
      }
      return () => {
        unwatch()
        if (--subscribers > 0) return
        // A page that reads it too may be mounting in the same commit, as between the search list and its results.
        stopTimer = setTimeout(() => {
          source?.stop()
          source = undefined
          live = undefined
        })
      }
    },
    watch: listeners.add,
    getSnapshot: () => snapshot,
    getUpdatedAt: () => updatedAt,
    getInterval: () => interval,
    isRunning: () => source !== undefined,
    refresh: () => source?.refresh?.(),
    amend(update) {
      if (live === undefined || snapshot.data === undefined) return
      const next = update(snapshot.data)
      if (next !== snapshot.data) live.set(next)
    },
    dispose: unlisten,
  }
}

// One resource per key, such as a room, made when it's first asked for. A key that isn't a string needs an id.
export function createResourceMap<K, T>(
  create: (key: K) => Resource<T>,
  ...[id = String]: K extends string ? [id?: (key: K) => string] : [id: (key: K) => string]
) {
  const resources = new Map<string, Resource<T>>()
  return {
    get: (key: K) => {
      let resource = resources.get(id(key))
      if (resource === undefined) resources.set(id(key), (resource = create(key)))
      return resource
    },
    forget(key: K) {
      resources.get(id(key))?.dispose()
      resources.delete(id(key))
    },
  }
}

export type Measure = <R>(work: () => R) => R

// Main-thread work per tick is capped at 1/costFactor of the time between ticks.
const costFactor = 10

// A hidden tab stops polling until it's shown again, unless it's to keep the tab's title current.
export function poll<T>(
  sink: Sink<T>,
  request: (signal: AbortSignal, measure: Measure) => Promise<T>,
  interval: number | (() => number),
  { whileHidden = false } = {},
): Source {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let again = false

  async function tick() {
    timer = undefined
    if (document.hidden && !whileHidden) return
    inFlight = true
    again = false
    const started = performance.now()
    let cost = 0
    const measure: Measure = (work) => {
      const start = performance.now()
      try {
        return work()
      } finally {
        cost += performance.now() - start
      }
    }
    try {
      sink.set(await request(controller.signal, measure))
    } catch (error) {
      if (!controller.signal.aborted) sink.fail(error)
    }
    inFlight = false
    if (controller.signal.aborted) return
    const next = Math.max(typeof interval === 'number' ? interval : interval(), costFactor * cost)
    // Updates arrive a request apart as well as an interval, and a slow link's list takes seconds to download.
    sink.pace(next + performance.now() - started)
    timer = setTimeout(tick, again ? 0 : next)
  }

  function onVisibilityChange() {
    if (!document.hidden && !inFlight && timer === undefined) void tick()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  void tick()
  return {
    stop() {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    },
    refresh() {
      if (inFlight) again = true
      else if (timer !== undefined) {
        clearTimeout(timer)
        void tick()
      }
    },
  }
}

// Resolves true once the data passes, or false at the timeout. The resource keeps running meanwhile.
export function waitFor<T>(resource: Resource<T>, passes: (data: T) => boolean, signal: AbortSignal, timeout: number) {
  return new Promise<boolean>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => finish(() => resolve(false)), timeout)
    const check = () => {
      const { data } = resource.getSnapshot()
      if (data !== undefined && passes(data)) finish(() => resolve(true))
    }
    const onAbort = () => finish(() => reject(signal.reason))
    const unsubscribe = resource.subscribe(check)
    signal.addEventListener('abort', onAbort)
    function finish(settle: () => void) {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', onAbort)
      settle()
    }
    check()
  })
}

export const useResource = <T>(resource: Resource<T>) => useSyncExternalStore(resource.subscribe, resource.getSnapshot)

export const useWatchedResource = <T>(resource: Resource<T>) =>
  useSyncExternalStore(resource.watch, resource.getSnapshot)

export const isStale = (age: number | undefined, interval: number) =>
  age === undefined || age > Math.min(3 * interval, 20_000)

const clockListeners = createListeners()
let clockTimer: ReturnType<typeof setInterval> | undefined
let clockNow = Date.now()

function subscribeClock(listener: () => void) {
  if (clockListeners.size() === 0) {
    clockNow = Date.now()
    clockTimer = setInterval(() => {
      clockNow = Date.now()
      clockListeners.notify()
    }, 1000)
  }
  const remove = clockListeners.add(listener)
  return () => {
    remove()
    if (clockListeners.size() === 0) clearInterval(clockTimer)
  }
}

// A shared one-second clock. Components re-render only when what they select from it changes.
export const useClock = <T>(select: (now: number) => T) => useSyncExternalStore(subscribeClock, () => select(clockNow))

export const useFreshness = (resource: Resource<unknown>) =>
  useClock((now) => {
    const updatedAt = resource.getUpdatedAt()
    return updatedAt === undefined ? undefined : Math.max(0, now - updatedAt)
  })

export function useStale(resource: Resource<unknown>, fallbackInterval: number) {
  return useClock((now) => {
    const updatedAt = resource.getUpdatedAt()
    return updatedAt === undefined || isStale(now - updatedAt, resource.getInterval() ?? fallbackInterval)
  })
}

export type Atom<T> = {
  get: () => T
  set: (next: T | ((current: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

export function createAtom<T>(initial: T): Atom<T> {
  let value = initial
  const listeners = createListeners()
  const atom: Atom<T> = {
    get: () => value,
    set(next) {
      value = functionalUpdate(next, value)
      listeners.notify()
    },
    subscribe: listeners.add,
  }
  onSessionEnd(() => atom.set(initial))
  return atom
}

export const useAtom = <T>(atom: Atom<T>) => useSyncExternalStore(atom.subscribe, atom.get)

export function without<V>(map: ReadonlyMap<string, V>, key: string) {
  const next = new Map(map)
  next.delete(key)
  return next
}

// Loaded as it starts, unless skipped, and again on refresh, but never on a timer. A newer load aborts the one before.
export function load<T>(
  sink: Sink<T>,
  request: (signal: AbortSignal) => Promise<T>,
  { loading, skip = false }: { loading?: Atom<boolean>; skip?: boolean } = {},
): Required<Source> {
  let controller: AbortController | undefined
  function run() {
    controller?.abort()
    const current = (controller = new AbortController())
    loading?.set(true)
    request(current.signal).then(
      (data) => {
        if (current.signal.aborted) return
        sink.set(data)
        loading?.set(false)
      },
      (error: unknown) => {
        if (current.signal.aborted) return
        sink.fail(error)
        loading?.set(false)
      },
    )
  }
  if (!skip) run()
  return {
    stop() {
      controller?.abort()
      loading?.set(false)
    },
    refresh: run,
  }
}
