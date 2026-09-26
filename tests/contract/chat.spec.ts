import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import type { APIRequestContext } from '@playwright/test'

import { contextFor, expect, jsonString, ownName, test } from '../fixtures'
import { start } from '../slskd'
import { loggedIn, startLoggedIn } from '../soulseek'
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

async function send(api: APIRequestContext, username: string, text: string) {
  expect((await api.post(conversation(username), jsonString(text))).status()).toBe(201)
}

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

test('a message to a blacklisted user is a 200, and starts no conversation', async () => {
  const instance = await start()
  try {
    await writeFile(
      instance.configFile,
      'transfers:\n  groups:\n    blacklisted:\n      members:\n        - some.one\n',
    )
    await instance.relaunch()
    const api = await contextFor(instance)
    expect((await api.post(conversation('some.one'), jsonString('Hello'))).status()).toBe(200)
    expect((await api.get(`${conversation('some.one')}/messages`)).status()).toBe(404)
    await api.dispose()
  } finally {
    await instance.stop()
  }
})

test.describe('logged in to Soulseek', () => {
  test.use({ config: { soulseek: true } })

  test('a message sent is stored at once as ours with id 0, and reaches the other side unread', async ({
    api,
    peers: { fast },
  }) => {
    const text = unique('Hello')
    await send(api, fast.username, text)
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

  test('acknowledging a conversation marks every unread message in it read', async ({ api, peers: { fast } }) => {
    const peer = await contextFor(fast.instance)
    const me = await ownName(api)
    const texts = [unique('One'), unique('Two')]
    for (const text of texts) await send(peer, me, text)
    await expect
      .poll(async () =>
        (await messages(api, fast.username))
          .filter((message) => texts.includes(message.message))
          .map((message) => message.isAcknowledged),
      )
      .toEqual([false, false])
    expect((await listed(api, fast.username))?.unAcknowledgedMessageCount).toBeGreaterThanOrEqual(2)
    expect((await api.put(conversation(fast.username))).status()).toBe(200)
    expect((await messages(api, fast.username)).every((message) => message.isAcknowledged)).toBe(true)
    expect(await listed(api, fast.username)).toEqual({ username: fast.username, unAcknowledgedMessageCount: 0 })
    await peer.dispose()
  })

  test('closing a conversation marks it read and unlists it, until a message either way lists it again', async ({
    api,
    peers: { fast },
  }) => {
    const peer = await contextFor(fast.instance)
    const me = await ownName(api)
    const first = unique('Before')
    await send(peer, me, first)
    await expect
      .poll(async () => (await messages(api, fast.username)).some((message) => message.message === first))
      .toBe(true)
    expect((await api.delete(conversation(fast.username))).status()).toBe(204)
    expect(await listed(api, fast.username)).toBeUndefined()
    expect((await messages(api, fast.username)).find((message) => message.message === first)?.isAcknowledged).toBe(true)
    await send(peer, me, unique('After'))
    await expect
      .poll(() => listed(api, fast.username))
      .toEqual({ username: fast.username, unAcknowledgedMessageCount: 1 })
    expect((await api.delete(conversation(fast.username))).status()).toBe(204)
    await send(api, fast.username, unique('Ours'))
    expect(await listed(api, fast.username)).toEqual({ username: fast.username, unAcknowledgedMessageCount: 0 })
    await peer.dispose()
  })

  test("a message left unread is delivered again at the next login, and one acknowledged isn't", async ({
    network,
  }) => {
    test.setTimeout(90_000)
    const started = await network()
    const { fast } = started
    const me = `pm.${randomUUID().slice(0, 8)} test`
    const instance = await startLoggedIn(started, {}, me)
    try {
      let api = await contextFor(instance)
      const peer = await contextFor(fast.instance)
      const [read, unread] = [unique('Read'), unique('Unread')]
      await send(peer, me, read)
      await expect.poll(async () => (await messages(api, fast.username)).length).toBe(1)
      await api.put(conversation(fast.username))
      await send(peer, me, unread)
      await expect.poll(async () => (await messages(api, fast.username)).length).toBe(2)
      await peer.dispose()
      await api.dispose()
      await instance.relaunch()
      await loggedIn(instance)
      api = await contextFor(instance)
      await expect
        .poll(async () =>
          schemas
            .parse(schemas.replayedMessages, await (await api.get(`${conversation(fast.username)}/messages`)).json())
            .map(({ message, isAcknowledged, wasReplayed }) => ({ message, isAcknowledged, wasReplayed })),
        )
        .toEqual([
          { message: read, isAcknowledged: true, wasReplayed: false },
          { message: unread, isAcknowledged: false, wasReplayed: true },
        ])
      await api.dispose()
    } finally {
      await instance.stop()
    }
  })

  test('a joined room keeps its users and messages up to date, marking ours, until we leave it', async ({
    api,
    peers: { fast, slow },
  }) => {
    const room = unique('Room')
    const path = `rooms/joined/${encodeURIComponent(room)}`
    const [first, later] = [await contextFor(fast.instance), await contextFor(slow.instance)]
    const me = await ownName(api)
    const users = async () => schemas.parse(schemas.roomUsers, await (await api.get(`${path}/users`)).json())
    const rooms = async () => schemas.parse(schemas.state, await (await api.get('application')).json()).rooms

    // A room that doesn't exist is created by joining it.
    expect((await first.post('rooms/joined', jsonString(room))).status()).toBe(201)
    expect((await api.post('rooms/joined', jsonString(room))).status()).toBe(201)
    const available = schemas.parse(schemas.availableRooms, await (await api.get('rooms/available')).json())
    expect(available.find((each) => each.name === room)).toMatchObject({ userCount: 2, isPrivate: false })
    await expect.poll(rooms).toContain(room)
    expect((await users()).map(({ username, self }) => ({ username, self: self === true }))).toEqual(
      expect.arrayContaining([
        { username: me, self: true },
        { username: fast.username, self: false },
      ]),
    )
    expect((await users()).find((user) => user.username === fast.username)?.fileCount).toBe(fast.files.size)

    expect((await later.post('rooms/joined', jsonString(room))).status()).toBe(201)
    await expect.poll(async () => (await users()).map((user) => user.username)).toContain(slow.username)

    const [theirs, ours] = [unique('Hello'), unique('Hi')]
    expect((await first.post(`${path}/messages`, jsonString(theirs))).status()).toBe(201)
    expect((await api.post(`${path}/messages`, jsonString(ours))).status()).toBe(201)
    await expect
      .poll(async () =>
        schemas
          .parse(schemas.roomMessages, await (await api.get(`${path}/messages`)).json())
          .map(({ username, message, self }) => ({ username, message, self: self === true })),
      )
      .toEqual(
        expect.arrayContaining([
          { username: fast.username, message: theirs, self: false },
          { username: me, message: ours, self: true },
        ]),
      )

    expect((await later.delete(path)).status()).toBe(204)
    await expect.poll(async () => (await users()).map((user) => user.username)).not.toContain(slow.username)
    expect((await api.delete(path)).status()).toBe(204)
    expect((await api.get(`${path}/messages`)).status()).toBe(404)
    await expect.poll(rooms).not.toContain(room)
    await first.delete(path)
    await Promise.all([first.dispose(), later.dispose()])
  })
})
