import { Flex } from '@radix-ui/themes'
import type { ReactNode } from 'react'

import type { Resource } from '../lib/store'
import { toolbarStyle } from '../ui/controls'
import { NavTab, NavTabs } from '../ui/nav'
import { Freshness } from '../ui/status'

type Props = {
  resource: Resource<unknown>
  interval: number
  loaded: boolean
  error: unknown
  live: boolean
  children: ReactNode
}

export function SystemPage({ resource, interval, loaded, error, live, children }: Props) {
  return (
    <Flex direction="column" height="100%">
      <Flex align="center" gap="3" px="4" flexShrink="0" style={toolbarStyle}>
        <NavTabs>
          <NavTab to="/system/info">Info</NavTab>
          <NavTab to="/system/logs">Logs</NavTab>
        </NavTabs>
        <Flex ml="auto" align="center" gap="4" flexShrink="0">
          <Freshness resource={resource} interval={interval} error={loaded ? error : undefined} live={live} />
        </Flex>
      </Flex>
      {children}
    </Flex>
  )
}
