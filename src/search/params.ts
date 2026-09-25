import * as v from 'valibot'

import { textParam } from '../lib/params'

export const searchesSearch = v.object({ q: textParam })

export const searchesSearchDefaults = { q: '' } as const

export type SearchesSearch = v.InferOutput<typeof searchesSearch>
