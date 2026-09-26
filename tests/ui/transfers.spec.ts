import { randomUUID } from 'node:crypto'

import { expect, logInPage, test } from '../fixtures'
import { seedTransfers } from '../seed'

test('downloads are split into active and finished, and clearing finished ones leaves the rest', async ({
  page,
  slskd,
  api,
}) => {
  const username = `user ${randomUUID().slice(0, 8)}`
  seedTransfers(slskd, [
    { username, filename: 'Music\\Album\\01 Done.flac', state: 'Completed, Succeeded' },
    { username, filename: 'Music\\Album\\02 Failed.flac', state: 'Completed, Errored' },
    { username, filename: 'Music\\Album\\03 Waiting.flac', state: 'Queued, Locally' },
  ])
  await page.goto('downloads')
  await logInPage(page)
  await expect(page.getByText('03 Waiting.flac')).toBeVisible()
  await expect(page.getByText('Queued locally')).toBeVisible()
  await expect(page.getByText('1 succeeded, 1 failed')).toBeVisible()

  await page.getByRole('button', { name: 'Clear finished' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText('1 succeeded, 1 failed')).toBeHidden()
  await expect(page.getByText('03 Waiting.flac')).toBeVisible()
  const list = (await (await api.get('transfers/downloads')).json()) as { username: string }[]
  expect(JSON.stringify(list.find((user) => user.username === username))).not.toContain('Completed')
})

test('uploads are listed', async ({ page, slskd }) => {
  seedTransfers(slskd, [
    { direction: 'Upload', username: 'uploader', filename: 'Shared\\Uploaded.flac', state: 'InProgress' },
  ])
  await page.goto('uploads')
  await logInPage(page)
  await expect(page.getByText('Uploaded.flac')).toBeVisible()
  await expect(page.getByText('1 uploading')).toBeVisible()
})
