import { useDeferredValue, useMemo } from 'react'
import * as v from 'valibot'

import { lossless, losslessQuality } from './files'
import { decimalParam, oneOf } from './params'

export const qualities = [
  ['any', 'Any', 0],
  ['128', '128 kbps', 128],
  ['192', '192 kbps', 192],
  ['256', '256 kbps', 256],
  ['320', '320 kbps', 320],
  ['lossless', 'Lossless', lossless],
  ['24bit', '24-bit lossless', losslessQuality(24)],
] as const

export const criteriaSearch = v.object({
  quality: oneOf(
    qualities.map(([value]) => value),
    'any',
  ),
  lossy: oneOf(['all', 'only'], 'all'),
  size: decimalParam,
  length: decimalParam,
})

export type CriteriaSearch = v.InferOutput<typeof criteriaSearch>

export const noCriteria: CriteriaSearch = { quality: 'any', lossy: 'all', size: '', length: '' }

export const countCriteria = (search: CriteriaSearch) =>
  (['quality', 'lossy', 'size', 'length'] as const).filter((key) => search[key] !== noCriteria[key]).length

// Quality is a floor on the quality ranking, size is in bytes and length in seconds. Zero turns a criterion off.
export type Criteria = { quality: number; lossy: boolean; size: number; length: number }

export const unjudged: Criteria = { quality: 0, lossy: false, size: 0, length: 0 }

export function useCriteria(search: CriteriaSearch): Criteria {
  const quality = useDeferredValue(qualities.find(([value]) => value === search.quality)?.[2] ?? 0)
  const size = useDeferredValue(Number(search.size) * 2 ** 20)
  const lossy = useDeferredValue(search.lossy === 'only')
  const length = useDeferredValue(Number(search.length) * 60)
  return useMemo(() => ({ quality, lossy, size, length }), [quality, lossy, size, length])
}

type Judged = { quality: number; size: number; length?: number }

export const hasAttributes = (file: Judged) => file.quality >= 0 || file.length !== undefined

export const isJudging = (criteria: Criteria) =>
  criteria.quality > 0 || criteria.lossy || criteria.size > 0 || criteria.length > 0

// Criteria judge files with attributes. Files without them, such as cover art, pass here, and ride along while their
// folder still shows a file that has them.
export const passes = (criteria: Criteria, file: Judged) =>
  !hasAttributes(file) ||
  ((criteria.quality === 0 || file.quality >= criteria.quality) &&
    (!criteria.lossy || file.quality < lossless) &&
    file.size >= criteria.size &&
    (file.length ?? 0) >= criteria.length)
