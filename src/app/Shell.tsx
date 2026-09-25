import { Box, Flex, Text } from '@radix-ui/themes'
import { Outlet } from '@tanstack/react-router'

import { useUnreadInTitle } from '../chat/ChatBadge'
import { useFrom } from '../lib/media'
import { SoulseekIndicator } from '../soulseek/SoulseekIndicator'
import { SystemLink } from '../system/SystemLink'
import { UpdateNotice } from '../system/UpdateNotice'
import { TransferSpeeds } from '../transfers/TransferSpeeds'
import { toolbarStyle } from '../ui/controls'
import { NavTab, NavTabs } from '../ui/nav'
import { AppMenu } from './AppMenu'
import { sections, useSectionLabel } from './sections'

// What the bar has no room for goes into the menu: the update notice below lg, the speeds below md, and the tabs below
// sm. The speeds come first after the free space, so a speed that gets wider grows into it and nothing else moves.
export function Shell() {
  useUnreadInTitle()
  const sm = useFrom('sm')
  const md = useFrom('md')
  const lg = useFrom('lg')
  const section = useSectionLabel()
  return (
    <Flex direction="column" height="100dvh">
      <Flex
        asChild
        align="center"
        gap="5"
        px="4"
        flexShrink="0"
        minHeight={{ initial: '48px', sm: '0' }}
        style={toolbarStyle}
      >
        <header>
          {(md || (!sm && section === undefined)) && <Text weight="bold">slskd</Text>}
          {sm ? (
            <NavTabs>
              {sections.map(({ to, also, label, badge }) => (
                <NavTab key={to} to={to} also={also}>
                  {label}
                  {badge}
                </NavTab>
              ))}
            </NavTabs>
          ) : (
            section !== undefined && <Text weight="bold">{section}</Text>
          )}
          <Flex align="center" gap="4" ml="auto" flexShrink="0">
            {md && <TransferSpeeds />}
            <SoulseekIndicator compact={!lg} />
            {lg && <UpdateNotice />}
            <SystemLink />
            <AppMenu pages={!sm} speeds={!md} update={!lg} />
          </Flex>
        </header>
      </Flex>
      <Box flexGrow="1" minHeight="0" overflow="auto">
        <Outlet />
      </Box>
    </Flex>
  )
}
