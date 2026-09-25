import * as v from 'valibot'
import { decimalParam, integerParam, oneOf, sortOf, textParam } from '../../lib/params'
import { losslessQuality } from '../../lib/quality'
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

const filterSearch = v.pick(resultsSearch, filterKeys)

export type FilterSearch = v.InferOutput<typeof filterSearch>

export const noFilters: FilterSearch = { quality: 'any', size: '', length: '', files: '', free: 'all' }

export const resultsSearchDefaults = { q: '', locked: 'hide', ...noFilters } as const

const filtersKey = 'slskd-alt-result-filters'

export const countFilters = (search: FilterSearch) => filterKeys.filter((key) => search[key] !== noFilters[key]).length

export function saveFilters(search: FilterSearch) {
  if (countFilters(search) === 0) localStorage.removeItem(filtersKey)
  else localStorage.setItem(filtersKey, JSON.stringify(search, [...filterKeys]))
}

// A results page opened without any filters gets the last ones used, so a quality preference carries over.
export function rememberedFilters(search: FilterSearch) {
  const saved = countFilters(search) === 0 ? localStorage.getItem(filtersKey) : null
  if (saved === null) return undefined
  try {
    const filters = v.parse(filterSearch, JSON.parse(saved))
    return countFilters(filters) > 0 ? filters : undefined
  } catch {
    return undefined
  }
}
