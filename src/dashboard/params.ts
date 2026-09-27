import * as v from 'valibot'

import { oneOf } from '../lib/params'

const ranges = ['24h', '7d', '30d', '1y', 'all'] as const

export type Range = (typeof ranges)[number]

const measures = ['size', 'files', 'failed'] as const

export type Measure = (typeof measures)[number]

export const userSorts = ['files', 'size', 'speed'] as const

export type UserSort = (typeof userSorts)[number]

export const dashboardSearch = v.object({
  range: oneOf(ranges, '30d'),
  chart: oneOf(measures, 'size'),
  users: oneOf(userSorts, 'files'),
  errors: oneOf(['download', 'upload'], 'download'),
})

export const dashboardSearchDefaults = { range: '30d', chart: 'size', users: 'files', errors: 'download' } as const

export type DashboardSearch = v.InferOutput<typeof dashboardSearch>
