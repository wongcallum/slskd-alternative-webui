import { Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import { isHTTPError, isNetworkError, isTimeoutError } from 'ky'
import { type SubmitEvent, useRef, useState } from 'react'

import { describeError } from '../lib/api'
import { useTouch } from '../lib/media'
import { login } from './session'

export function Login({ ended }: { ended: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const password = useRef<HTMLInputElement>(null)
  const touch = useTouch()

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(undefined)
    try {
      await login(form.get('username') as string, form.get('password') as string)
    } catch (thrown) {
      if (isHTTPError(thrown) && thrown.response.status === 401) {
        setError('Wrong username or password')
        if (password.current) {
          password.current.value = ''
          password.current.focus()
        }
      } else if (isNetworkError(thrown) || isTimeoutError(thrown)) setError("Can't reach slskd")
      else setError(describeError(thrown))
      setPending(false)
    }
  }

  return (
    <Flex align="center" justify="center" minHeight="100dvh" p="4">
      <Card size="3" style={{ width: '100%', maxWidth: 360 }}>
        <form onSubmit={submit}>
          <Flex direction="column" gap="3">
            <Heading size="5">slskd</Heading>
            {ended && (
              <Callout.Root color="amber" size="1">
                <Callout.Text>Your session ended. Log in again.</Callout.Text>
              </Callout.Root>
            )}
            <TextField.Root
              name="username"
              placeholder="Username"
              aria-label="Username"
              autoComplete="username"
              autoFocus={!touch}
              required
            />
            <TextField.Root
              ref={password}
              name="password"
              type="password"
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              required
            />
            <Button type="submit" loading={pending}>
              Log in
            </Button>
            {error && (
              <Text color="red" size="2">
                {error}
              </Text>
            )}
          </Flex>
        </form>
      </Card>
    </Flex>
  )
}
