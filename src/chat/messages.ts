import { createAtom, shallowEqual } from '../lib/store'
import { createStoredAtom } from '../lib/stored'

export type Message = {
  key: string
  time: number
  // Our own messages are named by the log, from our username as it is now.
  username: string
  text: string
  self: boolean
  mention: boolean
}

export type Target = { kind: 'room' | 'user'; name: string }

const isTarget = (stored: unknown): stored is Target =>
  typeof stored === 'object' &&
  stored !== null &&
  'kind' in stored &&
  (stored.kind === 'room' || stored.kind === 'user') &&
  'name' in stored &&
  typeof stored.name === 'string'

export const lastOpen = createStoredAtom<Target | undefined>(
  'slskd-alt-chat-open',
  (stored) => (isTarget(stored) ? stored : undefined),
  undefined,
)

export const targetKey = (target: Target) => `${target.kind} ${target.name}`

export const drafts = createAtom<ReadonlyMap<string, string>>(new Map())

// A mention is the username as a whole word, in any case.
export function mentionMatcher(username: string | undefined) {
  if (username === undefined || username === '') return () => false
  const escaped = username.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}_])${escaped}(?![\p{L}\p{N}_])`, 'iu')
  return (text: string) => pattern.test(text)
}

// Rows are memoised on their message, so a poll that changes nothing keeps every object, and the array too.
export function reuseMessages(previous: readonly Message[] | undefined, next: Message[]): readonly Message[] {
  if (previous === undefined) return next
  const byKey = new Map(previous.map((message) => [message.key, message]))
  let same = previous.length === next.length
  const merged = next.map((message, index) => {
    const old = byKey.get(message.key)
    const kept = old !== undefined && shallowEqual(old, message) ? old : message
    if (kept !== previous[index]) same = false
    return kept
  })
  return same ? previous : merged
}
