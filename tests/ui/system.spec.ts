import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, logInPage, test } from '../fixtures'

// This path's base64 has a '/' in it, so the app has to send it with a join slskd normalises away.
test('a file is deleted from Files, even one that needs its path encoded with a join', async ({ page, slskd }) => {
  const file = path.join(slskd.downloads, 'Album', 'Is it?.flac')
  await writeFile(file, 'x')
  await page.goto(`system/files?path=${encodeURIComponent('Downloads/Album')}`)
  await logInPage(page)
  await page.getByRole('checkbox', { name: 'Select Downloads/Album/Is it?.flac' }).click()
  await page.getByRole('button', { name: /^Delete 1 / }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Is it?.flac')).toBeHidden()
  expect(existsSync(file)).toBe(false)
})

test('a rescan updates the counts, and the contents open from a share', async ({ page }) => {
  await page.goto('system/shares')
  await logInPage(page)
  await page.getByRole('button', { name: 'Rescan' }).click()
  await expect(page.getByText('4 files in 2 folders shared')).toBeVisible()
  await page.getByText('Music', { exact: true }).click()
  await expect(page.getByText('Album', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('This page crashed')).toHaveCount(0)
})

test('the config file opens in the editor and saves', async ({ page, slskd }) => {
  await page.goto('system/options?view=file')
  await logInPage(page)
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('instance_name: test')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('# Saved from the editor\n')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/^Saved\./)).toBeVisible()
  expect(await readFile(slskd.configFile, 'utf8')).toContain('# Saved from the editor')
})

test('stored searches can be deleted and opened while new searches arrive', async ({ page, api }) => {
  await api.post('searches', { data: { searchText: 'stored search' } })
  await page.goto('searches')
  await logInPage(page)
  await expect(page.getByText('Not logged in to Soulseek')).toBeVisible()
  const searches = page.getByRole('grid', { name: 'Searches' })
  const stored = searches.getByRole('row', { name: /stored search/ })
  await expect(stored).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(stored).toBeFocused()
  await api.post('searches', { data: { searchText: 'newer search' } })
  const newer = searches.getByRole('row', { name: /newer search/ })
  await expect(newer).toBeVisible()
  await expect(stored).toBeFocused()
  await expect(stored).toHaveAttribute('tabindex', '0')
  await page.keyboard.press('Delete')
  await expect(stored).toBeHidden()
  await expect(newer).toBeVisible()
  await expect(newer).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveTitle('newer search – Search – slskd')
  await expect(page.getByText('This page crashed')).toHaveCount(0)
})
