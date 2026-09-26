import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'
import * as v from 'valibot'

import { contextFor, expect, test } from '../fixtures'
import { openHub } from '../hub'
import { toneAttributes } from '../media'
import { sleep } from '../slskd'
import { startLoggedIn } from '../soulseek'
import * as schemas from './schemas'

test('the search hub sends the list as it connects', async ({ slskd, api, token }) => {
  await api.post('searches', { data: { searchText: 'listed' } })
  const hub = await openHub(slskd, 'search', token, ['LIST'])
  try {
    await expect.poll(() => hub.received('LIST').length).toBe(1)
    const list = schemas.parse(v.array(schemas.search), hub.received('LIST')[0])
    expect(list.map((search) => search.searchText)).toContain('listed')
  } finally {
    await hub.stop()
  }
})

// Searching needs a Soulseek login, but a search that fails is stored and pushed like any other.
test('a search is pushed as it starts and ends, listed, and deleted', async ({ slskd, api, token }) => {
  const hub = await openHub(slskd, 'search', token, ['CREATE', 'UPDATE', 'DELETE'])
  try {
    expect((await api.post('searches', { data: { searchText: 'pushed' } })).status()).toBe(409)
    await expect.poll(() => hub.received('CREATE').length).toBe(1)
    const created = schemas.parse(schemas.search, hub.received('CREATE')[0])
    expect(created).toMatchObject({ searchText: 'pushed', isComplete: false, endedAt: null })

    // endedAt is set once the responses are saved, which is what the app waits for.
    const ended = () =>
      hub
        .received('UPDATE')
        .map((payload) => schemas.parse(schemas.search, payload))
        .find((search) => search.id === created.id && search.isComplete && search.endedAt != null)
    await expect.poll(ended).toBeDefined()
    expect(ended()?.state).toBe('Completed, Errored')

    const list = schemas.parse(v.array(schemas.search), await (await api.get('searches')).json())
    expect(list.find((search) => search.id === created.id)).toMatchObject({ state: 'Completed, Errored' })
    expect(await (await api.get(`searches/${created.id}/responses`)).json()).toEqual([])

    expect((await api.delete(`searches/${created.id}`)).status()).toBe(204)
    await expect.poll(() => hub.received<{ id: string }>('DELETE').map((search) => search.id)).toEqual([created.id])
    expect((await api.delete(`searches/${created.id}`)).status()).toBe(404)
  } finally {
    await hub.stop()
  }
})

const stateOf = async (api: APIRequestContext, id: string) =>
  schemas.parse(schemas.search, await (await api.get(`searches/${id}`)).json()).state

async function post(api: APIRequestContext, searchText: string, searchTimeout: number) {
  const response = await api.post('searches', { data: { searchText, searchTimeout } })
  expect(response.status()).toBe(200)
  return schemas.parse(schemas.search, await response.json()).id
}

