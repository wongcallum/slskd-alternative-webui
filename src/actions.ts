import { plural } from './format'
import { sessionSignal } from './session'
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
export function begin<K extends string, S extends Actions<K>>(atom: Atom<S>, kind: K, ids: string[], onFinish?: () => void) {
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
        : `${verb} ${done.toLocaleString()} of ${plural(total, noun, nouns)} · ${failed.toLocaleString()} failed`,
    failed: failed > 0,
    details,
  }
}
