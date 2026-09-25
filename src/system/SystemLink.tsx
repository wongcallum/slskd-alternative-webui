import { GearIcon } from '@radix-ui/react-icons'
import { Box, IconButton, Tooltip } from '@radix-ui/themes'
import { Link, useMatchRoute } from '@tanstack/react-router'

import { useResource } from '../lib/store'
import { StatusDot } from '../ui/status'
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
        {/* TODO: send a pending rescan alone to /system/shares once it exists (README roadmap: System shares) */}
        <Link to="/system/info" aria-label="System">
          <GearIcon width={18} height={18} />
          {pending.length > 0 && (
            <Box position="absolute" top="0" right="0" style={{ lineHeight: 0 }}>
              <StatusDot color="amber" />
            </Box>
          )}
        </Link>
      </IconButton>
    </Tooltip>
  )
}
