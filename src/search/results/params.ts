import * as v from 'valibot'

import { losslessQuality } from '../../lib/files'
import { decimalParam, integerParam, oneOf, sortOf, textParam } from '../../lib/params'
import { columnIds } from './table'

export const qualities = [
  ['any', 'Any', 0],
  ['128', '128 kbps', 128],
  ['192', '192 kbps', 192],
  ['256', '256 kbps', 256],
  ['320', '320 kbps', 320],
  ['lossless', 'Lossless', losslessQuality(0)],
  ['24bit', '24-bit lossless', losslessQuality(24)],
] as const

export const resultsSearch = v.object({
  q: textParam,
  sort: sortOf(columnIds),
  locked: oneOf(['hide', 'show'], 'hide'),
  free: oneOf(['all', 'only'], 'all'),
  quality: oneOf(
    qualities.map(([value]) => value),
    'any',
  ),
  size: decimalParam,
  length: decimalParam,
  files: integerParam,
})

export type ResultsSearch = v.InferOutput<typeof resultsSearch>

const filterKeys = ['quality', 'size', 'length', 'files', 'free'] as const

export type FilterSearch = Pick<ResultsSearch, (typeof filterKeys)[number]>

export const noFilters: FilterSearch = { quality: 'any', size: '', length: '', files: '', free: 'all' }

export const resultsSearchDefaults = { q: '', locked: 'hide', ...noFilters } as const

export const countFilters = (search: FilterSearch) => filterKeys.filter((key) => search[key] !== noFilters[key]).length
