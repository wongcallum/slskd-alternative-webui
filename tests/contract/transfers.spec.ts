import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { expect, test } from '../fixtures'
import { seedBatch, seedTransfers, states } from '../seed'
import * as schemas from './schemas'

// A dot and a space, which the app sends URL-encoded in the path.
const newUser = () => `user.${randomUUID().slice(0, 8)} test`

async function listed(api: APIRequestContext, direction: 'download' | 'upload', username: string) {
  const users = schemas.parse(schemas.transferUsers, await (await api.get(`transfers/${direction}s`)).json())
  return users.find((user) => user.username === username)
}

const filesOf = (user: Awaited<ReturnType<typeof listed>>) =>
  user?.directories.flatMap((directory) => directory.files) ?? []

test('the lists group transfers by user and remote folder, with states named by their flags', async ({
  slskd,
  api,
}) => {
  const username = newUser()
  const batchId = seedBatch(slskd, { username })
  const ids = seedTransfers(
    slskd,
    states.map((state, index) => ({
      username,
      filename: `Music\\${index % 2 === 0 ? 'Album' : 'Album\\CD2'}\\${index}.flac`,
      state,
      batchId,
      exception: state === 'Completed, Errored' ? 'It failed' : undefined,
    })),
  )
  const user = await listed(api, 'download', username)
  expect(user?.directories.map((directory) => directory.directory).sort()).toEqual([
    'Music\\Album',
    'Music\\Album\\CD2',
  ])
  const files = filesOf(user)
  expect(files.map((file) => file.id).sort()).toEqual([...ids].sort())
  for (const [index, id] of ids.entries()) {
    expect(files.find((file) => file.id === id)).toMatchObject({ state: states[index], batchId: batchId.toLowerCase() })
  }
  expect(files.find((file) => file.state === 'Completed, Errored')?.exception).toBe('It failed')
})

test('uploads list the same way', async ({ slskd, api }) => {
  const username = newUser()
  const [id] = seedTransfers(slskd, [
    { direction: 'Upload', username, filename: 'Shared\\song.flac', state: 'Completed, Succeeded' },
  ])
  expect(filesOf(await listed(api, 'upload', username))).toMatchObject([{ id, state: 'Completed, Succeeded' }])
})

test("a batch keeps its search and destination, and one that's gone is a 404", async ({ slskd, api }) => {
  const searchId = randomUUID()
  const batchId = seedBatch(slskd, { username: newUser(), searchId, destination: 'Some Album' })
  const batch = schemas.parse(schemas.batch, await (await api.get(`transfers/downloads/batches/${batchId}`)).json())
  expect(batch).toMatchObject({ searchId, options: { destination: 'Some Album' } })
  expect((await api.get(`transfers/downloads/batches/${randomUUID()}`)).status()).toBe(404)
})

test("removing a finished transfer drops it, and cancelling one that isn't running finishes it", async ({
  slskd,
  api,
}) => {
  const username = newUser()
  const [finished, waiting] = seedTransfers(slskd, [
    { username, filename: 'A\\1.flac', state: 'Completed, Errored' },
    { username, filename: 'A\\2.flac', state: 'Queued, Locally' },
  ])
  const path = `transfers/downloads/${encodeURIComponent(username)}`
  expect((await api.delete(`${path}/${finished}`, { params: { remove: true } })).status()).toBe(204)
  expect((await api.delete(`${path}/${waiting}`, { params: { remove: false } })).status()).toBe(204)
  await expect
    .poll(async () => filesOf(await listed(api, 'download', username)).map(({ id, state }) => ({ id, state })))
    .toEqual([{ id: waiting, state: 'Completed, Cancelled' }])
})

test('clearing finished transfers removes every finished one, and leaves the rest', async ({ slskd, api }) => {
  const username = newUser()
  seedTransfers(
    slskd,
    states.map((state, index) => ({ username, filename: `A\\${index}.flac`, state })),
  )
  expect((await api.delete('transfers/downloads/all/completed')).status()).toBe(204)
  const left = filesOf(await listed(api, 'download', username)).map((file) => file.state)
  expect(left.sort()).toEqual(states.filter((state) => !state.startsWith('Completed')).sort())
})

test("a user's history counts their finished transfers", async ({ slskd, api }) => {
  const username = newUser()
  seedTransfers(slskd, [
    { username, filename: 'A\\1.flac', size: 1000, state: 'Completed, Succeeded' },
    { username, filename: 'A\\2.flac', size: 2000, state: 'Completed, Succeeded' },
    { username, filename: 'A\\3.flac', state: 'Completed, Cancelled' },
    { username, filename: 'A\\4.flac', state: 'Completed, Errored', exception: 'It failed' },
    { username, filename: 'A\\5.flac', state: 'Completed, TimedOut' },
    { username, filename: 'A\\6.flac', state: 'Queued, Locally' },
  ])
  const response = await api.get(`telemetry/reports/transfers/users/${encodeURIComponent(username)}`)
  const history = schemas.parse(schemas.userHistory, await response.json())
  expect(history.Download.statistics).toMatchObject({ total: 5, successful: 2, cancelled: 1 })
  expect(history.Download.summary.Succeeded?.totalBytes).toBe(3000)
  expect(history.Download.exceptions.map((each) => each.exception)).toContain('It failed')
  expect(history.Upload.statistics.total).toBe(0)
})
