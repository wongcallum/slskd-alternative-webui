import * as v from 'valibot'

import { treeSearch, treeSearchDefaults } from '../../ui/tree/columns'

export const filesSearch = v.object(treeSearch(['modified']))

export const filesSearchDefaults = treeSearchDefaults

export type FilesSearch = v.InferOutput<typeof filesSearch>
