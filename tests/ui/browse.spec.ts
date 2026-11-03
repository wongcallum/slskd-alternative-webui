import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { expect, logInPage, test } from '../fixtures'

// The page polls a browse's status, which is a 404 until the peer starts replying.
test.use({ config: { soulseek: true }, failedRequests: true })

test('a share filters by quality, a folder downloaded from it keeps its subfolders, and it opens again from the cache', async ({
  page,
  slskd,
  peers: { fast },
}) => {
  const album = path.join(slskd.downloads, 'Artist - Album')
  await rm(album, { recursive: true, force: true })
  await page.goto(`browse?user=${encodeURIComponent(fast.username)}`)
  await logInPage(page)
  await page.getByRole('button', { name: `Browse ${fast.username}` }).click()
  // Only 01 Intro.flac has attributes to judge, and 02 Outro.flac, which has none, rides along in its folder.
  await page.getByRole('button', { name: 'Filters' }).click()
  await page.getByLabel('Quality at least').click()
  await page.getByRole('option', { name: 'Lossless', exact: true }).click()
  const pane = page.getByRole('grid', { name: 'Contents' })
  await expect(pane.getByRole('row', { name: /\.(flac|mp3|jpg)/ })).toHaveText([/01 Intro\.flac/, /02 Outro\.flac/])
  await page.getByRole('button', { name: 'Clear' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('treeitem', { name: /Artist - Album 4$/ }).click()
  await page.getByRole('checkbox', { name: 'Select all' }).click()
  await page.getByRole('button', { name: /^Download 4 / }).click()
  for (const name of ['01 Intro.flac', '02 Outro.flac', 'CD2/01 Encore.flac', 'CD2/Scans/cover.jpg']) {
    const remote = `Music\\Artist - Album\\${name.replaceAll('/', '\\')}`
    await expect
      .poll(() => readFile(path.join(album, name)).catch(() => undefined), { timeout: 30_000 })
      .toEqual(fast.files.get(remote))
  }
  // Nothing browses on load, so the share can only come from the cache.
  await page.reload()
  await expect(page.getByRole('treeitem', { name: /Artist - Album 4$/ })).toBeVisible()
})
