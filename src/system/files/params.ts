import * as v from 'valibot'

import { sortOf, textParam } from '../../lib/params'
import { paneColumnIds } from '../../ui/tree/columns'

export const filesSearch = v.object({
  path: textParam,
  q: textParam,
  sort: sortOf([...paneColumnIds, 'modified']),
})

export const filesSearchDefaults = { path: '', q: '' } as const

export type FilesSearch = v.InferOutput<typeof filesSearch>
