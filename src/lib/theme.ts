import { useMedia } from './media'
import { useAtom } from './store'
import { createStoredAtom } from './stored'

type Appearance = 'light' | 'dark'

// Following the system is stored as no choice at all, which index.html's script relies on.
export const themeChoice = createStoredAtom<Appearance | undefined>(
  'slskd-alt-theme',
  (stored) => (stored === 'light' || stored === 'dark' ? stored : undefined),
  undefined,
)

export function useAppearance(): Appearance {
  const choice = useAtom(themeChoice)
  const systemDark = useMedia('(prefers-color-scheme: dark)')
  return choice ?? (systemDark ? 'dark' : 'light')
}
