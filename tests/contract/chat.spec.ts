import { expect, test } from '../fixtures'

test("a conversation that hasn't started is a 404, and so is leaving a room that isn't joined", async ({ api }) => {
  expect(await (await api.get('conversations')).json()).toEqual([])
  expect((await api.get('conversations/nobody/messages')).status()).toBe(404)
  expect(await (await api.get('rooms/joined')).json()).toEqual([])
  expect((await api.delete('rooms/joined/nowhere')).status()).toBe(404)
})

test("a browse that hasn't started has no status", async ({ api }) => {
  expect((await api.get(`users/${encodeURIComponent('some.one')}/browse/status`)).status()).toBe(404)
})
