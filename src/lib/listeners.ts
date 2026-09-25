export function createListeners() {
  const listeners = new Set<() => void>()
  return {
    add: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notify: () => {
      for (const listener of listeners) listener()
    },
    size: () => listeners.size,
  }
}
