import * as v from 'valibot'

import { oneOf, sortOf, textParam } from '../lib/params'
import { columnIds } from './table'
import { shows } from './transfers'

export const transfersSearch = v.object({
  q: textParam,
  show: oneOf(shows, 'all'),
  activeSort: sortOf(columnIds.active),
  finishedSort: sortOf(columnIds.finished),
})

export const transfersSearchDefaults = { q: '', show: 'all' } as const

export type TransfersSearch = v.InferOutput<typeof transfersSearch>
