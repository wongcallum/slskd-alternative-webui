import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { APIRequestContext } from '@playwright/test'

import { contextFor, expect, ownName, test } from '../fixtures'
import { loggedIn, type Peer, startLoggedIn, uploadsEnded } from '../soulseek'
import * as schemas from './schemas'

test.use({ config: { soulseek: true } })

type File = { filename: string; size: number }

const file = (peer: Peer, filename: string): File => ({ filename, size: peer.files.get(filename)!.length })

const intro = 'Music\\Artist - Album\\01 Intro.flac'
const outro = 'Music\\Artist - Album\\02 Outro.flac'
const encore = 'Music\\Artist - Album\\CD2\\01 Encore.flac'
const missing = { filename: 'Music\\Nowhere\\missing.flac', size: 123 }

async function enqueue(api: APIRequestContext, peer: Peer, files: File[], extra: object = {}) {
  const response = await api.post('transfers/downloads/batches', { data: { username: peer.username, files, ...extra } })
  const body = schemas.parse(schemas.enqueued, await response.json())
  return { status: response.status(), ...body, ids: body.batch.transfers.map((transfer) => transfer.id) }
}

async function listed(api: APIRequestContext, direction: 'download' | 'upload', username: string) {
  const users = schemas.parse(schemas.transferUsers, await (await api.get(`transfers/${direction}s`)).json())
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

const albumFile = (folder: string, name: string) =>
  ['Music\\Artist - Album', ...folder.split('/').filter(Boolean), name].join('\\')

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
  expect(done.find((transfer) => transfer.filename === missing.filename)?.exception).toBe(
    'Transfer rejected: File not shared.',
  )
})

test('the peer lists them among its uploads, under our username', async ({ api, peers: { fast } }) => {
  const me = await ownName(api)
  const { ids } = await enqueue(api, fast, [file(fast, outro)])
  await finished(api, fast, ids)
  const peer = await contextFor(fast.instance)
  await expect
    .poll(async () => (await listed(peer, 'upload', me)).map(({ filename, state }) => ({ filename, state })))
    .toContainEqual({ filename: outro, state: 'Completed, Succeeded' })
  await peer.dispose()
})

test("a batch keeps its search and destination, and one that's gone is a 404", async ({ api, peers: { fast } }) => {
  const searchId = randomUUID()
  const { batch } = await enqueue(api, fast, [file(fast, intro)], { searchId, options: { destination: 'Some Album' } })
  const got = schemas.parse(schemas.batch, await (await api.get(`transfers/downloads/batches/${batch.id}`)).json())
  expect(got).toMatchObject({ searchId, options: { destination: 'Some Album' } })
  expect((await api.get(`transfers/downloads/batches/${randomUUID()}`)).status()).toBe(404)
})

test('a folder enqueued as one batch per remote folder, each with its destination, keeps its subfolders', async ({
  api,
  slskd,
  peers: { fast },
}) => {
  const root = `Album ${randomUUID().slice(0, 8)}`
  const folders: Record<string, string[]> = {
    '': ['01 Intro.flac', '02 Outro.flac'],
    CD2: ['01 Encore.flac'],
    'CD2/Scans': ['cover.jpg'],
  }
  const ids: string[] = []
  for (const [folder, names] of Object.entries(folders)) {
    const destination = [root, folder].filter(Boolean).join('/')
    const result = await enqueue(
      api,
      fast,
      names.map((name) => file(fast, albumFile(folder, name))),
      { options: { destination } },
    )
    ids.push(...result.ids)
  }
  const done = await finished(api, fast, ids)
  expect(done.map((transfer) => transfer.state)).toEqual(ids.map(() => 'Completed, Succeeded'))
  for (const [folder, names] of Object.entries(folders)) {
    for (const name of names) {
      expect(await readFile(path.join(slskd.downloads, root, folder, name))).toEqual(
        fast.files.get(albumFile(folder, name)),
      )
    }
  }
})

