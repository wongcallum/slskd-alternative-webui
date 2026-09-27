import * as v from 'valibot'

import { criteriaSearch, noCriteria } from '../lib/criteria'
import { textParam } from '../lib/params'
import { audioColumnIds, treeSearch, treeSearchDefaults } from '../ui/tree/columns'

export const browseSearch = v.object({ user: textParam, ...treeSearch(audioColumnIds), ...criteriaSearch.entries })

export const browseSearchDefaults = { user: '', ...treeSearchDefaults, ...noCriteria } as const

export type BrowseSearch = v.InferOutput<typeof browseSearch>
