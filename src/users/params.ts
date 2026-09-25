import * as v from 'valibot'

import { textParam } from '../lib/params'

export const usersSearch = v.object({ user: textParam })

export const usersSearchDefaults = { user: '' } as const
