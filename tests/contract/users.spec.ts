import { expect, test } from '../fixtures'
import * as schemas from './schemas'

test.use({ config: { soulseek: true } })

test("a peer's info, status and endpoint can be looked up", async ({ api, peers: { fast } }) => {
  const user = `users/${encodeURIComponent(fast.username)}`
  schemas.parse(schemas.userInfo, await (await api.get(`${user}/info`)).json())
  const status = schemas.parse(schemas.userStatus, await (await api.get(`${user}/status`)).json())
  expect(status.presence).toBe('Online')
  schemas.parse(schemas.endpoint, await (await api.get(`${user}/endpoint`)).json())
})

test("a user who isn't online has an Offline status rather than a 404", async ({ api }) => {
  const response = await api.get('users/nobody.here/status')
  expect(response.status()).toBe(200)
  expect(schemas.parse(schemas.userStatus, await response.json()).presence).toBe('Offline')
})
