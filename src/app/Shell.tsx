import { Box, Flex, Text } from '@radix-ui/themes'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { Outlet, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useUnreadInTitle } from '../chat/ChatBadge'
import { useFrom } from '../lib/media'
import { SoulseekIndicator } from '../soulseek/SoulseekIndicator'
import { SystemLink } from '../system/SystemLink'
import { UpdateNotice } from '../system/UpdateNotice'
import { TransferSpeeds } from '../transfers/TransferSpeeds'
import { toolbarStyle } from '../ui/controls'
import { cancelPendingFocus, recoverFocus } from '../ui/focus'
import { NavTab, NavTabs } from '../ui/nav'
import { AppMenu } from './AppMenu'
import { KeysDialog, useAppKeys } from './keys'
import { sections, useSectionLabel } from './sections'

// Keys act and nothing else: other keys and the browser still see them.
const hotkeyDefaults = { hotkey: { stopPropagation: false }, hotkeySequence: { stopPropagation: false } }

// A navigation that takes the focused element away gives focus to the new page, unless the user acts first.
function useFocusRecovery() {
  const router = useRouter()
  useEffect(() => {
    recoverFocus()
    const unsubscribe = router.subscribe('onRendered', recoverFocus)
    document.addEventListener('pointerdown', cancelPendingFocus, true)
    document.addEventListener('keydown', cancelPendingFocus, true)
    return () => {
      unsubscribe()
      document.removeEventListener('pointerdown', cancelPendingFocus, true)
      document.removeEventListener('keydown', cancelPendingFocus, true)
    }
  }, [router])
}

function Keys() {
  useAppKeys()
  useFocusRecovery()
  return <KeysDialog />
}

// The speeds come first after the free space, so a speed that gets wider grows into it and nothing else moves.
export function Shell() {
  useUnreadInTitle()
  const sm = useFrom('sm')
  const md = useFrom('md')
  const lg = useFrom('lg')
  const section = useSectionLabel()
  return (
    <HotkeysProvider defaultOptions={hotkeyDefaults}>
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
        <Box asChild flexGrow="1" minHeight="0" overflow="auto">
          <main>
            <Outlet />
          </main>
        </Box>
        <Keys />
      </Flex>
    </HotkeysProvider>
  )
}
