import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import { DropdownMenu, IconButton } from '@radix-ui/themes'

import { useAtom, useResource } from '../lib/store'
import { logout, useSession } from '../session/session'
import { application } from '../system/application'
import { themeChoice } from './theme'

const themes = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
] as const

// Picking a theme keeps the menu open, so the others can be compared.
const keepOpen = (event: Event) => event.preventDefault()

export function AppMenu() {
  const session = useSession()
  const { data } = useResource(application)
  const choice = useAtom(themeChoice)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton variant="ghost" color="gray" aria-label="Menu">
          <HamburgerMenuIcon width={18} height={18} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {data !== undefined && (
          <>
            <DropdownMenu.Label>
              slskd {data.version}
              {data.build !== undefined && ` · ${data.build} build`}
            </DropdownMenu.Label>
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
