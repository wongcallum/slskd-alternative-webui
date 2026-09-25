import { PersonIcon } from '@radix-ui/react-icons'
import { Button, Flex, TextField } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type SubmitEvent, useState } from 'react'
import { useSoulseekGate } from '../soulseek/soulseek'
import { browseIfMissing } from './browse'

// Asking for a user is the gesture that browses them, unless their share is cached.
export function UserBox({ current }: { current?: string }) {
  const navigate = useNavigate()
  const gate = useSoulseekGate()
  const [text, setText] = useState(current ?? '')

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const username = text.trim()
    if (username === '') return
    if (gate === undefined) void browseIfMissing(username)
    if (username !== current) void navigate({ to: '/browse', search: { user: username } })
  }

  return (
    <form onSubmit={submit}>
      <Flex gap="2" align="center">
        <TextField.Root
          size="2"
          placeholder="Username"
          autoFocus={current === undefined}
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ width: 220 }}
        >
          <TextField.Slot>
            <PersonIcon />
          </TextField.Slot>
        </TextField.Root>
        <Button size="2" type="submit">
          Browse
        </Button>
      </Flex>
    </form>
  )
}
