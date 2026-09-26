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
