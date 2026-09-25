import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'
import { describeError } from '../lib/api'
import { DelayedSpinner } from '../ui/status'
import { Login } from './Login'
import { useSession } from './session'

export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession()
  switch (session.status) {
    case 'checking':
      return <Checking />
    case 'unreachable':
      return <Unreachable error={session.error} retry={session.retry} />
    case 'anonymous':
      return <Login ended={session.ended} />
    case 'open':
    case 'authenticated':
      return children
  }
}

function Checking() {
  return (
    <Flex align="center" justify="center" minHeight="100vh">
      <DelayedSpinner />
    </Flex>
  )
}

function Unreachable({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Flex align="center" justify="center" minHeight="100vh" p="4">
      <Card size="3" style={{ width: 360 }}>
        <Flex direction="column" gap="3">
          <Heading size="5">Can't reach slskd</Heading>
          <Text color="gray">{describeError(error)}</Text>
          <Text color="gray" size="2">
            Retrying automatically.
          </Text>
          <Button onClick={retry}>Retry now</Button>
        </Flex>
      </Card>
    </Flex>
  )
}
