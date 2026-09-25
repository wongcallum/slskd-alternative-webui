import * as v from 'valibot'

import { audioColumnIds, treeSearch, treeSearchDefaults } from '../../ui/tree/columns'

export const sharesSearch = v.object(treeSearch(audioColumnIds))

export const sharesSearchDefaults = treeSearchDefaults

export type SharesSearch = v.InferOutput<typeof sharesSearch>
