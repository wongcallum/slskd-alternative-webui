import { useSyncExternalStore } from 'react'

import { useAtom } from '../lib/store'
import { createStoredAtom } from '../lib/stored'

export type Appearance = 'light' | 'dark'

// Following the system is stored as no choice at all, which index.html's script relies on.
export const themeChoice = createStoredAtom<Appearance | undefined>(
  'slskd-alt-theme',
  (stored) => (stored === 'light' || stored === 'dark' ? stored : undefined),
  undefined,
)

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')

function subscribeSystem(listener: () => void) {
  prefersDark.addEventListener('change', listener)
  return () => prefersDark.removeEventListener('change', listener)
}

export function useAppearance(): Appearance {
  const choice = useAtom(themeChoice)
  const systemDark = useSyncExternalStore(subscribeSystem, () => prefersDark.matches)
  return choice ?? (systemDark ? 'dark' : 'light')
}
