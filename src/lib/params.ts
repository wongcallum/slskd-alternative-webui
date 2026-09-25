import { functionalUpdate, type SortingState, type Updater } from '@tanstack/react-table'
import { useMemo } from 'react'
import * as v from 'valibot'

export const textParam = v.optional(v.fallback(v.string(), ''), '')

const positive = (value: string) => Number(value) > 0

// A trailing dot passes, so typing "3.5" doesn't turn the filter off at "3.".
export const positiveDecimal = v.pipe(v.string(), v.regex(/^\d*\.?\d*$/), v.check(positive))

export const positiveInteger = v.pipe(v.string(), v.digits(), v.check(positive))

export const decimalParam = v.optional(v.fallback(positiveDecimal, ''), '')

export const integerParam = v.optional(v.fallback(positiveInteger, ''), '')

export const oneOf = <const T extends string>(options: readonly T[], fallback: NoInfer<T>) =>
  v.optional(v.fallback(v.picklist(options), fallback), fallback)

const sortValues = <const T extends string>(ids: readonly T[]) =>
  ids.flatMap((id) => [`${id}.asc`, `${id}.desc`] as const)

export const sortOf = <const T extends string>(ids: readonly T[]) =>
  v.fallback(v.optional(v.picklist(sortValues(ids))), undefined)

const parseSort = (value: string | undefined): SortingState => {
  if (value === undefined) return []
  const [id = '', direction] = value.split('.')
  return [{ id, desc: direction === 'desc' }]
}

const formatSort = ([sort]: SortingState) => sort && `${sort.id}.${sort.desc ? 'desc' : 'asc'}`

// A table's sorting lives in the URL as a value like "size.desc".
export function useSortParam<S extends string>(sort: S | undefined, onChange: (sort: S | undefined) => void) {
  const sorting = useMemo(() => parseSort(sort), [sort])
  const onSortingChange = (updater: Updater<SortingState>) =>
    onChange(formatSort(functionalUpdate(updater, sorting)) as S | undefined)
  return { sorting, onSortingChange }
}
