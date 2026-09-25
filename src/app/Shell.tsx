import { Box, Button, Flex, TabNav, Text } from '@radix-ui/themes'
import { Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import type { CSSProperties, ReactNode } from 'react'

import { logout, useSession } from '../session/session'
import { SoulseekIndicator } from '../soulseek/SoulseekIndicator'
import { DownloadsBadge } from '../transfers/DownloadsBadge'
import { toolbarStyle } from '../ui/controls'

export function Shell() {
  const session = useSession()
  return (
    <Flex direction="column" height="100vh">
      <Flex asChild align="center" gap="5" px="4" flexShrink="0" overflowX="auto" style={toolbarStyle}>
        <header>
          <Text weight="bold">slskd</Text>
          {/* TabNav draws its own divider in --gray-a5 under the tabs, which would double up with the header's. */}
          <TabNav.Root style={{ '--gray-a5': 'transparent' } as CSSProperties}>
            <NavTab to="/searches">Search</NavTab>
            <NavTab to="/downloads">
              Downloads
              <DownloadsBadge />
            </NavTab>
            <NavTab to="/uploads">Uploads</NavTab>
            <NavTab to="/browse">Browse</NavTab>
          </TabNav.Root>
          <Flex align="center" gap="4" ml="auto" flexShrink="0">
            <SoulseekIndicator />
            {session.status === 'authenticated' && (
              <Button variant="ghost" color="gray" onClick={logout}>
                Log out
              </Button>
            )}
          </Flex>
        </header>
      </Flex>
      <Box flexGrow="1" minHeight="0" overflow="auto">
        <Outlet />
      </Box>
    </Flex>
  )
}

function NavTab({ to, children }: { to: '/searches' | '/downloads' | '/uploads' | '/browse'; children: ReactNode }) {
  const matchRoute = useMatchRoute()
  return (
    <TabNav.Link asChild active={Boolean(matchRoute({ to, fuzzy: true }))}>
      <Link to={to}>{children}</Link>
    </TabNav.Link>
  )
}
