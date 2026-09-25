import * as v from 'valibot'

import { sortOf, textParam } from '../../lib/params'
import { audioColumnIds, paneColumnIds } from '../../ui/tree/columns'

export const sharesSearch = v.object({
  path: textParam,
  q: textParam,
  sort: sortOf([...paneColumnIds, ...audioColumnIds]),
})

export const sharesSearchDefaults = { path: '', q: '' } as const

export type SharesSearch = v.InferOutput<typeof sharesSearch>
