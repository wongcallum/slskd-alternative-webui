import type { APIRequestContext } from '@playwright/test'
import * as v from 'valibot'

import { expect, test } from '../fixtures'
import { openHub } from '../hub'
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

async function post(api: APIRequestContext, searchText: string, searchTimeout: number) {
  const response = await api.post('searches', { data: { searchText, searchTimeout } })
  expect(response.status()).toBe(200)
  return schemas.parse(schemas.search, await response.json()).id
}

test.describe('logged in to Soulseek', () => {
  test.use({ config: { soulseek: true } })

  test('a search collects the responses of peers that share a match, and its end is pushed once they are saved', async ({
    slskd,
    api,
    token,
    peers: { fast },
  }) => {
    const hub = await openHub(slskd, 'search', token, ['UPDATE'])
    try {
      const id = await post(api, 'album intro', 1000)
      const ended = () =>
        hub
          .received('UPDATE')
          .map((payload) => schemas.parse(schemas.search, payload))
          .find((each) => each.id === id && each.endedAt != null)
      await expect.poll(ended, { timeout: 15_000 }).toBeDefined()
      const responses = schemas.parse(schemas.responses, await (await api.get(`searches/${id}/responses`)).json())
      const intro = 'Music\\Artist - Album\\01 Intro.flac'
      expect(responses).toEqual([
        expect.objectContaining({
          username: fast.username,
          files: [expect.objectContaining({ filename: intro, size: fast.files.get(intro)!.length })],
        }),
      ])
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
})
