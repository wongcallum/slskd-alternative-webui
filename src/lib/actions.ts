import pMap from 'p-map'

import { sessionSignal } from '../session/session'
import { describeError } from './api'
import { plural } from './format'
import type { Atom } from './store'

export type Progress = { done: number; total: number }

export type Outcome = { summary: string; failed: boolean; details: string[] }

export type Actions<K extends string> = {
  running: Partial<Record<K, Progress>>
  pending: ReadonlySet<string>
  outcome?: Outcome
}

export const idle = { running: {}, pending: new Set<string>() }

// Actions run at module level so they survive navigation, and stop writing once the session ends.
export function begin<K extends string, S extends Actions<K>>(
  atom: Atom<S>,
  kind: K,
  ids: string[],
  onFinish?: () => void,
) {
  const signal = sessionSignal()
  atom.set((state) => ({
    ...state,
    running: { ...state.running, [kind]: { done: 0, total: ids.length } },
    pending: new Set([...state.pending, ...ids]),
  }))
  return {
    signal,
    advance(settled: string[]) {
      if (signal.aborted) return
      atom.set((state) => {
        const pending = new Set(state.pending)
        for (const id of settled) pending.delete(id)
        const progress = state.running[kind]
        const running = progress
          ? { ...state.running, [kind]: { ...progress, done: progress.done + settled.length } }
          : state.running
        return { ...state, running, pending }
      })
    },
    finish(outcome: Outcome) {
      if (signal.aborted) return
      atom.set((state) => {
        const { [kind]: _, ...running } = state.running
        return { ...state, running, outcome }
      })
      onFinish?.()
    },
  }
}

export type Operation = ReturnType<typeof begin>

// Returns a line for each item that failed, or undefined once the session has ended.
export async function actOnEach<T extends { id: string }>(
  operation: Operation,
  items: T[],
  name: (item: T) => string,
  act: (item: T, signal: AbortSignal) => Promise<unknown>,
  concurrency = 4,
) {
  const errors: string[] = []
  try {
    await pMap(
      items,
      async (item) => {
        try {
          await act(item, operation.signal)
        } catch (error) {
          if (operation.signal.aborted) throw error
          errors.push(`${name(item)}: ${describeError(error)}`)
        } finally {
          operation.advance([item.id])
        }
      },
      { concurrency, signal: operation.signal },
    )
  } catch {
    return undefined
  }
  return errors
}

export function dismissOutcome<S extends Actions<string>>(atom: Atom<S>) {
  atom.set((state) => ({ ...state, outcome: undefined }))
}

export function summarise(
  verb: string,
  total: number,
  failed: number,
  details: string[],
  noun: string,
  nouns = `${noun}s`,
): Outcome {
  const done = total - failed
  return {
    summary:
      failed === 0
        ? `${verb} ${plural(done, noun, nouns)}`
        : `${verb} ${done.toLocaleString()} of ${plural(total, noun, nouns)}, ${failed.toLocaleString()} failed`,
    failed: failed > 0,
    details,
  }
}
