import { Box, Heading, Link, Text } from '@radix-ui/themes'
import { Navigate, Outlet, Link as RouterLink } from '@tanstack/react-router'

import { useResource } from '../lib/store'
import { useIsActive } from '../ui/nav'
import { application } from './application'

// An agent has nothing but System to show, so the landing page is System's.
export function AgentPage() {
  const isActive = useIsActive()
  const controller = useResource(application).data?.controllerAddress
  if (isActive('/system')) return <Outlet />
  if (isActive('/dashboard')) return <Navigate to="/system/info" replace />
  return (
    <Box p="5">
      <Heading mb="2">This slskd is a relay agent</Heading>
      <Text as="p" color="gray" mb="3">
        Searching, transfers and chat happen on its controller{controller === undefined ? '' : `, ${controller}`}.
      </Text>
      <Link asChild>
        <RouterLink to="/system/info">Go to System</RouterLink>
      </Link>
    </Box>
  )
}
