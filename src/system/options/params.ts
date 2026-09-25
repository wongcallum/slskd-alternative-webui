import * as v from 'valibot'

import { oneOf } from '../../lib/params'

export const optionViews = ['effective', 'file', 'sources'] as const

export type OptionView = (typeof optionViews)[number]

export const optionsSearch = v.object({ view: oneOf(optionViews, 'effective') })

export const optionsSearchDefaults = { view: 'effective' } as const

export type OptionsSearch = v.InferOutput<typeof optionsSearch>
