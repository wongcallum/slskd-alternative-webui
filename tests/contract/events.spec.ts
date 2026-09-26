import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { contextFor, expect, jsonString, ownName, test } from '../fixtures'
import * as schemas from './schemas'

// What an event's data holds, as far as the app reads it and the tests find events by.
type Data = {
  remoteFilename?: string
  remoteDirectoryName?: string
  username?: string
  transfer?: { id?: string; username?: string }
  message?: { username?: string; message?: string; roomName?: string; wasReplayed?: boolean }
}

type Found = { timestamp: string; data: Data }

async function newest(api: APIRequestContext, type: string, match: (event: Found) => boolean) {
  const events = schemas.parse(schemas.events, await (await api.get('events', { params: { limit: 100 } })).json())
  return events
    .filter((event) => event.type === type)
    .map((event) => ({ timestamp: event.timestamp, data: JSON.parse(event.data) as Data }))
    .find(match)
}

test('events come in pages, newest first, with the total in a header', async ({ api }) => {
  const raised: string[] = []
  for (let index = 0; index < 3; index++) {
    const response = await api.post('events/Noop', { data: '""', headers: { 'Content-Type': 'application/json' } })
    expect(response.status()).toBe(201)
    raised.push(((await response.json()) as { id: string }).id)
  }
  const first = await api.get('events', { params: { offset: 0, limit: 2 } })
  const total = Number(first.headers()['x-total-count'])
  expect(total).toBeGreaterThanOrEqual(3)
  const page = schemas.parse(schemas.events, await first.json())
  expect(page.map((event) => event.id)).toEqual(raised.slice(1).toReversed())
  expect(JSON.parse(page[0]!.data)).toBeInstanceOf(Object)

  const next = schemas.parse(
    schemas.events,
    await (await api.get('events', { params: { offset: 2, limit: 2 } })).json(),
  )
  expect(next[0]?.id).toBe(raised[0])
  expect(await (await api.get('events', { params: { offset: total, limit: 2 } })).json()).toEqual([])
})

test.describe('logged in to Soulseek', () => {
  test.use({ config: { soulseek: true } })

  test('a finished download and upload each raise events naming the user and the file or folder', async ({
    api,
    peers: { fast },
  }) => {
    const me = await ownName(api)
    const intro = 'Music\\Artist - Album\\01 Intro.flac'
    const response = await api.post('transfers/downloads/batches', {
      data: { username: fast.username, files: [{ filename: intro, size: fast.files.get(intro)!.length }] },
    })
    const [id] = schemas.parse(schemas.enqueued, await response.json()).batch.transfers.map((transfer) => transfer.id)
    const file = () => newest(api, 'DownloadFileComplete', ({ data }) => data.transfer?.id === id)
    await expect.poll(file, { timeout: 30_000 }).toBeDefined()
    const { timestamp, data } = (await file())!
    expect(data).toMatchObject({ remoteFilename: intro, transfer: { username: fast.username } })
    // A folder's event has its last file's timestamp.
    await expect
      .poll(
        async () => (await newest(api, 'DownloadDirectoryComplete', (event) => event.timestamp === timestamp))?.data,
      )
      .toMatchObject({ username: fast.username, remoteDirectoryName: 'Music\\Artist - Album' })

    const peer = await contextFor(fast.instance)
    const upload = ({ data: { transfer, remoteFilename } }: Found) =>
      transfer?.username === me && remoteFilename === intro
    await expect.poll(() => newest(peer, 'UploadFileComplete', upload)).toBeDefined()
    await peer.dispose()
  })

  test('a private message and a room message each raise an event with the user, the text and the room', async ({
    api,
    peers: { fast },
  }) => {
    const me = await ownName(api)
    const peer = await contextFor(fast.instance)
    const [direct, said, room] = ['Hello', 'Hi all', 'Room'].map((text) => `${text} ${randomUUID().slice(0, 8)}`)

    expect((await peer.post(`conversations/${encodeURIComponent(me)}`, jsonString(direct!))).status()).toBe(201)
    await expect
      .poll(
        async () => (await newest(api, 'PrivateMessageReceived', ({ data }) => data.message?.message === direct))?.data,
      )
      .toMatchObject({ message: { username: fast.username, wasReplayed: false } })
    await api.put(`conversations/${encodeURIComponent(fast.username)}`)

    const path = `rooms/joined/${encodeURIComponent(room!)}`
    for (const each of [peer, api]) expect((await each.post('rooms/joined', jsonString(room!))).status()).toBe(201)
    expect((await peer.post(`${path}/messages`, jsonString(said!))).status()).toBe(201)
    await expect
      .poll(async () => (await newest(api, 'RoomMessageReceived', ({ data }) => data.message?.message === said))?.data)
      .toMatchObject({ message: { username: fast.username, roomName: room } })
    for (const each of [peer, api]) await each.delete(path)
    await peer.dispose()
  })
})
