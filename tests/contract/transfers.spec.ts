import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { contextFor, expect, ownName, test } from '../fixtures'
import { type Peer, uploadsEnded } from '../soulseek'
import * as schemas from './schemas'

test.use({ config: { soulseek: true } })

type File = { filename: string; size: number }

const file = (peer: Peer, filename: string): File => ({ filename, size: peer.files.get(filename)!.length })

const intro = 'Music\\Artist - Album\\01 Intro.flac'
const encore = 'Music\\Artist - Album\\CD2\\01 Encore.flac'
const missing = { filename: 'Music\\Nowhere\\missing.flac', size: 123 }

async function enqueue(api: APIRequestContext, peer: Peer, files: File[], extra: object = {}) {
  const response = await api.post('transfers/downloads/batches', { data: { username: peer.username, files, ...extra } })
  const body = schemas.parse(schemas.enqueued, await response.json())
  return { status: response.status(), ...body, ids: body.batch.transfers.map((transfer) => transfer.id) }
}

async function listed(
  api: APIRequestContext,
  direction: 'download' | 'upload',
  username: string,
  includeRemoved = false,
) {
  const response = await api.get(`transfers/${direction}s`, { params: { includeRemoved } })
  const users = schemas.parse(schemas.transferUsers, await response.json())
  return users.find((user) => user.username === username)?.directories.flatMap((directory) => directory.files) ?? []
}

const stateOf = async (api: APIRequestContext, peer: Peer, id: string) =>
  (await listed(api, 'download', peer.username)).find((transfer) => transfer.id === id)?.state

async function finished(api: APIRequestContext, peer: Peer, ids: string[]) {
  const ours = async () =>
    (await listed(api, 'download', peer.username)).filter((transfer) => ids.includes(transfer.id))
  await expect
    .poll(async () => (await ours()).filter((transfer) => transfer.state.startsWith('Completed')).length, {
      timeout: 30_000,
    })
    .toBe(ids.length)
  return ours()
}

const transferPath = (peer: Peer, id: string) => `transfers/downloads/${encodeURIComponent(peer.username)}/${id}`

const uploadPath = (username: string, id: string) => `transfers/uploads/${encodeURIComponent(username)}/${id}`

// The slow peer uploads one of two files to us, and queues the other.
async function uploadingTwo(api: APIRequestContext, slow: Peer) {
  const me = await ownName(api)
  const peer = await contextFor(slow.instance)
  await enqueue(
    api,
    slow,
    ['Slow\\Big 1.flac', 'Slow\\Big 2.flac'].map((name) => file(slow, name)),
  )
  const active = async () =>
    (await listed(peer, 'upload', me)).filter((transfer) => !transfer.state.startsWith('Completed'))
  await expect
    .poll(async () => (await active()).map((transfer) => transfer.state).sort(), { timeout: 30_000 })
    .toEqual(['InProgress', 'Queued, Locally'])
  const uploads = await active()
  const upload = async (id: string) => (await listed(peer, 'upload', me)).find((transfer) => transfer.id === id)
  return {
    me,
    peer,
    upload,
    running: uploads.find((transfer) => transfer.state === 'InProgress')!,
    queued: uploads.find((transfer) => transfer.state === 'Queued, Locally')!,
  }
}

test('downloads are listed by user and remote folder, with states named by their flags', async ({
  api,
  peers: { fast },
}) => {
  const { status, batch, ids } = await enqueue(api, fast, [file(fast, intro), file(fast, encore), missing])
  expect(status).toBe(201)
  const done = await finished(api, fast, ids)
  expect(done.every((transfer) => transfer.batchId === batch.id)).toBe(true)
  const users = schemas.parse(schemas.transferUsers, await (await api.get('transfers/downloads')).json())
  const folders = users
    .find((user) => user.username === fast.username)
    ?.directories.map((directory) => ({
      directory: directory.directory,
      files: directory.files.filter((transfer) => ids.includes(transfer.id)).map(({ state }) => state),
    }))
    .filter((directory) => directory.files.length > 0)
  expect(folders).toEqual(
    expect.arrayContaining([
      { directory: 'Music\\Artist - Album', files: ['Completed, Succeeded'] },
      { directory: 'Music\\Artist - Album\\CD2', files: ['Completed, Succeeded'] },
      { directory: 'Music\\Nowhere', files: ['Completed, Rejected'] },
    ]),
  )
})

test("a batch keeps its search and destination, and one that's gone is a 404", async ({ api, peers: { fast } }) => {
  const searchId = randomUUID()
  const { batch } = await enqueue(api, fast, [file(fast, intro)], { searchId, options: { destination: 'Some Album' } })
  const got = schemas.parse(schemas.batch, await (await api.get(`transfers/downloads/batches/${batch.id}`)).json())
  expect(got).toMatchObject({ searchId, options: { destination: 'Some Album' } })
  expect((await api.get(`transfers/downloads/batches/${randomUUID()}`)).status()).toBe(404)
})

test("an enqueue for a user who isn't online is a 404", async ({ api }) => {
  const response = await api.post('transfers/downloads/batches', {
    data: { username: 'nobody.here', files: [missing] },
  })
  expect(response.status()).toBe(404)
})

