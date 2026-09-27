import * as v from 'valibot'

import { criteriaSearch, noCriteria } from '../../lib/criteria'
import { integerParam, oneOf, sortOf, textParam } from '../../lib/params'
import { columnIds } from './table'

export const resultsSearch = v.object({
  q: textParam,
  sort: sortOf(columnIds),
  locked: oneOf(['hide', 'show'], 'hide'),
  free: oneOf(['all', 'only'], 'all'),
  ...criteriaSearch.entries,
  files: integerParam,
  hide: textParam,
})

export type ResultsSearch = v.InferOutput<typeof resultsSearch>

const filterKeys = ['quality', 'lossy', 'size', 'length', 'files', 'free'] as const

export type FilterSearch = Pick<ResultsSearch, (typeof filterKeys)[number]>

export const noFilters: FilterSearch = { ...noCriteria, files: '', free: 'all' }

export const resultsSearchDefaults = { q: '', locked: 'hide', hide: '', ...noFilters } as const

// Usernames can't hold a line break.
export const hiddenUsers = (hide: string): ReadonlySet<string> => new Set(hide === '' ? [] : hide.split('\n'))

export const countFilters = (search: FilterSearch) => filterKeys.filter((key) => search[key] !== noFilters[key]).length
