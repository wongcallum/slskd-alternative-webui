import { Dialog, Flex, Kbd, Table, Text } from '@radix-ui/themes'
import {
  type Hotkey,
  type HotkeyRegistrationView,
  useHotkey,
  useHotkeyRegistrations,
  useHotkeySequences,
} from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { Fragment } from 'react'

import { createAtom, useAtom } from '../lib/store'
import { useIsAgent } from '../system/application'
import { useReturnFocus } from '../ui/controls'
import { displayKey, inOverlay } from '../ui/keys'
import type { To } from '../ui/nav'

export const keysOpen = createAtom(false)

const pages: readonly (readonly [Hotkey, To, string])[] = [
  ['H', '/dashboard', 'Dashboard'],
  ['S', '/searches', 'Search'],
  ['D', '/downloads', 'Downloads'],
  ['U', '/uploads', 'Uploads'],
  ['B', '/browse', 'Browse'],
  ['P', '/users', 'Users'],
  ['C', '/chat', 'Chat'],
  [',', '/system', 'System'],
]

// The page's main field is marked by the page, such as a filter or the message box.
function focusMainField() {
  const field = [...document.querySelectorAll<HTMLElement>('main [data-main-field]')].find(
    (each) => each.offsetParent !== null,
  )
  field?.focus()
  if (field instanceof HTMLInputElement) field.select()
}

// Keys that work anywhere but in a text field, an open menu or a dialog.
export function useAppKeys() {
  const navigate = useNavigate()
  const agent = useIsAgent()
  useHotkey(
    '/',
    (event) => {
      if (!inOverlay(event)) focusMainField()
    },
    { meta: { name: "Go to the page's filter or main field", group: 'app' } },
  )
  useHotkey(
    '?',
    (event) => {
      if (!inOverlay(event) || keysOpen.get()) keysOpen.set((open) => !open)
    },
    { meta: { name: 'Show these keys', group: 'app' } },
  )
  useHotkeySequences(
    // The list keeps every page so a sequence keeps its place in it: the hook re-registers one that moves, which
    // drops a pending g.
    pages.map(([key, to, label]) => ({
      sequence: ['G', key],
      callback: (event) => {
        if (!inOverlay(event)) void navigate({ to })
      },
      options: { enabled: agent === false || to === '/system', meta: { name: `Go to ${label}`, group: 'app' } },
    })),
  )
}

const listKeys: readonly (readonly [Hotkey[], string])[] = [
  [['ArrowUp', 'ArrowDown'], 'Move between rows'],
  [['Home', 'End'], 'Go to the first or last row'],
  [['PageUp', 'PageDown'], 'Move a screenful'],
  [['ArrowRight', 'ArrowLeft'], 'Open or close a folder, or move between it and what it holds'],
  [['Enter'], 'Open the row, or do what a click on it does'],
  [['Space'], 'Select or deselect the row'],
  [['Shift+Space'], 'Select the rows from the last one selected'],
  [['Shift+ArrowUp', 'Shift+ArrowDown'], 'Select rows while moving'],
  [['Mod+A'], 'Select every row'],
  [['Escape'], 'Close the details, or clear the selection'],
  [['Tab'], "Go through the row's buttons, then leave the list"],
]

const treeKeys: readonly (readonly [Hotkey[], string])[] = [
  [['Enter'], 'Open the folder, or go into the one that is open'],
]

const headerKeys: readonly (readonly [Hotkey[], string])[] = [
  [['Shift+ArrowLeft', 'Shift+ArrowRight'], 'Narrow or widen the column'],
]

const fieldKeys: readonly (readonly [Hotkey[], string])[] = [
  [['ArrowDown', 'Escape'], 'Go from a filter back to its list'],
]

function Keys({ keys }: { keys: readonly string[][] }) {
  return keys.map((steps, index) => (
    <Fragment key={steps.join(' ')}>
      {index > 0 && (
        <Text size="1" color="gray">
          {' or '}
        </Text>
      )}
      {steps.map((step, at) => (
        <Fragment key={step}>
          {at > 0 && ' '}
          <Kbd size="2">{displayKey(step as Hotkey)}</Kbd>
        </Fragment>
      ))}
    </Fragment>
  ))
}

type Row = { name: string; keys: string[][] }

function Section({ title, rows }: { title: string; rows: readonly Row[] }) {
  if (rows.length === 0) return null
  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="bold">
        {title}
      </Text>
      <Table.Root size="1">
        <Table.Body>
          {rows.map(({ name, keys }) => (
            <Table.Row key={name}>
              <Table.Cell width="45%">
                <Keys keys={keys} />
              </Table.Cell>
              <Table.Cell>{name}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Flex>
  )
}

// Registrations for the same action, such as ⌫ and Alt+↑ to go up, share a row.
function rowsOf(registrations: readonly { name?: string; keys: string[] }[]) {
  const rows = new Map<string, Row>()
  for (const { name, keys } of registrations) {
    if (name === undefined) continue
    const row = rows.get(name) ?? { name, keys: [] }
    if (!row.keys.some((each) => each.join(' ') === keys.join(' '))) row.keys.push(keys)
    rows.set(name, row)
  }
  return [...rows.values()]
}

const view = (registration: HotkeyRegistrationView) => ({
  name: registration.options.meta?.name,
  keys: [registration.hotkey],
})

const inGroup = (group: string) => (registration: Pick<HotkeyRegistrationView, 'options'>) =>
  registration.options.meta?.group === group

function Contents() {
  const { hotkeys, sequences } = useHotkeyRegistrations()
  const anywhere = rowsOf([
    ...hotkeys.filter(inGroup('app')).map(view),
    ...sequences
      .filter((each) => inGroup('app')(each) && each.options.enabled !== false)
      .map((each) => ({ name: each.options.meta?.name, keys: each.sequence })),
  ])
  const page = rowsOf([...hotkeys.filter(inGroup('page')).map(view), ...hotkeys.filter(inGroup('list')).map(view)])
  const fixed = (keys: typeof listKeys) => keys.map(([each, name]) => ({ name, keys: each.map((key) => [key]) }))
  const tree = hotkeys.some(({ target }) => target instanceof Element && target.getAttribute('role') === 'tree')
  return (
    <Flex direction="column" gap="4">
      <Section title="Anywhere" rows={anywhere} />
      <Section title="On this page" rows={page} />
      <Section title="In a list" rows={fixed(listKeys)} />
      {tree && <Section title="In the folders" rows={fixed(treeKeys)} />}
      <Section title="On a column's header" rows={fixed(headerKeys)} />
      <Section title="In a filter" rows={fixed(fieldKeys)} />
    </Flex>
  )
}

export function KeysDialog() {
  const open = useAtom(keysOpen)
  return (
    <Dialog.Root open={open} onOpenChange={keysOpen.set}>
      <Dialog.Content maxWidth="560px" {...useReturnFocus()}>
        <Dialog.Title>Keyboard shortcuts</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Letter and symbol keys are ignored while typing in a field.
        </Dialog.Description>
        {open && <Contents />}
      </Dialog.Content>
    </Dialog.Root>
  )
}
