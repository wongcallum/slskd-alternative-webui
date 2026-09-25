import * as v from 'valibot'

import { textParam } from '../lib/params'
import { audioColumnIds, treeSearch, treeSearchDefaults } from '../ui/tree/columns'

export const browseSearch = v.object({ user: textParam, ...treeSearch(audioColumnIds) })

export const browseSearchDefaults = { user: '', ...treeSearchDefaults } as const

export type BrowseSearch = v.InferOutput<typeof browseSearch>
