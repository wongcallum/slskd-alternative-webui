import { PersonIcon } from '@radix-ui/react-icons'
import { TextField } from '@radix-ui/themes'
import { useNavigate } from '@tanstack/react-router'
import { type CSSProperties, type SubmitEvent, useState } from 'react'

// Opening a conversation sends nothing: it starts with the first message written in it.
export function MessageUserField({ style }: { style?: CSSProperties }) {
  const navigate = useNavigate()
  const [text, setText] = useState('')

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const username = text.trim()
    if (username === '') return
    setText('')
    void navigate({ to: '/chat', search: { user: username } })
  }

  return (
    <form onSubmit={submit} style={style}>
      <TextField.Root
        size="2"
        placeholder="Message user"
        aria-label="Message user"
        value={text}
        onChange={(event) => setText(event.target.value)}
      >
        <TextField.Slot>
          <PersonIcon />
        </TextField.Slot>
      </TextField.Root>
    </form>
  )
}
