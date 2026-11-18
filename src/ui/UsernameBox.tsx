import { PersonIcon } from '@radix-ui/react-icons'
import { Box, Button, Flex, TextField } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type SubmitEvent, useState } from 'react'

import { useTouch } from '../lib/media'
import { disabledProps, mainField, Tip, onKeyDownToList } from './controls'

// Asking for the user already open acts on them without navigating, which would reset the rest of the URL. When that
// would do nothing, currentGate says why.
export function UsernameBox({
  current,
  action,
  to,
  currentGate,
  onAsk,
}: {
  current?: string
  action: string
  to: '/browse' | '/users'
  currentGate?: string
  onAsk: (username: string) => void
}) {
  const navigate = useNavigate()
  const touch = useTouch()
  const [text, setText] = useState(current ?? '')
  const blocked = current !== undefined && text.trim() === current ? currentGate : undefined

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const username = text.trim()
    if (username === '' || (username === current && currentGate !== undefined)) return
    onAsk(username)
    if (username !== current) void navigate({ to, search: { user: username } })
  }

  return (
    <Box
      asChild
      flexGrow={{ initial: '1', sm: '0' }}
      flexBasis={{ initial: '0', sm: 'auto' }}
      minWidth={{ initial: '240px', sm: '0' }}
    >
      <form onSubmit={submit}>
        <Flex gap="2" align="center">
          <Box flexGrow={{ initial: '1', sm: '0' }} width={{ initial: 'auto', sm: '220px' }}>
            <TextField.Root
              size="2"
              placeholder="Username"
              autoFocus={current === undefined && !touch}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDownToList(current === undefined ? 'users' : undefined)}
              {...mainField(current === undefined)}
            >
              <TextField.Slot>
                <PersonIcon />
              </TextField.Slot>
            </TextField.Root>
          </Box>
          {blocked === undefined ? (
            <Button size="2" type="submit">
              {action}
            </Button>
          ) : (
            <Tip content={blocked}>
              <Button size="2" type="submit" {...disabledProps(true)}>
                {action}
              </Button>
            </Tip>
          )}
        </Flex>
      </form>
    </Box>
  )
}
