import { expect, test } from '../fixtures'
import * as schemas from './schemas'

test.use({ config: { soulseek: true } })

const user = (username: string) => `users/${encodeURIComponent(username)}`

test("a peer's info, with its picture as base64, status and endpoint can be looked up", async ({
  api,
  peers: { fast },
}) => {
  const info = schemas.parse(schemas.userInfo, await (await api.get(`${user(fast.username)}/info`)).json())
  expect(info.picture).toBe(fast.picture?.toString('base64'))
  const status = schemas.parse(schemas.userStatus, await (await api.get(`${user(fast.username)}/status`)).json())
  expect(status.presence).toBe('Online')
  schemas.parse(schemas.endpoint, await (await api.get(`${user(fast.username)}/endpoint`)).json())
})

test("a user who isn't online has an Offline status, and a 404 with a message from the rest", async ({ api }) => {
  const response = await api.get(`${user('nobody.here')}/status`)
  expect(response.status()).toBe(200)
  expect(schemas.parse(schemas.userStatus, await response.json()).presence).toBe('Offline')
  for (const path of ['info', 'endpoint', 'browse']) {
    const offline = await api.get(`${user('nobody.here')}/${path}`)
    expect(offline.status(), path).toBe(404)
    expect(await offline.json(), path).toEqual(expect.stringMatching(/.+/))
  }
})
