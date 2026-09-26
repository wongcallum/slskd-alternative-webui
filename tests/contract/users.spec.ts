import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { contextFor, expect, test } from '../fixtures'
import { start } from '../slskd'
import { startOwnPeer } from '../soulseek'
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

test('a blacklisted user gets an empty 404 from every lookup, before Soulseek is asked', async () => {
  const instance = await start()
  try {
    await writeFile(
      instance.configFile,
      'transfers:\n  groups:\n    blacklisted:\n      members:\n        - some.one\n',
    )
    await instance.relaunch()
    const api = await contextFor(instance)
    for (const path of ['info', 'status', 'endpoint', 'browse']) {
      const response = await api.get(`${user('some.one')}/${path}`)
      expect(response.status(), path).toBe(404)
      expect(await response.text(), path).toBe('')
    }
    await api.dispose()
  } finally {
    await instance.stop()
  }
})

test("a peer that stops answering times out after 5 s, and one that's gone can't be connected to", async ({
  api,
  slskd,
  network,
}) => {
  test.setTimeout(90_000)
  const peer = await startOwnPeer(await network(), slskd, `quiet.${randomUUID().slice(0, 8)} peer`, {
    'Shared/file.txt': 10,
  })
  const info = `${user(peer.username)}/info`
  try {
    peer.instance.signal('SIGSTOP')
    const quiet = await api.get(info)
    expect(quiet.status()).toBe(500)
    expect(await quiet.json()).toMatch(/timed out after 5000 milliseconds/)
    peer.instance.signal('SIGCONT')

    await peer.instance.stop()
    const gone = await api.get(info)
    expect(gone.status()).toBe(500)
    expect(await gone.json()).toContain('Failed to establish a direct or indirect')
  } finally {
    await peer.instance.stop()
  }
})
