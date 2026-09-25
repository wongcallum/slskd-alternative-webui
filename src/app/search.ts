import { useCallback } from 'react'

import type { SearchProps } from '../lib/params'

type Navigate<T> = (options: { search: (previous: T) => T; replace: boolean }) => Promise<void>

// Params that filter or sort replace the history entry. Changing a navigation param pushes one, so Back returns to it.
export function useSearchProps<T extends object>(
  search: T,
  navigate: Navigate<NoInfer<T>>,
  navigation?: keyof T,
): SearchProps<T> {
  const onSearchChange = useCallback(
    (patch: Partial<T>) =>
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: navigation === undefined || !(navigation in patch),
      }),
    [navigate, navigation],
  )
  return { search, onSearchChange }
}