test('an enqueue is refused with a 429 while two others are being handled', async ({ api, peers: { fast } }) => {
  const tag = randomUUID()
  // slskd can be slow to take requests while it inserts a big batch, so now and then both small ones get in after it.
  await expect(async () => {
    const attempt = randomUUID()
    const post = (name: string, count: number) =>
      api.post('transfers/downloads/batches', {
        data: {
          username: fast.username,
          files: Array.from({ length: count }, (_, n) => ({
            filename: `Music\\Nowhere\\${tag} ${attempt} ${name} ${n}.flac`,
            size: 1,
          })),
        },
      })
    // While a batch inserts its records, it holds a lock on its user that another batch for that user waits on.
    const big = post('big', 300)
    await expect
      .poll(async () => (await (await api.get('transfers/downloads')).text()).includes(attempt), { intervals: [50] })
      .toBe(true)
    const small = await Promise.all([post('a', 1), post('b', 1)])
    expect((await big).status()).toBe(201)
    expect(small.map((response) => response.status()).sort((a, b) => a - b)).toEqual([201, 429])
  }).toPass({ timeout: 15_000 })
  // The peer rejects every file. Clearing them keeps the list short for the tests after.
  await expect
    .poll(
      async () =>
        (await listed(api, 'download', fast.username)).filter(
          (transfer) => transfer.filename.includes(tag) && !transfer.state.startsWith('Completed'),
        ).length,
      { timeout: 30_000 },
    )
    .toBe(0)
  await api.delete('transfers/downloads/all/completed')
})

test('cancelling a running download finishes it as cancelled, and removing it then drops it', async ({
  api,
  peers: { slow },
}) => {
  const {
    ids: [id],
  } = await enqueue(api, slow, [file(slow, 'Slow\\Big 1.flac')])
  await expect.poll(() => stateOf(api, slow, id!), { timeout: 30_000 }).toBe('InProgress')
  expect((await api.delete(transferPath(slow, id!), { params: { remove: false } })).status()).toBe(204)
  await expect.poll(() => stateOf(api, slow, id!)).toBe('Completed, Cancelled')
  expect((await api.delete(transferPath(slow, id!), { params: { remove: true } })).status()).toBe(204)
  await expect.poll(() => stateOf(api, slow, id!)).toBeUndefined()
})

test("a queued download's place in the peer's queue can be asked for", async ({ api, peers: { slow } }) => {
  const { ids } = await enqueue(
    api,
    slow,
    ['Slow\\Big 2.flac', 'Slow\\Big 3.flac'].map((name) => file(slow, name)),
  )
  const ours = async () =>
    (await listed(api, 'download', slow.username)).filter((transfer) => ids.includes(transfer.id))
  await expect
    .poll(async () => (await ours()).map((transfer) => transfer.state).sort(), { timeout: 30_000 })
    .toEqual(['InProgress', 'Queued, Remotely'])
  const queued = (await ours()).find((transfer) => transfer.state === 'Queued, Remotely')!.id
  const response = await api.get(`${transferPath(slow, queued)}/position`)
  expect(response.status()).toBe(200)
  const position = (await response.json()) as number
  expect(Number.isInteger(position) && position >= 0).toBe(true)
})

test('a finished download can be enqueued again, as a new download', async ({ api, peers: { slow } }) => {
  const big = file(slow, 'Slow\\Big 1.flac')
  const {
    ids: [first],
  } = await enqueue(api, slow, [big])
  // Cancelled before it's running, a download can end as errored instead.
  await expect.poll(() => stateOf(api, slow, first!), { timeout: 30_000 }).toBe('InProgress')
  await api.delete(transferPath(slow, first!))
  await expect.poll(() => stateOf(api, slow, first!)).toBe('Completed, Cancelled')
  await uploadsEnded(slow, await ownName(api))
  const retried = await enqueue(api, slow, [big])
  expect(retried.status).toBe(201)
  expect((await listed(api, 'download', slow.username)).map((transfer) => transfer.id)).toContain(retried.ids[0])
})

test('cancelling a queued upload finishes it as cancelled, and removing it then drops it', async ({
  api,
  peers: { slow },
}) => {
  const { me, peer, upload, running, queued } = await uploadingTwo(api, slow)
  expect((await peer.delete(uploadPath(me, queued.id), { params: { remove: false } })).status()).toBe(204)
  await expect.poll(async () => (await upload(queued.id))?.state).toBe('Completed, Cancelled')
  expect((await peer.delete(uploadPath(me, queued.id), { params: { remove: true } })).status()).toBe(204)
  await expect.poll(() => upload(queued.id)).toBeUndefined()
  expect((await upload(running.id))?.state).toBe('InProgress')
  await peer.dispose()
})

test('clearing finished uploads removes every finished one, and leaves the rest', async ({ api, peers: { slow } }) => {
  const { me, peer, upload, running, queued } = await uploadingTwo(api, slow)
  await peer.delete(uploadPath(me, queued.id))
  await expect.poll(async () => (await upload(queued.id))?.state).toBe('Completed, Cancelled')
  expect((await peer.delete('transfers/uploads/all/completed')).status()).toBe(204)
  expect((await listed(peer, 'upload', me)).map((transfer) => transfer.id)).toEqual([running.id])
  await peer.dispose()
})

test("a user's history comes as a report per direction", async ({ api, peers: { fast } }) => {
  const { ids } = await enqueue(api, fast, [file(fast, intro)])
  await finished(api, fast, ids)
  const report = await api.get(`telemetry/reports/transfers/users/${encodeURIComponent(fast.username)}`)
  expect(schemas.parse(schemas.userHistory, await report.json()).Download.statistics.total).toBeGreaterThan(0)
})
