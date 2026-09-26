import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { expect, logInPage, test } from '../fixtures'

// The page polls a browse's status, which is a 404 until the peer starts replying.
test.use({ config: { soulseek: true }, failedRequests: true })

test('a folder downloaded from Browse keeps its subfolders', async ({ page, slskd, peers: { fast } }) => {
  const album = path.join(slskd.downloads, 'Artist - Album')
  await rm(album, { recursive: true, force: true })
  await page.goto(`browse?user=${encodeURIComponent(fast.username)}`)
  await logInPage(page)
  await page.getByRole('button', { name: `Browse ${fast.username}` }).click()
  await page.getByRole('treeitem', { name: /Artist - Album 4$/ }).click()
  await page.getByRole('checkbox', { name: 'Select all' }).click()
  await page.getByRole('button', { name: /^Download 4 / }).click()
  for (const name of ['01 Intro.flac', '02 Outro.flac', 'CD2/01 Encore.flac', 'CD2/Scans/cover.jpg']) {
    const remote = `Music\\Artist - Album\\${name.replaceAll('/', '\\')}`
    await expect.poll(() => readFile(path.join(album, name)).catch(() => undefined)).toEqual(fast.files.get(remote))
  }
})
