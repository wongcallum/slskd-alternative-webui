import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import type { RawConversation, RawPrivateMessage } from '../../src/chat/conversations'
import type { RawRoomMessage } from '../../src/chat/rooms'
import { contextFor, expect, jsonString, logInPage, ownName, test } from '../fixtures'

test.use({ config: { soulseek: true } })

const conversation = (username: string) => `conversations/${encodeURIComponent(username)}`

const unique = (text: string) => `${text} ${randomUUID().slice(0, 8)}`

const messages = async (api: APIRequestContext, username: string) =>
  (await (await api.get(`${conversation(username)}/messages`)).json()) as RawPrivateMessage[]

const unread = async (api: APIRequestContext, username: string) =>
  ((await (await api.get('conversations')).json()) as RawConversation[]).find((each) => each.username === username)
    ?.unAcknowledgedMessageCount

test('an unread message counts in the title until its conversation is opened, where a reply reaches them', async ({
  page,
  api,
  peers: { fast },
}) => {
  await api.put(conversation(fast.username))
  const me = await ownName(api)
  const peer = await contextFor(fast.instance)
  const [theirs, ours] = [unique('Hello'), unique('Hi')]
  await peer.post(conversation(me), jsonString(theirs))
  await expect.poll(() => unread(api, fast.username)).toBe(1)
  await page.goto('chat')
  await logInPage(page)
  await expect(page).toHaveTitle('(1) Chat – slskd')
  await page.getByRole('link', { name: fast.username }).click()
  await expect(page.getByText(theirs)).toBeVisible()
  await expect(page).toHaveTitle(`${fast.username} – Chat – slskd`)
  expect(await unread(api, fast.username)).toBe(0)
  await page.getByPlaceholder(`Message ${fast.username}`).fill(ours)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(ours)).toBeVisible()
  await expect.poll(async () => (await messages(peer, me)).map((message) => message.message)).toContain(ours)
  await peer.dispose()
})

test('closing a conversation marks it read and takes it off the list', async ({ page, api, peers: { slow } }) => {
  await api.put(conversation(slow.username))
  const peer = await contextFor(slow.instance)
  await peer.post(conversation(await ownName(api)), jsonString(unique('Hello')))
  await expect.poll(() => unread(api, slow.username)).toBe(1)
  await page.goto('chat')
  await logInPage(page)
  await page.getByRole('button', { name: `Close the conversation with ${slow.username}` }).click()
  await expect(page.getByRole('link', { name: slow.username })).toBeHidden()
  expect(await unread(api, slow.username)).toBeUndefined()
  expect((await messages(api, slow.username)).every((message) => message.isAcknowledged)).toBe(true)
  await peer.dispose()
})

test('a room joined from the list shows who is in it and what they say, and takes our messages', async ({
  page,
  api,
  peers: { fast },
}) => {
  const room = unique('Room')
  const path = `rooms/joined/${encodeURIComponent(room)}`
  const peer = await contextFor(fast.instance)
  await peer.post('rooms/joined', jsonString(room))
  await page.goto('rooms')
  await logInPage(page)
  await page.getByLabel('Join a room').click()
  await page.getByRole('dialog').getByText(room).click()
  await expect(page).toHaveTitle(`${room} – Chat – slskd`)
  await expect(page.getByText('2 users')).toBeVisible()
  await expect(page.getByRole('button', { name: fast.username, exact: true })).toBeVisible()
  const [theirs, ours] = [unique('Hello'), unique('Hi')]
  await peer.post(`${path}/messages`, jsonString(theirs))
  await expect(page.getByText(theirs)).toBeVisible()
  await page.getByPlaceholder(`Message ${room}`).fill(ours)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(ours)).toBeVisible()
  const me = await ownName(api)
  await expect
    .poll(async () =>
      ((await (await peer.get(`${path}/messages`)).json()) as RawRoomMessage[]).map(({ username, message }) => ({
        username,
        message,
      })),
    )
    .toContainEqual({ username: me, message: ours })
  await page.getByRole('button', { name: `Leave ${room}` }).click()
  await expect(page.getByRole('link', { name: room })).toBeHidden()
  await peer.delete(path)
  await peer.dispose()
})
