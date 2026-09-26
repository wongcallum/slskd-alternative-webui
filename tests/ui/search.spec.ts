import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import type { Page } from '@playwright/test'

import { expect, logInPage, test } from '../fixtures'
import { sleep } from '../slskd'
import type { Peer } from '../soulseek'

test.use({ config: { soulseek: true } })

// Only the fast peer's `Music\Artist - Album\01 Intro.flac` matches.
async function searchAlbumIntro(page: Page, fast: Peer) {
  await page.getByPlaceholder('Search Soulseek').fill('album intro')
  await page.getByPlaceholder('Search Soulseek').press('Enter')
  await expect(page.getByText('1 response, 1 file')).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: fast.username, exact: true })).toBeVisible()
}

test('a search shows the files peers share once stopped, and downloads one', async ({
  page,
  slskd,
  peers: { fast },
}) => {
  const file = path.join(slskd.downloads, 'Artist - Album', '01 Intro.flac')
  await rm(file, { force: true })
  await page.goto('searches')
  await logInPage(page)
  await searchAlbumIntro(page, fast)
  await page.getByRole('button', { name: 'Download folder' }).click()
  await expect(page.getByText('Enqueued 1 download')).toBeVisible()
  await expect
    .poll(() => readFile(file).catch(() => undefined))
    .toEqual(fast.files.get('Music\\Artist - Album\\01 Intro.flac'))
})

test.describe(() => {
  // Getting the full folder browses the peer, whose status is polled, and is a 404 until the peer starts replying.
  test.use({ failedRequests: true })

  const album = ['01 Intro.flac', '02 Outro.flac', 'CD2\\01 Encore.flac', 'CD2\\Scans\\cover.jpg']

  async function expectFullFolder(page: Page) {
    await page.getByRole('button', { name: 'Expand all' }).click()
    for (const name of album) await expect(page.getByText(name, { exact: true })).toBeVisible()
    await expect(page.getByText('01 Other.flac')).toHaveCount(0)
  }

  // slskd peers answer a request for one folder with every file whose path starts with it, by bare name, which would
  // list `CD2\01 Encore.flac` and `Artist - Album 2\01 Other.flac` as if they were in the folder.
  test("a folder's full contents come from the peer's share with its subfolders", async ({ page, peers: { fast } }) => {
    await page.goto('searches')
    await logInPage(page)
    await searchAlbumIntro(page, fast)
    await page.getByRole('button', { name: `Get the full folder (browses ${fast.username}'s whole share)` }).click()
    await expectFullFolder(page)
  })

  test("a folder's full contents come from a cached share without browsing again", async ({
    page,
    peers: { fast },
  }) => {
    await page.goto(`browse?user=${encodeURIComponent(fast.username)}`)
    await logInPage(page)
    await page.getByRole('button', { name: `Browse ${fast.username}` }).click()
    await expect(page.getByRole('treeitem', { name: /Artist - Album 4$/ })).toBeVisible()
    await page.goto('searches')
    const browses: string[] = []
    page.on('request', (request) => {
      if (/\/users\/[^/]+\/browse/.test(new URL(request.url()).pathname)) browses.push(request.url())
    })
    await searchAlbumIntro(page, fast)
    await page.getByRole('button', { name: 'Get the full folder', exact: true }).click()
    await expectFullFolder(page)
    expect(browses).toEqual([])
  })
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
