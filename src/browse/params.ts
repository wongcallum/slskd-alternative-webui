import * as v from 'valibot'

import { sortOf, textParam } from '../lib/params'
import { audioColumnIds, paneColumnIds } from '../ui/tree/columns'

export const browseSearch = v.object({
  user: textParam,
  path: textParam,
  q: textParam,
  sort: sortOf([...paneColumnIds, ...audioColumnIds]),
})

export const browseSearchDefaults = { user: '', path: '', q: '' } as const

export type BrowseSearch = v.InferOutput<typeof browseSearch>
