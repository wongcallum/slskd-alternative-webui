import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import type { RawState } from '../../src/system/application'
import { contextFor, expect, jsonString, test } from '../fixtures'
import { openHub } from '../hub'
import { configYaml, logIn, sleep } from '../slskd'
import { startLoggedIn } from '../soulseek'
import * as schemas from './schemas'

// The message the app sends with a disconnect.
const disconnect = (api: APIRequestContext) => api.delete('server', jsonString('client disconnected from web UI'))

const newest = async (api: APIRequestContext, type: string) =>
  schemas
    .parse(schemas.events, await (await api.get('events', { params: { limit: 100 } })).json())
    .find((event) => event.type === type)

const disconnected = ({ server, connectionWatchdog }: RawState) =>
  !server.isConnected && !server.isTransitioning && !connectionWatchdog.isAttemptingConnection

test('connecting without a Soulseek login keeps retrying on a timer, until a disconnect stops it', async ({
  slskd,
  api,
  token,
}) => {
  const hub = await openHub(slskd, 'application', token, ['STATE'])
  const latest = () => schemas.parse(schemas.state, hub.received('STATE').at(-1)).connectionWatchdog
  try {
    await expect.poll(() => hub.received('STATE').length).toBeGreaterThan(0)
    expect((await api.put('server')).ok()).toBe(true)
    await expect.poll(() => latest().isAttemptingConnection).toBe(true)
    expect(Date.parse(latest().nextAttemptAt!)).toBeGreaterThan(Date.now() - 1000)
  } finally {
    expect((await disconnect(api)).status()).toBe(204)
    await expect.poll(latest).toMatchObject({ isAttemptingConnection: false, nextAttemptAt: null })
    await hub.stop()
  }
})

test.describe('logged in to Soulseek', () => {
  test('a disconnect goes through Disconnecting and stays disconnected, and connecting logs in again, each raising an event', async ({
    network,
  }) => {
    test.setTimeout(90_000)
    const instance = await startLoggedIn(await network(), {}, `server.${randomUUID().slice(0, 8)} test`)
    const api = await contextFor(instance)
    const hub = await openHub(instance, 'application', await logIn(instance), ['STATE'])
    try {
      const pushed = () => hub.received('STATE').map((state) => schemas.parse(schemas.state, state))

      expect((await disconnect(api)).status()).toBe(204)
      await expect.poll(() => pushed().some((state) => state.server.state.includes('Disconnecting'))).toBe(true)
      await expect.poll(() => disconnected(pushed().at(-1)!)).toBe(true)
      // The watchdog would try again within a second or two.
      await sleep(3000)
      expect(disconnected(pushed().at(-1)!)).toBe(true)
      const lost = await newest(api, 'SoulseekClientDisconnected')
      expect(JSON.parse(lost!.data)).toMatchObject({ message: 'client disconnected from web UI' })

      const from = pushed().length
      expect((await api.put('server')).ok()).toBe(true)
      await expect
        .poll(
          () =>
            pushed()
              .slice(from)
              .find((state) => state.server.isLoggedIn)?.server.address,
          { timeout: 15_000 },
        )
        .toBeTruthy()
      const connecting = pushed()
        .slice(from)
        .some(({ server }) => !server.isLoggedIn && (server.isTransitioning || server.isConnected))
      expect(connecting).toBe(true)
      const found = await newest(api, 'SoulseekClientConnected')
      expect(Date.parse(found!.timestamp)).toBeGreaterThan(Date.parse(lost!.timestamp))
    } finally {
      await hub.stop()
      await api.dispose()
      await instance.stop()
    }
  })

  test('a changed Soulseek login asks for a reconnect, and a disconnect clears that', async ({ network }) => {
    test.setTimeout(90_000)
    const instance = await startLoggedIn(await network(), {}, `reconnect.${randomUUID().slice(0, 8)} test`, {
      SLSKD_NO_CONFIG_WATCH: 'false',
    })
    const api = await contextFor(instance)
    try {
      const pending = async () =>
        schemas.parse(schemas.state, await (await api.get('application')).json()).pendingReconnect
      expect(await pending()).toBe(false)
      const changed = `${configYaml}soulseek:\n  password: changed\n`
      expect((await api.put('options/yaml', jsonString(changed))).status()).toBe(200)
      await expect.poll(pending).toBe(true)
      expect((await disconnect(api)).status()).toBe(204)
      await expect.poll(pending).toBe(false)
    } finally {
      await api.dispose()
      await instance.stop()
    }
  })
})
