import { expect, test } from '../fixtures'
import * as schemas from './schemas'

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
