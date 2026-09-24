import { useEffect, useState, useSyncExternalStore } from 'react'
import { onSessionEnd } from './session'

export type Snapshot<T> = { data?: T; error?: unknown }

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
}

function shallowEqual<T extends object>(a: T, b: T) {
  const keys = Object.keys(a) as (keyof T)[]
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]))
}

export function createResource<T extends object>(start: (sink: Sink<T>) => Source): Resource<T> {
  let snapshot: Snapshot<T> = {}
  let updatedAt: number | undefined
  let interval: number | undefined
  let generation = 0
  const listeners = new Set<() => void>()
  let subscribers = 0
  let source: Source | undefined

  function emit(next: Snapshot<T>) {
    snapshot = next
    for (const listener of listeners) listener()
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
  onSessionEnd(() => {
    generation++
    updatedAt = undefined
    interval = undefined
    emit({})
  })

  function watch(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    subscribe(listener) {
      const unwatch = watch(listener)
      if (++subscribers === 1) source = start(createSink())
      return () => {
        unwatch()
        if (--subscribers === 0) {
          source?.stop()
          source = undefined
        }
      }
    },
    watch,
    getSnapshot: () => snapshot,
    getUpdatedAt: () => updatedAt,
    getInterval: () => interval,
    isRunning: () => source !== undefined,
    refresh: () => source?.refresh?.(),
  }
}

export type Measure = <R>(work: () => R) => R

// Main-thread work per tick is capped at 1/costFactor of the time between ticks.
const costFactor = 10

export function poll<T>(
  sink: Sink<T>,
  request: (signal: AbortSignal, measure: Measure) => Promise<T>,
  interval: number,
): Source {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let again = false

  async function tick() {
    timer = undefined
    if (document.hidden) return
    inFlight = true
    again = false
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
    const next = Math.max(interval, costFactor * cost)
    sink.pace(next)
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

export const useResource = <T>(resource: Resource<T>) => useSyncExternalStore(resource.subscribe, resource.getSnapshot)

export const useWatchedResource = <T>(resource: Resource<T>) =>
  useSyncExternalStore(resource.watch, resource.getSnapshot)

export function useFreshness(resource: Resource<unknown>) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const updatedAt = resource.getUpdatedAt()
  return updatedAt === undefined ? undefined : Math.max(0, now - updatedAt)
}

export const isStale = (age: number | undefined, interval: number) =>
  age === undefined || age > Math.min(3 * interval, 20_000)

const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | undefined
let clockNow = Date.now()

function subscribeClock(listener: () => void) {
  if (clockListeners.size === 0) {
    clockNow = Date.now()
    clockTimer = setInterval(() => {
      clockNow = Date.now()
      for (const each of clockListeners) each()
    }, 1000)
  }
  clockListeners.add(listener)
  return () => {
    clockListeners.delete(listener)
    if (clockListeners.size === 0) clearInterval(clockTimer)
  }
}

// A shared one-second clock. Components re-render only when what they select from it changes.
export const useClock = <T>(select: (now: number) => T) => useSyncExternalStore(subscribeClock, () => select(clockNow))

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
  const listeners = new Set<() => void>()
  const atom: Atom<T> = {
    get: () => value,
    set(next) {
      value = next instanceof Function ? next(value) : next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  onSessionEnd(() => atom.set(initial))
  return atom
}

export const useAtom = <T>(atom: Atom<T>) => useSyncExternalStore(atom.subscribe, atom.get)
