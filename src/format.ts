import { filesize, partial } from 'filesize'
import { useClock } from './store'

const options = { base: 2, standard: 'iec', round: 1 } as const

export const formatBytes = partial(options)

export const formatSpeed = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/s`

const exponentOf = partial({ ...options, output: 'exponent' })

export function formatProgress(transferred: number, total: number) {
  const exponent = exponentOf(total)
  const [value] = filesize(transferred, { ...options, exponent, output: 'array' })
  return `${value} / ${formatBytes(total)}`
}

// requestedAt and enqueuedAt are UTC but slskd serialises them without the Z.
export const toTime = (timestamp: string) => Date.parse(timestamp.endsWith('Z') ? timestamp : `${timestamp}Z`)

const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

export const formatTime = (time: number) => absolute.format(time)

export function formatAge(age: number) {
  const seconds = Math.max(0, Math.floor(age / 1000))
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`
  return `${Math.floor(seconds / 86_400)} d`
}

export const useAgo = (time: number) => useClock((now) => `${formatAge(now - time)} ago`)
