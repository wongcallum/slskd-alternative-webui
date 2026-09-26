import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'

import { expect, test } from '../fixtures'
import { credentials, logIn, start } from '../slskd'

test('a login gets a token that authorises requests, and hub connections', async ({ slskd, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: `${slskd.api}/` })
  expect(await (await request.get('session/enabled')).json()).toBe(true)

  const login = await request.post('session', { data: credentials })
  expect(login.status()).toBe(200)
  const { token } = (await login.json()) as { token: string }
  const session = await request.get('session', { headers: { Authorization: `Bearer ${token}` } })
  expect(session.status()).toBe(200)
  expect(await session.text()).toBe('')

  const hub = new HubConnectionBuilder()
    .withUrl(`${slskd.base}/hub/application`, { accessTokenFactory: () => token })
    .configureLogging(LogLevel.None)
    .build()
  await hub.start()
  await hub.stop()
})

test('a wrong login is a 401 with an empty body, and missing fields a 400', async ({ slskd, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: `${slskd.api}/` })
  const wrong = await request.post('session', { data: { ...credentials, password: 'wrong' } })
  expect(wrong.status()).toBe(401)
  expect(await wrong.text()).toBe('')
  const missing = await request.post('session', { data: { username: credentials.username } })
  expect(missing.status()).toBe(400)
})

test('a request without a valid token is a 401 with an empty body', async ({ slskd, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: `${slskd.api}/` })
  for (const headers of [{}, { Authorization: 'Bearer bogus' }] as Record<string, string>[]) {
    for (const path of ['session', 'application', 'transfers/downloads']) {
      const response = await request.get(path, { headers })
      expect(response.status(), path).toBe(401)
      expect(await response.text()).toBe('')
    }
  }
})

test("a hub doesn't connect without a token", async ({ slskd }) => {
  const hub = new HubConnectionBuilder()
    .withUrl(`${slskd.base}/hub/application`)
    .configureLogging(LogLevel.None)
    .build()
  await expect(hub.start()).rejects.toThrow(/401/)
})

test.describe('without auth', () => {
  test.use({ config: { auth: false } })

  test('every request is let in, even with a stale token', async ({ slskd, playwright }) => {
    const request = await playwright.request.newContext({ baseURL: `${slskd.api}/` })
    expect(await (await request.get('session/enabled')).json()).toBe(false)
    for (const headers of [{}, { Authorization: 'Bearer bogus' }] as Record<string, string>[]) {
      expect((await request.get('application', { headers })).status()).toBe(200)
    }
  })
})

test('a restart comes back and ends every session', async () => {
  const slskd = await start()
  try {
    const headers = { Authorization: `Bearer ${await logIn(slskd)}` }
    await slskd.restartedBy(async () =>
      expect((await fetch(`${slskd.api}/application`, { method: 'PUT', headers })).status).toBe(204),
    )
    await expect
      .poll(async () => (await fetch(`${slskd.api}/session`, { headers }).catch(() => undefined))?.status, {
        timeout: 30_000,
      })
      .toBe(401)
    await logIn(slskd)
  } finally {
    await slskd.stop()
  }
})

test('a shutdown stops the process', async ({ playwright }) => {
  const slskd = await start()
  try {
    const request = await playwright.request.newContext({
      baseURL: `${slskd.api}/`,
      extraHTTPHeaders: { Authorization: `Bearer ${await logIn(slskd)}` },
    })
    expect((await request.delete('application')).status()).toBe(204)
    await expect
      .poll(async () => (await fetch(`${slskd.api}/session/enabled`).catch(() => undefined))?.status, {
        timeout: 10_000,
      })
      .toBeUndefined()
  } finally {
    await slskd.stop()
  }
})
