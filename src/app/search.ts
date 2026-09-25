import { useCallback } from 'react'

// Params that filter or sort replace the history entry. Changing a navigation param pushes one, so Back returns to it.
export function useSearchChange<T extends object>(
  navigate: (options: { search: (previous: T) => T; replace: boolean }) => Promise<void>,
  navigation?: keyof T,
) {
  return useCallback(
    (patch: Partial<T>) =>
      navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: navigation === undefined || !(navigation in patch),
      }),
    [navigate, navigation],
  )
}
