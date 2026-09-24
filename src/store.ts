import { useEffect, useState, useSyncExternalStore } from 'react'

export type Snapshot<T> = { data?: T; error?: unknown }

export type Sink<T> = { set: (data: T) => void; fail: (error: unknown) => void }

export type Resource<T> = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Snapshot<T>
  getUpdatedAt: () => number | undefined
}

function shallowEqual<T extends object>(a: T, b: T) {
  const keys = Object.keys(a) as (keyof T)[]
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]))
}

export function createResource<T extends object>(start: (sink: Sink<T>) => () => void): Resource<T> {
  let snapshot: Snapshot<T> = {}
  let updatedAt: number | undefined
  const listeners = new Set<() => void>()
  let stop: (() => void) | undefined

  function emit(next: Snapshot<T>) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const sink: Sink<T> = {
    set(data) {
      updatedAt = Date.now()
      const unchanged = snapshot.data !== undefined && shallowEqual(snapshot.data, data)
      if (unchanged && snapshot.error === undefined) return
      emit({ data: unchanged ? snapshot.data : data })
    },
    fail(error) {
      emit({ data: snapshot.data, error })
    },
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) stop = start(sink)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop?.()
      }
    },
    getSnapshot: () => snapshot,
    getUpdatedAt: () => updatedAt,
  }
}

// TODO: phase 4 floors the interval at a multiple of the measured tick cost.
export function poll<T>(sink: Sink<T>, request: (signal: AbortSignal) => Promise<T>, interval: number) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false

  async function tick() {
    timer = undefined
    if (document.hidden) return
    inFlight = true
    try {
      sink.set(await request(controller.signal))
    } catch (error) {
      if (!controller.signal.aborted) sink.fail(error)
    }
    inFlight = false
    if (!controller.signal.aborted) timer = setTimeout(tick, interval)
  }

  function onVisibilityChange() {
    if (!document.hidden && !inFlight && timer === undefined) void tick()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  void tick()
  return () => {
    controller.abort()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

export const useResource = <T>(resource: Resource<T>) =>
  useSyncExternalStore(resource.subscribe, resource.getSnapshot)

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
