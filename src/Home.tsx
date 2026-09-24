import { Button, Code, Container, DataList, Heading } from '@radix-ui/themes'
import { applicationHub, type HubStatus, useApplicationState, useHub } from './hubs'
import { logout, useSession } from './session'

// TODO: phase 3's app shell replaces this placeholder page.
export function Home() {
  const session = useSession()
  const hub = useHub(applicationHub)
  const state = useApplicationState()

  return (
    <Container size="1" p="6">
      <Heading mb="4">slskd</Heading>
      <DataList.Root mb="4">
        <DataList.Item>
          <DataList.Label>window.urlBase</DataList.Label>
          <DataList.Value>
            <Code>{JSON.stringify(window.urlBase)}</Code>
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Session</DataList.Label>
          <DataList.Value>{session.status === 'open' ? 'open instance' : 'logged in'}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Application hub</DataList.Label>
          <DataList.Value>{describeHub(hub)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Soulseek server</DataList.Label>
          <DataList.Value>{state?.server.state ?? '…'}</DataList.Value>
        </DataList.Item>
      </DataList.Root>
      {/* TODO: phase 3 moves logout into the app shell's menu. */}
      {session.status === 'authenticated' && (
        <Button variant="soft" onClick={logout}>
          Log out
        </Button>
      )}
    </Container>
  )
}

function describeHub({ state, attempt }: HubStatus) {
  return attempt === 0 ? state : `${state} (retry ${attempt})`
}
