import * as v from 'valibot'

import { oneOf, textParam } from '../lib/params'
import { minimumLevels } from './logs'

export const logsSearch = v.object({ q: textParam, level: oneOf(minimumLevels, 'debug') })

export const logsSearchDefaults = { q: '', level: 'debug' } as const

export type LogsSearch = v.InferOutput<typeof logsSearch>

export const eventsSearch = v.object({ q: textParam, hide: textParam })

export const eventsSearchDefaults = { q: '', hide: '' } as const

export type EventsSearch = v.InferOutput<typeof eventsSearch>
