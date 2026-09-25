import * as v from 'valibot'

import { textParam } from '../lib/params'

export const roomsSearch = v.object({ room: textParam })

export const roomsSearchDefaults = { room: '' } as const

export const chatSearch = v.object({ user: textParam })

export const chatSearchDefaults = { user: '' } as const
