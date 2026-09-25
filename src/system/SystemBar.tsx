import { Flex } from '@radix-ui/themes'
import type { ReactNode } from 'react'

import { toolbarStyle } from '../ui/controls'
import { NavTab, NavTabs } from '../ui/nav'

export function SystemBar({ children }: { children?: ReactNode }) {
  return (
    <Flex align="center" gap="3" px="4" flexShrink="0" style={toolbarStyle}>
      <NavTabs>
        <NavTab to="/system/info">Info</NavTab>
      </NavTabs>
      <Flex ml="auto" align="center" gap="4" flexShrink="0">
        {children}
      </Flex>
    </Flex>
  )
}
