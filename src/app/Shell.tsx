import { Box, Button, Flex, Text } from '@radix-ui/themes'
import { Outlet } from '@tanstack/react-router'

import { logout, useSession } from '../session/session'
import { SoulseekIndicator } from '../soulseek/SoulseekIndicator'
import { SystemLink } from '../system/SystemLink'
import { UpdateNotice } from '../system/UpdateNotice'
import { DownloadsBadge } from '../transfers/DownloadsBadge'
import { toolbarStyle } from '../ui/controls'
import { NavTab, NavTabs } from '../ui/nav'

export function Shell() {
  const session = useSession()
  return (
    <Flex direction="column" height="100vh">
      <Flex asChild align="center" gap="5" px="4" flexShrink="0" overflowX="auto" style={toolbarStyle}>
        <header>
          <Text weight="bold">slskd</Text>
          <NavTabs>
            <NavTab to="/searches">Search</NavTab>
            <NavTab to="/downloads">
              Downloads
              <DownloadsBadge />
            </NavTab>
            <NavTab to="/uploads">Uploads</NavTab>
            <NavTab to="/browse">Browse</NavTab>
          </NavTabs>
          <Flex align="center" gap="4" ml="auto" flexShrink="0">
            <SoulseekIndicator />
            <UpdateNotice />
            <SystemLink />
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
