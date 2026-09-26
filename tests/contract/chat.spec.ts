import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { contextFor, expect, jsonString, ownName, test } from '../fixtures'
import * as schemas from './schemas'

const conversation = (username: string) => `conversations/${encodeURIComponent(username)}`

async function messages(api: APIRequestContext, username: string) {
  const response = await api.get(`${conversation(username)}/messages`)
  return response.status() === 404 ? [] : schemas.parse(schemas.privateMessages, await response.json())
}

const listed = async (api: APIRequestContext, username: string) =>
  schemas
    .parse(schemas.conversations, await (await api.get('conversations')).json())
    .find((each) => each.username === username)

const unique = (text: string) => `${text} ${randomUUID().slice(0, 8)}`

test("a conversation that hasn't started is a 404, and so is leaving a room that isn't joined", async ({ api }) => {
  expect(await (await api.get('conversations')).json()).toEqual([])
  expect((await api.get('conversations/nobody/messages')).status()).toBe(404)
  expect(await (await api.get('rooms/joined')).json()).toEqual([])
  expect((await api.delete('rooms/joined/nowhere')).status()).toBe(404)
})

test("a browse that hasn't started has no status", async ({ api }) => {
  expect((await api.get(`users/${encodeURIComponent('some.one')}/browse/status`)).status()).toBe(404)
})

test.describe('logged in to Soulseek', () => {
  test.use({ config: { soulseek: true } })

  test('a message sent is stored at once as ours with id 0, and reaches the other side unread', async ({
    api,
    peers: { fast },
  }) => {
    const text = unique('Hello')
    expect((await api.post(conversation(fast.username), jsonString(text))).status()).toBe(201)
    expect((await messages(api, fast.username)).find((message) => message.message === text)).toMatchObject({
      id: 0,
      username: fast.username,
      direction: 'Out',
      isAcknowledged: true,
    })
    const me = await ownName(api)
    const peer = await contextFor(fast.instance)
    await expect
      .poll(async () => (await messages(peer, me)).find((message) => message.message === text))
      .toMatchObject({ username: me, direction: 'In', isAcknowledged: false })
    expect((await listed(peer, me))?.unAcknowledgedMessageCount).toBeGreaterThan(0)
    await peer.dispose()
  })

  test('a joined room lists its users and messages, until we leave it', async ({ api, peers: { fast } }) => {
    const room = unique('Room')
    const path = `rooms/joined/${encodeURIComponent(room)}`
    const peer = await contextFor(fast.instance)
    const rooms = async () => schemas.parse(schemas.state, await (await api.get('application')).json()).rooms

    expect((await peer.post('rooms/joined', jsonString(room))).status()).toBe(201)
    expect((await api.post('rooms/joined', jsonString(room))).status()).toBe(201)
    const available = schemas.parse(schemas.availableRooms, await (await api.get('rooms/available')).json())
    expect(available.map((each) => each.name)).toContain(room)
    await expect.poll(rooms).toContain(room)
    const users = schemas.parse(schemas.roomUsers, await (await api.get(`${path}/users`)).json())
    expect(users.map((user) => user.username)).toContain(fast.username)

    const said = unique('Hello')
    expect((await peer.post(`${path}/messages`, jsonString(said))).status()).toBe(201)
    await expect
      .poll(async () =>
        schemas
          .parse(schemas.roomMessages, await (await api.get(`${path}/messages`)).json())
          .map((each) => each.message),
      )
      .toContain(said)

    expect((await api.delete(path)).status()).toBe(204)
    expect((await api.get(`${path}/messages`)).status()).toBe(404)
    await expect.poll(rooms).not.toContain(room)
    await peer.delete(path)
    await peer.dispose()
  })
})
