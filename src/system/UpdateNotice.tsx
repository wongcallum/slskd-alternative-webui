import { Link, Tooltip } from '@radix-ui/themes'

import { application, releaseNotes } from '../lib/application'
import { useResource } from '../lib/store'

export function UpdateNotice() {
  const { data } = useResource(application)
  if (!data?.updateAvailable || data.latest === undefined) return null
  return (
    <Tooltip content={`Running ${data.version}`}>
      <Link href={releaseNotes(data.latest)} target="_blank" rel="noreferrer" size="2" color="amber">
        {data.latest} available
      </Link>
    </Tooltip>
  )
}
