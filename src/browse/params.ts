import * as v from 'valibot'

import { sortOf, textParam } from '../lib/params'
import { columnIds } from './share/paneTable'

export const browseSearch = v.object({
  user: textParam,
  path: textParam,
  q: textParam,
  sort: sortOf(columnIds),
})

export const browseSearchDefaults = { user: '', path: '', q: '' } as const

export type BrowseSearch = v.InferOutput<typeof browseSearch>
