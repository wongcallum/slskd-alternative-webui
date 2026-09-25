import { createListeners } from './listeners'
import type { Atom } from './store'

// An atom kept in localStorage and followed across tabs. Unlike createAtom, it survives the session ending.
export function createStoredAtom<T>(key: string, parse: (stored: unknown) => T | undefined, fallback: T): Atom<T> {
  const listeners = createListeners()
  const read = () => {
    try {
      return parse(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? fallback
    } catch {
      return fallback
    }
  }
  let value = read()
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage || (event.key !== null && event.key !== key)) return
    value = read()
    listeners.notify()
  })
  return {
    get: () => value,
    set(next) {
      // oxlint-disable-next-line unicorn/no-instanceof-builtins -- typeof can't narrow a generic T
      value = next instanceof Function ? next(value) : next
      if (value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(value))
      listeners.notify()
    },
    subscribe: listeners.add,
  }
}