test("an enqueue for a user who isn't online is a 404", async ({ api }) => {
  const response = await api.post('transfers/downloads/batches', {
    data: { username: 'nobody.here', files: [missing] },
  })
  expect(response.status()).toBe(404)
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

test("a queued download's place in the peer's queue can be asked for, and is kept on the record", async ({
  api,
  peers: { slow },
}) => {
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
  expect((await ours()).find((transfer) => transfer.id === queued)?.placeInQueue).toBe(position)
})

test('enqueueing a file again skips it while it runs, and retries it under a new id once it has finished', async ({
  api,
  peers: { slow },
}) => {
  const big = file(slow, 'Slow\\Big 1.flac')
  const {
    ids: [first],
  } = await enqueue(api, slow, [big])
  const skipped = await enqueue(api, slow, [big])
  expect(skipped.status).toBe(200)
  expect(skipped.failures).toEqual([{ filename: big.filename, message: 'Skipped: Already in progress' }])
  // Cancelled before it's running, a download can end as errored instead.
  await expect.poll(() => stateOf(api, slow, first!), { timeout: 30_000 }).toBe('InProgress')
  await api.delete(transferPath(slow, first!))
  await expect.poll(() => stateOf(api, slow, first!)).toBe('Completed, Cancelled')
  await uploadsEnded(slow, await ownName(api))
  const retried = await enqueue(api, slow, [big])
  expect(retried.status).toBe(201)
  const ids = (await listed(api, 'download', slow.username)).map((transfer) => transfer.id)
  expect(ids).toContain(retried.ids[0])
  expect(ids).not.toContain(first)
})

test('clearing finished downloads removes every finished one, and leaves the rest', async ({
  api,
  peers: { fast, slow },
}) => {
  const done = await enqueue(api, fast, [file(fast, intro), missing])
  await finished(api, fast, done.ids)
  const running = await enqueue(api, slow, [file(slow, 'Slow\\Big 2.flac')])
  expect((await api.delete('transfers/downloads/all/completed')).status()).toBe(204)
  const left = [...(await listed(api, 'download', fast.username)), ...(await listed(api, 'download', slow.username))]
  const ids = left.map((transfer) => transfer.id)
  for (const id of done.ids) expect(ids).not.toContain(id)
  expect(ids).toContain(running.ids[0])
})

test("a user's history counts their finished downloads", async ({ api, peers: { fast } }) => {
  const history = async () =>
    schemas.parse(
      schemas.userHistory,
      await (await api.get(`telemetry/reports/transfers/users/${encodeURIComponent(fast.username)}`)).json(),
    ).Download
  const before = await history()
  const { ids } = await enqueue(api, fast, [file(fast, intro), file(fast, outro), missing])
  await finished(api, fast, ids)
  const after = await history()
  expect(after.statistics.total - before.statistics.total).toBe(3)
  expect(after.statistics.successful - before.statistics.successful).toBe(2)
  expect((after.summary.Succeeded?.totalBytes ?? 0) - (before.summary.Succeeded?.totalBytes ?? 0)).toBe(
    file(fast, intro).size + file(fast, outro).size,
  )
  expect(after.exceptions.map((each) => each.exception)).toContain('File not shared.')
})

test('downloads left unfinished when slskd dies are enqueued again at the next login, under new ids and without their batch', async ({
  network,
}) => {
  test.setTimeout(90_000)
  const started = await network()
  const { slow } = started
  const instance = await startLoggedIn(started, {}, `crash.${randomUUID().slice(0, 8)} test`)
  try {
    let api = await contextFor(instance)
    const {
      ids: [id],
    } = await enqueue(api, slow, [file(slow, 'Slow\\Big 3.flac')], { options: { destination: 'Lost' } })
    await expect.poll(() => stateOf(api, slow, id!), { timeout: 30_000 }).toMatch(/Remotely|InProgress/)
    await api.dispose()
    await instance.relaunch()
    await loggedIn(instance)
    api = await contextFor(instance)
    await expect
      .poll(async () =>
        (await listed(api, 'download', slow.username)).map(({ id: current, batchId, state }) => ({
          id: current,
          batchId,
          finished: state.startsWith('Completed'),
        })),
      )
      .toEqual([{ id: expect.not.stringMatching(id!), batchId: undefined, finished: false }])
    await api.dispose()
  } finally {
    await instance.stop()
  }
})
