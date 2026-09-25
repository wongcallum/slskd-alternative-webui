import type { SortingState } from '@tanstack/react-table'
import * as v from 'valibot'

export const textParam = v.optional(v.fallback(v.string(), ''), '')

export const oneOf = <const T extends string>(options: readonly T[], fallback: NoInfer<T>) =>
  v.optional(v.fallback(v.picklist(options), fallback), fallback)

const sortValues = <const T extends string>(ids: readonly T[]) =>
  ids.flatMap((id) => [`${id}.asc`, `${id}.desc`] as const)

export const sortOf = <const T extends string>(ids: readonly T[]) =>
  v.fallback(v.optional(v.picklist(sortValues(ids))), undefined)

export const parseSort = (value: string | undefined): SortingState => {
  if (value === undefined) return []
  const [id = '', direction] = value.split('.')
  return [{ id, desc: direction === 'desc' }]
}

export const formatSort = ([sort]: SortingState) => sort && `${sort.id}.${sort.desc ? 'desc' : 'asc'}`
