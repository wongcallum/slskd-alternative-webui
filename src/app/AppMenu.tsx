import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import { DropdownMenu, Flex, IconButton, Text } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'

import { useUnread } from '../chat/ChatBadge'
import { application, releaseNotes, useIsAgent } from '../lib/application'
import { plural } from '../lib/format'
import { useTouch } from '../lib/media'
import { logout, useSession } from '../lib/session'
import { useAtom, useResource } from '../lib/store'
import { themeChoice } from '../lib/theme'
import { SpeedValue } from '../transfers/TransferSpeeds'
import { useIsActive } from '../ui/nav'
import { CornerDot } from '../ui/status'
import { keysOpen } from './keys'
import { sections } from './sections'

const themes = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
] as const

// Picking a theme keeps the menu open, so the others can be compared.
const keepOpen = (event: Event) => event.preventDefault()

type Props = { pages: boolean; speeds: boolean; update: boolean }

export function AppMenu({ pages, speeds, update }: Props) {
  const session = useSession()
  const { data } = useResource(application)
  const agent = useIsAgent()
  const unread = useUnread(agent === false)
  const choice = useAtom(themeChoice)
  const isActive = useIsActive()
  const navigate = useNavigate()
  const touch = useTouch()
  const latest = update && data?.updateAvailable ? data.latest : undefined
  const dot = pages && unread > 0 ? 'red' : latest === undefined ? undefined : 'amber'
  let shown = pages ? sections : speeds ? sections.filter((section) => section.direction !== undefined) : []
  if (agent !== false) shown = []
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton
          variant="ghost"
          color="gray"
          aria-label={[
            'Menu',
            pages && unread > 0 && plural(unread, 'unread message'),
            latest !== undefined && 'update available',
          ]
            .filter(Boolean)
            .join(', ')}
          style={{ position: 'relative' }}
        >
          <HamburgerMenuIcon width={18} height={18} />
          {dot !== undefined && <CornerDot color={dot} />}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {shown.length > 0 && (
          <>
            <DropdownMenu.RadioGroup
              value={shown.find(({ to, also }) => isActive(to, also))?.to ?? ''}
              onValueChange={(to) => void navigate({ to })}
            >
              {shown.map(({ to, label, badge, direction }) => (
                <DropdownMenu.RadioItem key={to} value={to}>
                  {label}
                  {pages && badge}
                  {direction !== undefined && (
                    <Flex ml="auto" pl="5">
                      <SpeedValue direction={direction} />
                    </Flex>
                  )}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator />
          </>
        )}
        {data !== undefined && (
          <>
            <DropdownMenu.Label>
              slskd {data.version}
              {data.build !== undefined && ` (${data.build} build)`}
            </DropdownMenu.Label>
            {latest !== undefined && (
              <DropdownMenu.Item asChild>
                <a href={releaseNotes(latest)} target="_blank" rel="noreferrer">
                  <Text color="amber">{latest} available</Text>
                </a>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator />
          </>
        )}
        <DropdownMenu.Label>Theme</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={choice ?? 'system'}
          onValueChange={(value) => themeChoice.set(value === 'light' || value === 'dark' ? value : undefined)}
        >
          {themes.map(([value, label]) => (
            <DropdownMenu.RadioItem key={value} value={value} onSelect={keepOpen}>
              {label}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
        {!touch && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item shortcut="?" onSelect={() => keysOpen.set(true)}>
              Keyboard shortcuts
            </DropdownMenu.Item>
          </>
        )}
        {session.status === 'authenticated' && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={logout}>Log out</DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
