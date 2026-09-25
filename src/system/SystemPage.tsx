import { Flex } from '@radix-ui/themes'
import type { ReactNode } from 'react'

import { useResource } from '../lib/store'
import { toolbarStyle } from '../ui/controls'
import { NavTab, NavTabs } from '../ui/nav'
import { StatusDot } from '../ui/status'
import { application, rescanNeeded } from './application'

export function SystemPage({ status, children }: { status?: ReactNode; children: ReactNode }) {
  const { data } = useResource(application)
  return (
    <Flex direction="column" height="100%">
      <Flex
        direction={{ initial: 'column', sm: 'row' }}
        align={{ initial: 'stretch', sm: 'center' }}
        gap={{ initial: '0', sm: '3' }}
        px="4"
        flexShrink="0"
        style={toolbarStyle}
      >
        <NavTabs>
          <NavTab to="/system/info">Info</NavTab>
          <NavTab to="/system/options">Options</NavTab>
          <NavTab to="/system/shares">
            <Flex align="center" gap="2">
              Shares
              {data !== undefined && rescanNeeded(data) && <StatusDot color="amber" />}
            </Flex>
          </NavTab>
          <NavTab to="/system/files">Files</NavTab>
          <NavTab to="/system/events">Events</NavTab>
          <NavTab to="/system/logs">Logs</NavTab>
        </NavTabs>
        {status !== undefined && (
          <Flex ml="auto" align="center" gap="4" flexShrink="0" py={{ initial: '1', sm: '0' }}>
            {status}
          </Flex>
        )}
      </Flex>
      <Flex direction="column" flexGrow="1" minHeight="0" position="relative">
        {children}
      </Flex>
    </Flex>
  )
}
