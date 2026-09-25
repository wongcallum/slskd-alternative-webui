import * as v from 'valibot'

import { textParam } from '../lib/params'

export const roomsSearch = v.object({ room: textParam })

export const roomsSearchDefaults = { room: '' } as const
