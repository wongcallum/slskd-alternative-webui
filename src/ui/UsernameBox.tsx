import { PersonIcon } from '@radix-ui/react-icons'
import { Button, Flex, TextField } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type SubmitEvent, useState } from 'react'

// Asking for the user already open acts on them without navigating, which would reset the rest of the URL.
export function UsernameBox({
  current,
  action,
  to,
  onAsk,
}: {
  current?: string
  action: string
  to: '/browse' | '/users'
  onAsk: (username: string) => void
}) {
  const navigate = useNavigate()
  const [text, setText] = useState(current ?? '')

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const username = text.trim()
    if (username === '') return
    onAsk(username)
    if (username !== current) void navigate({ to, search: { user: username } })
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
          {action}
        </Button>
      </Flex>
    </form>
  )
}
