import { useSyncExternalStore } from 'react'

type Query = { matches: () => boolean; subscribe: (listener: () => void) => () => void }

const queries = new Map<string, Query>()

function queryFor(text: string) {
  let query = queries.get(text)
  if (query === undefined) {
    const list = window.matchMedia(text)
    query = {
      matches: () => list.matches,
      subscribe: (listener) => {
        list.addEventListener('change', listener)
        return () => list.removeEventListener('change', listener)
      },
    }
    queries.set(text, query)
  }
  return query
}

export function useMedia(text: string) {
  const query = queryFor(text)
  return useSyncExternalStore(query.subscribe, query.matches)
}

// Radix Themes' breakpoints, so a hook and a responsive prop switch at the same widths.
const breakpoints = { sm: 768, md: 1024, lg: 1280 } as const

export const useFrom = (breakpoint: keyof typeof breakpoints) => useMedia(`(min-width: ${breakpoints[breakpoint]}px)`)

// Phones and tablets, where nothing hovers and a tap is the only way in.
export const useTouch = () => useMedia('(hover: none)')
