import { functionalUpdate } from '@tanstack/react-table'

import { createListeners } from './listeners'
import type { Atom } from './store'

// Another tab changed the key, or cleared the storage.
export function onStoredChange(key: string, listener: () => void) {
  window.addEventListener('storage', (event) => {
    if (event.storageArea === localStorage && (event.key === null || event.key === key)) listener()
  })
}

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
  onStoredChange(key, () => {
    value = read()
    listeners.notify()
  })
  return {
    get: () => value,
    set(next) {
      value = functionalUpdate(next, value)
      if (value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(value))
      listeners.notify()
    },
    subscribe: listeners.add,
  }
}