test.describe('logged in to Soulseek', () => {
  test.use({ config: { soulseek: true } })

  test('a search collects the responses of peers that share a match, and is pushed at each step', async ({
    slskd,
    api,
    token,
    peers: { fast },
  }) => {
    const hub = await openHub(slskd, 'search', token, ['CREATE', 'UPDATE'])
    try {
      const id = await post(api, 'album intro', 1000)
      const search = async () => schemas.parse(schemas.search, await (await api.get(`searches/${id}`)).json())
      await expect.poll(async () => (await search()).endedAt, { timeout: 15_000 }).toBeTruthy()
      expect(await search()).toMatchObject({
        state: 'Completed, TimedOut',
        isComplete: true,
        responseCount: 1,
        fileCount: 1,
      })
      const responses = schemas.parse(schemas.responses, await (await api.get(`searches/${id}/responses`)).json())
      const intro = 'Music\\Artist - Album\\01 Intro.flac'
      expect(responses).toEqual([
        expect.objectContaining({
          username: fast.username,
          files: [{ filename: intro, size: fast.files.get(intro)!.length, ...toneAttributes.flac }],
          lockedFiles: [],
        }),
      ])
      const pushed = (method: string) =>
        hub
          .received(method)
          .map((payload) => schemas.parse(schemas.search, payload))
          .filter((each) => each.id === id)
      expect(pushed('CREATE').map((each) => each.state)).toEqual(['Requested'])
      expect(pushed('UPDATE').map((each) => each.state)).toContain('InProgress')
      expect(pushed('UPDATE').at(-1)).toMatchObject({ state: 'Completed, TimedOut', isComplete: true })
    } finally {
      await hub.stop()
    }
  })

  test('a search is refused with a 429 while another is being created', async ({ api }) => {
    const statuses = await Promise.all(
      [1, 2, 3, 4].map(async (n) =>
        (await api.post('searches', { data: { searchText: `refused ${n}`, searchTimeout: 1000 } })).status(),
      ),
    )
    expect(statuses).toContain(429)
    expect(statuses.filter((status) => status !== 429).length).toBeGreaterThan(0)
  })

  test("a search without a word of two characters or more that isn't an exclusion is refused, and stored as errored", async ({
    api,
  }) => {
    for (const searchText of ['-ab', 'a -bc', 'a  b', '- x']) {
      const id = randomUUID()
      expect((await api.post('searches', { data: { id, searchText } })).status(), searchText).toBe(400)
      expect(await stateOf(api, id)).toBe('Completed, Errored')
    }
    for (const searchText of ['ab -c', '-a b cd']) {
      const id = await post(api, searchText, 1000)
      await api.put(`searches/${id}`)
    }
  })

  test('at most two searches run at once, and stopping one starts the next', async ({ api }) => {
    const ids: string[] = []
    try {
      for (const n of [1, 2, 3]) ids.push(await post(api, `waiting ${n}`, 60_000))
      await expect
        .poll(() => Promise.all(ids.map((id) => stateOf(api, id))), { timeout: 10_000 })
        .toEqual(['InProgress', 'InProgress', 'Queued'])
      expect((await api.put(`searches/${ids[0]}`)).ok()).toBe(true)
      await expect
        .poll(() => Promise.all(ids.map((id) => stateOf(api, id))))
        .toEqual(['Completed, Cancelled', 'InProgress', 'InProgress'])
    } finally {
      for (const id of ids) await api.put(`searches/${id}`)
    }
  })

  test("deleting a running search doesn't stop it, so the next waits until it ends", async ({ api }) => {
    const running = [await post(api, 'deleted 1', 3000), await post(api, 'deleted 2', 3000)]
    await expect.poll(() => Promise.all(running.map((id) => stateOf(api, id)))).toEqual(['InProgress', 'InProgress'])
    for (const id of running) expect((await api.delete(`searches/${id}`)).status()).toBe(204)
    const next = await post(api, 'next', 1000)
    await sleep(1000)
    expect(await stateOf(api, next)).toBe('Queued')
    await expect.poll(() => stateOf(api, next), { timeout: 15_000 }).not.toBe('Queued')
  })

  test('a search cut off by a restart is timed out, with endedAt set', async ({ network }) => {
    test.setTimeout(90_000)
    const instance = await startLoggedIn(await network(), {}, `restart.${randomUUID().slice(0, 8)} test`)
    try {
      let api = await contextFor(instance)
      const id = await post(api, 'album intro', 60_000)
      await expect.poll(() => stateOf(api, id)).toBe('InProgress')
      await api.dispose()
      await instance.relaunch()
      api = await contextFor(instance)
      const search = schemas.parse(schemas.search, await (await api.get(`searches/${id}`)).json())
      expect(search).toMatchObject({ state: 'Completed, TimedOut', isComplete: true, endedAt: expect.any(String) })
      await api.dispose()
    } finally {
      await instance.stop()
    }
  })
})
