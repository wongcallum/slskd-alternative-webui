import { Text } from '@radix-ui/themes'

import { plural } from '../lib/format'
import { type Color, Tip } from '../ui/controls'
import type { Search, SearchState as State } from './searches'

const stateLabels: Record<State, [string, Color, string?]> = {
  Requested: ['Requested', 'gray'],
  Queued: ['Queued', 'gray', 'Waiting for a slot: slskd runs 2 searches at once'],
  InProgress: ['Searching', 'blue'],
  'Completed, TimedOut': ['Finished', 'green', 'Ended once responses stopped arriving'],
  'Completed, ResponseLimitReached': ['Response limit', 'green', 'Ended at the response limit'],
  'Completed, FileLimitReached': ['File limit', 'green', 'Ended at the file limit'],
  'Completed, Cancelled': ['Stopped', 'gray'],
  'Completed, Errored': ['Errored', 'red', "slskd couldn't finish it, for example because Soulseek disconnected"],
}

export function SearchState({ search, size = '2' }: { search: Search; size?: '1' | '2' }) {
  const [label, color, hint] = stateLabels[search.state] ?? [search.state, 'gray']
  const text = (
    <Text size={size} color={color}>
      {label}
    </Text>
  )
  return hint === undefined ? text : <Tip content={hint}>{text}</Tip>
}

export function describeCounts(search: Search) {
  let counts = `${plural(search.responses, 'response')}, ${plural(search.files, 'file')}`
  if (search.locked > 0) counts += `, ${search.locked.toLocaleString()} locked`
  return counts
}
