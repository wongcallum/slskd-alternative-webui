import { Code, Container, DataList, Heading } from '@radix-ui/themes'
import { useEffect, useState } from 'react'
import { urlBase } from './urlBase'

export function Hello() {
  const [authEnabled, setAuthEnabled] = useState('…')

  useEffect(() => {
    fetch(`${urlBase}/api/v0/session/enabled`)
      .then(async (response) => (response.ok ? JSON.stringify(await response.json()) : `HTTP ${response.status}`))
      .catch((error: unknown) => String(error))
      .then(setAuthEnabled)
  }, [])

  return (
    <Container size="1" p="6">
      <Heading mb="4">hello from slskd</Heading>
      <DataList.Root>
        <DataList.Item>
          <DataList.Label>window.urlBase</DataList.Label>
          <DataList.Value>
            <Code>{JSON.stringify(window.urlBase)}</Code>
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>session/enabled</DataList.Label>
          <DataList.Value>
            <Code>{authEnabled}</Code>
          </DataList.Value>
        </DataList.Item>
      </DataList.Root>
    </Container>
  )
}
