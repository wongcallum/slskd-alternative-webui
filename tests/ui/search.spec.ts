import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { expect, logInPage, test } from '../fixtures'
import { sleep } from '../slskd'

test.use({ config: { soulseek: true } })

test('a search shows the files peers share once stopped, and downloads one', async ({
  page,
  slskd,
  peers: { fast },
}) => {
  const file = path.join(slskd.downloads, 'Artist - Album', '01 Intro.flac')
  await rm(file, { force: true })
  await page.goto('searches')
  await logInPage(page)
  await page.getByPlaceholder('Search Soulseek').fill('album intro')
  await page.getByPlaceholder('Search Soulseek').press('Enter')
  await expect(page.getByText('1 response, 1 file')).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: fast.username, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Download folder' }).click()
  await expect(page.getByText('Enqueued 1 download')).toBeVisible()
  await expect
    .poll(() => readFile(file).catch(() => undefined))
    .toEqual(fast.files.get('Music\\Artist - Album\\01 Intro.flac'))
})

// slskd pushes a search's counts as responses arrive, which on one host is often before the POST that created it
// returns. Holding the POST back makes that certain.
test("a new search's counts aren't overwritten by its POST when a peer answers first", async ({ page }) => {
  await page.goto('searches')
  await logInPage(page)
  await page.route('**/api/v0/searches', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    await sleep(1000)
    return route.fulfill({ response })
  })
  await page.getByPlaceholder('Search Soulseek').fill('album intro')
  await page.getByPlaceholder('Search Soulseek').press('Enter')
  await expect(page.getByText('1 response, 1 file')).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
})
