import { GearIcon } from '@radix-ui/react-icons'
import { IconButton, Tooltip } from '@radix-ui/themes'
import { Link, useMatchRoute } from '@tanstack/react-router'

import { useResource } from '../lib/store'
import { CornerDot } from '../ui/status'
import { application, pendingItems } from './application'

export function SystemLink() {
  const { data } = useResource(application)
  const matchRoute = useMatchRoute()
  const pending = data === undefined ? [] : pendingItems(data)
  return (
    <Tooltip content={pending.length === 0 ? 'System' : `Pending: ${pending.join(', ')}`}>
      <IconButton
        asChild
        variant={matchRoute({ to: '/system', fuzzy: true }) ? 'soft' : 'ghost'}
        color="gray"
        style={{ position: 'relative' }}
      >
        <Link
          to={pending.length === 1 && pending[0] === 'rescan' ? '/system/shares' : '/system/info'}
          aria-label="System"
        >
          <GearIcon width={18} height={18} />
          {pending.length > 0 && <CornerDot color="amber" />}
        </Link>
      </IconButton>
    </Tooltip>
  )
}
